/**
 * gateway-hook.js
 * 通过 OpenClaw Gateway WebSocket 实时订阅 agent 状态
 * 使用本机 device identity 进行签名认证，获得 operator.read scope
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IDENTITY_PATH = path.join(process.env.HOME, '.openclaw/identity/device.json');
const GATEWAY_URL = 'ws://127.0.0.1:18789/ws';
const CLIENT_ID = 'cli';
const CLIENT_MODE = 'cli';
const SCOPES = ['operator.admin', 'operator.read', 'operator.write', 'operator.admin', 'operator.pairing'];

// ===== 签名工具（复制自 OpenClaw 源码协议）=====

function base64UrlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const raw = key.export({ type: 'spki', format: 'der' });
  // Ed25519 SPKI: last 32 bytes are raw public key
  return base64UrlEncode(raw.slice(-32));
}

function buildDeviceAuthPayloadV3(p) {
  const scopes = p.scopes.join(',');
  const token = p.token ?? '';
  const platform = (p.platform ?? 'linux').slice(0, 64).replace(/[^a-z0-9._-]/gi, '_');
  return [
    'v3', p.deviceId, p.clientId, p.clientMode, p.role,
    scopes, String(p.signedAtMs), token, p.nonce, platform, ''
  ].join('|');
}

// ===== Gateway WS Client =====

class GatewayHook {
  constructor({ onEvent, onReady, onClose }) {
    this.onEvent = onEvent;
    this.onReady = onReady;
    this.onClose = onClose;
    this.ws = null;
    this.reqId = 100;
    this.pending = new Map();
    this.identity = null;
    this.token = null;
    this.ready = false;
    this.stopped = false;
    this.reconnectMs = 3000;
    this._reconnectTimer = null;
    this._loadIdentity();
  }

  _loadIdentity() {
    try {
      if (fs.existsSync(IDENTITY_PATH)) {
        const raw = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
        if (raw.deviceId && raw.privateKeyPem && raw.publicKeyPem) {
          this.identity = raw;
        }
      }
    } catch (e) {
      console.error('[gateway-hook] failed to load identity:', e.message);
    }
  }

  _loadToken() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/openclaw.json'), 'utf8'));
      return cfg?.gateway?.auth?.token || cfg?.gateway?.token || null;
    } catch { return null; }
  }

  start() {
    this.stopped = false;
    this.token = this._loadToken();
    this._connect();
  }

  stop() {
    this.stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }

  _connect() {
    if (this.stopped) return;
    const ws = new WebSocket(GATEWAY_URL, {
      env: { OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: '1' }
    });
    this.ws = ws;
    this.ready = false;

    process.env.OPENCLAW_ALLOW_INSECURE_PRIVATE_WS = '1';

    ws.on('error', (err) => {
      // silent — will retry on close
    });

    ws.on('close', () => {
      if (this.stopped) return;
      this.ready = false;
      this.onClose?.();
      this._reconnectTimer = setTimeout(() => this._connect(), this.reconnectMs);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.event) this._handleEvent(msg);
        else if (msg.type === 'res' && msg.id) {
          const cb = this.pending.get(msg.id);
          if (cb) { this.pending.delete(msg.id); cb(msg); }
        }
      } catch {}
    });
  }

  _handleEvent(msg) {
    const ws = this.ws;
    if (!ws) return;
    if (msg.event === 'connect.challenge') {
      this._sendConnect(msg.payload?.nonce, ws);
      return;
    }
    if (msg.event === 'health' || msg.event === 'tick') return;
    // Forward all other events to consumer
    this.onEvent?.(msg);
  }

  _sendConnect(nonce, ws) {
    const signedAtMs = Date.now();
    let device = undefined;
    if (this.identity) {
      const payload = buildDeviceAuthPayloadV3({
        deviceId: this.identity.deviceId,
        clientId: CLIENT_ID,
        clientMode: CLIENT_MODE,
        role: 'operator',
        scopes: SCOPES,
        signedAtMs,
        token: this.token || null,
        nonce: nonce || '',
        platform: process.platform,
      });
      const signature = signDevicePayload(this.identity.privateKeyPem, payload);
      device = {
        id: this.identity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(this.identity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }

    const connectParams = {
      minProtocol: 3, maxProtocol: 3,
      client: { id: CLIENT_ID, version: '1.0.0', platform: process.platform, mode: CLIENT_MODE, displayName: 'openclaw-monitor' },
      role: 'operator',
      scopes: SCOPES,
      auth: this.token ? { token: this.token } : undefined,
      device,
      locale: 'zh-CN', userAgent: 'openclaw-monitor/1.0',
    };

    this._req('connect', connectParams, ws, (res) => {
      if (res.ok) {
        this.ready = true;
        this._subscribe(ws);
        this.onReady?.();
      }
      // If connect fails, ws will close and we retry
    });
  }

  _subscribe(ws) {
    // Subscribe to all session events (session start/stop/change)
    this._req('sessions.subscribe', {}, ws, (res) => {
      // success — events will start flowing
    });
  }

  _req(method, params, ws, cb) {
    const id = String(this.reqId++);
    if (cb) this.pending.set(id, cb);
    ws.send(JSON.stringify({ type: 'req', id, method, params: params || {} }));
    return id;
  }

  // Subscribe to real-time messages for a specific session
  subscribeSession(sessionKey) {
    if (!this.ws || !this.ready) return;
    this._req('sessions.messages.subscribe', { sessionKey }, this.ws, (res) => {
      // subscribed
    });
  }

  unsubscribeSession(sessionKey) {
    if (!this.ws || !this.ready) return;
    this._req('sessions.messages.unsubscribe', { sessionKey }, this.ws, () => {});
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.ready) return reject(new Error('not connected'));
      this._req(method, params, this.ws, (res) => {
        if (res.ok) resolve(res.payload);
        else reject(new Error(res.error?.message || 'request failed'));
      });
    });
  }
}

module.exports = { GatewayHook };
