const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const YAML = require('yaml');
const { execSync, exec } = require('child_process');
const { WebSocketServer } = require('ws');

// ===== Config =====
const CONFIG_FILE = path.join(__dirname, 'config.yaml');
const LOG_DIR = '/tmp/openclaw';
const STATE_FILE = path.join(LOG_DIR, 'minion-state.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const cfg = YAML.parse(raw);
    // Resolve ~ to HOME
    if (cfg.openclawRoot && cfg.openclawRoot.startsWith('~')) {
      cfg.openclawRoot = cfg.openclawRoot.replace('~', process.env.HOME);
    }
    return cfg;
  } catch (e) {
    console.error('Config load error:', e.message);
    return { openclawRoot: path.join(process.env.HOME, '.openclaw'), server: { port: 7777, host: '0.0.0.0' }, display: { showCron: false, showSubagent: false } };
  }
}

let config = loadConfig();
const AGENTS_DIR = path.join(config.openclawRoot, 'agents');

// ===== Feature 3: Simple Token Auth =====
let authToken = null;
function initAuth() {
  if (!config.auth?.enabled) {
    authToken = null;
    return;
  }
  // Generate random 6-char alphanumeric token
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 6; i++) token += chars[Math.floor(Math.random() * chars.length)];
  authToken = token;
  console.log(`\n🔐 Auth Token: ${token}\n`);
  // Save to file
  try {
    fs.writeFileSync(path.join(LOG_DIR, 'auth-token.txt'), token);
  } catch {}
}
initAuth();

// ===== Express App =====
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware (after static files)
app.use((req, res, next) => {
  if (!authToken) return next(); // auth disabled
  // Skip auth for static files and auth verify endpoint
  if (req.path === '/api/auth/verify') return next();
  if (!req.path.startsWith('/api/')) return next(); // static files already served above

  const token = req.query.token || req.cookies?.token;
  if (token === authToken) return next();
  res.status(401).json({ error: 'Unauthorized', authRequired: true });
});

// Auth verify endpoint
app.get('/api/auth/verify', (req, res) => {
  if (!authToken) return res.json({ authRequired: false });
  const token = req.query.token;
  if (token === authToken) return res.json({ authRequired: false, valid: true });
  res.json({ authRequired: true, valid: false });
});

// ===== Logging =====
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(LOG_DIR, 'monitor.log'), line + '\n'); } catch {}
}

// ===== Multi-User: Connected Users =====
// userId -> { x, y, z, yaw, pitch, name, color, lastSeen }
const connectedUsers = {};
const userColors = ['#53d8fb', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#38bdf8', '#fb923c'];
let userColorIdx = 0;

// Client reports camera position
app.post('/api/users/position', (req, res) => {
  const { userId, x, y, z, yaw, pitch, name } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  if (!connectedUsers[userId]) {
    connectedUsers[userId] = { color: userColors[userColorIdx++ % userColors.length] };
  }
  connectedUsers[userId].x = x;
  connectedUsers[userId].y = y;
  connectedUsers[userId].z = z;
  connectedUsers[userId].yaw = yaw;
  connectedUsers[userId].pitch = pitch;
  connectedUsers[userId].name = name || '匿名';
  connectedUsers[userId].lastSeen = Date.now();
  res.json({ ok: true });
});

// Get all connected users
app.get('/api/users', (req, res) => {
  const now = Date.now();
  for (const [id, u] of Object.entries(connectedUsers)) {
    if (now - u.lastSeen > 10000) delete connectedUsers[id];
  }
  res.json({ users: connectedUsers, serverTime: now });
});

// Time sync endpoint (for NTP-like clock calibration)
app.get('/api/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

// ===== Feature 2: World Chat =====
const chatMessages = []; // max 100
const MAX_CHAT_MESSAGES = 100;
let lastUserCount = 0;

app.post('/api/chat/send', (req, res) => {
  const { userId, name, text } = req.body;
  if (!userId || !text) return res.status(400).json({ error: 'Missing userId or text' });
  const msg = { userId, name: name || '匿名', text: text.slice(0, 500), time: Date.now() };
  chatMessages.push(msg);
  if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
  broadcast({ type: 'chat', data: { chat: msg } });
  res.json({ ok: true });
});

app.get('/api/chat/messages', (req, res) => {
  res.json({ messages: chatMessages });
});

// Broadcast user positions to all SSE clients every 100ms (game-quality rate)
setInterval(() => {
  const now = Date.now();
  // Clean stale users
  for (const [id, u] of Object.entries(connectedUsers)) {
    if (now - u.lastSeen > 10000) delete connectedUsers[id];
  }
  const users = Object.keys(connectedUsers);
  if (users.length > 0 && (sseClients.size > 0 || wsClients.size > 0)) {
    // Include server timestamp for client-side time sync
    const msg = { type: 'users', data: connectedUsers, serverTime: now };
    broadcast(msg);
    broadcastWS(msg);
  }
  // Auto-generate join/leave chat messages
  const currentCount = users.length;
  if (currentCount !== lastUserCount) {
    if (currentCount > lastUserCount && lastUserCount > 0) {
      const msg = { userId: 'system', name: '系统', text: `🟢 有用户加入了世界 (当前${currentCount}人)`, time: now, system: true };
      chatMessages.push(msg);
      if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
      const chatMsg = { type: 'chat', data: { chat: msg } };
      broadcast(chatMsg);
      broadcastWS(chatMsg);
    } else if (currentCount < lastUserCount) {
      const msg = { userId: 'system', name: '系统', text: `🔴 有用户离开了世界 (当前${currentCount}人)`, time: now, system: true };
      chatMessages.push(msg);
      if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
      const chatMsg = { type: 'chat', data: { chat: msg } };
      broadcast(chatMsg);
      broadcastWS(chatMsg);
    }
    lastUserCount = currentCount;
  }
}, 100);
const sseClients = new Set();
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) { try { c.write(msg); } catch {} }
}

// ===== Agent Discovery =====
// agentName -> { sessions: { sessionKey: { sessionId, metadata } } }
let agentState = {};

function discoverAgents() {
  const newState = {};
  try {
    const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of agentDirs) {
      const sessDir = path.join(AGENTS_DIR, dir.name, 'sessions');
      const sessFile = path.join(sessDir, 'sessions.json');
      if (!fs.existsSync(sessFile)) continue;

      const raw = JSON.parse(fs.readFileSync(sessFile, 'utf-8'));
      const sessions = {};
      for (const [key, meta] of Object.entries(raw)) {
        // Parse session key to determine type
        const parsed = parseSessionKey(key);
        sessions[key] = {
          key,
          sessionId: meta.sessionId,
          type: parsed.type,
          label: parsed.label,
          displayName: meta.displayName || '',
          chatType: meta.chatType || '',
          channel: meta.channel || '',
          subject: meta.subject || '',
          updatedAt: meta.updatedAt || 0,
        };
      }
      newState[dir.name] = { name: dir.name, sessions };
    }
  } catch (e) {
    log('error', 'Agent discovery error: ' + e.message);
  }
  agentState = newState;
  return newState;
}

function parseSessionKey(key) {
  // Format: agent:{name}:{type}:{subtype}:{...}
  const parts = key.split(':');
  if (parts[0] !== 'agent') return { type: 'unknown', label: key };

  if (parts[2] === 'main' && parts.length === 3) {
    return { type: 'main', label: '主会话' };
  }
  if (parts[2] === 'feishu' && parts[3] === 'group') {
    const groupId = parts.slice(4).join(':');
    return { type: 'group', label: '飞书群:' + (groupId.length > 12 ? groupId.slice(0, 12) + '…' : groupId) };
  }
  if (parts[2] === 'feishu' && parts[3] === 'dm') {
    const userId = parts.slice(4).join(':');
    return { type: 'dm', label: '飞书私信:' + (userId.length > 12 ? userId.slice(0, 12) + '…' : userId) };
  }
  if (parts[2] === 'cron') {
    const id = parts.slice(3).join(':');
    return { type: 'cron', label: '定时任务' + (id ? ':' + id.slice(0, 8) : '') };
  }
  if (parts[2] === 'subagent') {
    const id = parts.slice(3).join(':');
    return { type: 'subagent', label: '子代理' + (id ? ':' + id.slice(0, 8) : '') };
  }
  // Fallback
  return { type: parts[2] || 'session', label: key.slice(0, 30) };
}

// ===== JSONL Parsing =====
function parseUserMessage(text) {
  if (!text) return '';
  // Feishu format: [message_id: om_xxx]\n sender_name: actual_text
  const msgMatch = text.match(/\[message_id:[^\]]*\]\s*\S+:\s*([\s\S]+)/);
  let msg = msgMatch ? msgMatch[1] : text;
  // Strip trailing JSON blocks
  const jsonStart = msg.search(/\n\{/);
  if (jsonStart >= 0) msg = msg.slice(0, jsonStart);
  msg = msg.trim();
  // Clean at mentions
  msg = msg.replace(/<at[^>]*>([^<]*)<\/at>/g, '@$1');
  if (msg.startsWith('[media attached:') || msg.includes('[media attached')) return '📎 图片/附件';
  return msg.slice(0, 2000);
}

function parseAssistantContent(content) {
  const result = { thinking: '', toolCalls: [], texts: [] };
  if (!Array.isArray(content)) return result;
  for (const item of content) {
    if (typeof item === 'string') {
      result.texts.push(item.slice(0, 5000));
      continue;
    }
    if (item.type === 'thinking') {
      result.thinking = (item.thinking || '').slice(0, 5000);
    } else if (item.type === 'toolCall') {
      result.toolCalls.push({
        name: item.name || '?',
        args: JSON.stringify(item.arguments || {}).slice(0, 2000),
      });
    } else if (item.type === 'text') {
      result.texts.push((item.text || '').slice(0, 5000));
    }
  }
  return result;
}

function parseToolResult(content) {
  if (!Array.isArray(content)) return '';
  for (const item of content) {
    if (typeof item === 'string') return item.slice(0, 5000);
    if (item.type === 'text') return (item.text || '').slice(0, 5000);
  }
  return '';
}

// ===== Session File Watching =====
// sessionKey -> { watcher, filePath, lastSize }
const watchedSessions = {};

function watchSessionFile(agentName, sessionKey, sessionId) {
  if (watchedSessions[sessionKey]) return;

  const filePath = path.join(AGENTS_DIR, agentName, 'sessions', sessionId + '.jsonl');
  if (!fs.existsSync(filePath)) return;

  let lastSize = 0;
  // Read current size to only catch new content
  try { lastSize = fs.statSync(filePath).size; } catch {}

  let debounceTimer = null;
  let lastHash = '';

  const watcher = chokidar.watch(filePath, { persistent: true, awaitWriteFinish: { stabilityThreshold: 100 } });

  watcher.on('change', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size <= lastSize) { lastSize = stat.size; return; }

        const stream = fs.createReadStream(filePath, { start: lastSize, encoding: 'utf-8' });
        let buf = '';
        stream.on('data', c => buf += c);
        stream.on('end', () => {
          lastSize = stat.size;
          const hash = buf.slice(0, 200);
          if (hash === lastHash) return;
          lastHash = hash;

          const lines = buf.split('\n').filter(Boolean);
          log('info', `Session ${sessionKey}: ${lines.length} new lines`);

          for (const line of lines) {
            processLine(agentName, sessionKey, line);
          }
        });
      } catch (e) { log('error', 'Session read error: ' + e.message); }
    }, 100);
  });

  watchedSessions[sessionKey] = { watcher, filePath, lastSize };
  log('info', `Watching: ${sessionKey} -> ${filePath}`);
}

function processLine(agentName, sessionKey, line) {
  try {
    if (!line || line.length < 10 || !line.startsWith('{')) return;
    const entry = JSON.parse(line);
    if (entry.type !== 'message') return;

    const msg = entry.message || {};
    const role = msg.role;
    if (!role) return;

    const content = msg.content;

    if (role === 'user') {
      let text = '';
      if (typeof content === 'string') {
        text = parseUserMessage(content);
      } else if (Array.isArray(content)) {
        text = content.map(c => typeof c === 'string' ? c : c.text || '').join(' ');
        text = parseUserMessage(text);
      }
      if (!text) return;

      // Extract sender name from Feishu metadata
      let senderName = '';
      const rawText = typeof content === 'string' ? content : JSON.stringify(content);
      const atMatch = rawText.match(/<at[^>]*>([^<]*)<\/at>/);
      if (atMatch) senderName = atMatch[1];

      broadcast({
        type: 'event',
        data: {
          type: 'user_msg',
          agent: agentName,
          session: sessionKey,
          msg: text,
          userName: senderName,
          ts: new Date().toISOString(),
        }
      });
    }

    if (role === 'assistant') {
      const parsed = parseAssistantContent(content);
      if (parsed.thinking) {
        broadcast({
          type: 'event',
          data: {
            type: 'thinking',
            agent: agentName,
            session: sessionKey,
            thinking: parsed.thinking,
            ts: new Date().toISOString(),
          }
        });
      }
      for (const tc of parsed.toolCalls) {
        broadcast({
          type: 'event',
          data: {
            type: 'tool_use',
            agent: agentName,
            session: sessionKey,
            tool: tc.name,
            args: tc.args,
            ts: new Date().toISOString(),
          }
        });
      }
      if (parsed.texts.length > 0) {
        const hasTools = parsed.toolCalls.length > 0;
        broadcast({
          type: 'event',
          data: {
            type: hasTools ? 'reply_intermediate' : 'reply_text',
            agent: agentName,
            session: sessionKey,
            text: parsed.texts.join(' ').slice(0, 200),
            ts: new Date().toISOString(),
          }
        });
      }
    }

    if (role === 'toolResult') {
      const toolName = msg.toolName || '?';
      const resultText = parseToolResult(content);
      broadcast({
        type: 'event',
        data: {
          type: 'tool_result',
          agent: agentName,
          session: sessionKey,
          tool: toolName,
          result: resultText.slice(0, 150),
          ts: new Date().toISOString(),
        }
      });
    }

  } catch (e) {
    // skip parse errors
  }
}

// ===== Full world state =====
function getWorldState() {
  const profiles = loadProfiles();
  const agents = [];

  for (const [agentName, agentInfo] of Object.entries(agentState)) {
    const sessions = [];
    for (const [key, sess] of Object.entries(agentInfo.sessions)) {
      // Filter by display config
      if (!config.display.showCron && sess.type === 'cron') continue;
      if (!config.display.showSubagent && sess.type === 'subagent') continue;

      sessions.push({
        key: sess.key,
        sessionId: sess.sessionId,
        type: sess.type,
        label: sess.label,
        displayName: sess.displayName,
        chatType: sess.chatType,
        channel: sess.channel,
        profile: profiles[sess.key] || null,
      });
    }
    agents.push({ name: agentName, sessions });
  }

  return { agents, profiles, config };
}

// ===== Profile Persistence =====
const PROFILES_FILE = path.join(LOG_DIR, 'minion-profiles.json');
function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8')); } catch { return {}; }
}
function saveProfiles(profiles) {
  try { fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2)); } catch {}
}

// ===== Feishu Name Resolution =====
let feishuToken = null, feishuTokenExpiry = 0;
const nameCache = {};

async function getFeishuToken() {
  if (feishuToken && Date.now() < feishuTokenExpiry) return feishuToken;
  try {
    const ocConfig = JSON.parse(fs.readFileSync(path.join(config.openclawRoot, 'openclaw.json'), 'utf-8'));
    const feishuCh = ocConfig.channels?.feishu || {};
    const feishu = feishuCh.accounts?.default || feishuCh;
    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: feishu.appId, app_secret: feishu.appSecret }),
    });
    const data = await resp.json();
    feishuToken = data.tenant_access_token;
    feishuTokenExpiry = Date.now() + (data.expire || 7200) * 1000;
    return feishuToken;
  } catch { return null; }
}

async function resolveFeishuName(id) {
  if (nameCache[id]) return nameCache[id];
  const token = await getFeishuToken();
  if (!token) return id;
  try {
    if (id.startsWith('ou_')) {
      const resp = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${id}?user_id_type=open_id`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      nameCache[id] = data.data?.user?.name || id;
      return nameCache[id];
    }
    if (id.startsWith('oc_')) {
      const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/chats/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      nameCache[id] = data.data?.name || id;
      return nameCache[id];
    }
  } catch {}
  return id;
}

// ===== API Routes =====

// Config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// World state
app.get('/api/world', (req, res) => {
  res.json(getWorldState());
});

// Messages for a session
app.get('/api/messages/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const recentMinutes = parseInt(req.query.recentMinutes) || config.display?.recentMinutes || 10;
  const cutoffMs = Date.now() - recentMinutes * 60 * 1000;
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const before = req.query.before ? new Date(req.query.before).getTime() : null;

  // Find which agent this belongs to
  let filePath = null;
  for (const [agentName, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      if (sess.sessionId === sessionId) {
        filePath = path.join(AGENTS_DIR, agentName, 'sessions', sessionId + '.jsonl');
        break;
      }
    }
    if (filePath) break;
  }
  if (!filePath || !fs.existsSync(filePath)) return res.json({ messages: [], hasMore: false });

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const allMessages = [];
    for (const line of lines.slice(-500)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message') continue;
        const msg = entry.message || {};
        const ts = new Date(entry.timestamp).getTime();
        const parsed = { role: msg.role, timestamp: entry.timestamp, id: entry.id, _ts: ts };
        if (msg.role === 'user') {
          parsed.text = parseUserMessage(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        } else if (msg.role === 'assistant') {
          const ac = parseAssistantContent(msg.content);
          parsed.thinking = (!before || ts > cutoffMs) ? ac.thinking : ac.thinking;
          parsed.toolCalls = (!before || ts > cutoffMs) ? ac.toolCalls : ac.toolCalls;
          parsed.texts = ac.texts;
        } else if (msg.role === 'toolResult') {
          parsed.toolName = msg.toolName;
          parsed.result = (!before || ts > cutoffMs) ? parseToolResult(msg.content) : parseToolResult(msg.content);
        }
        allMessages.push(parsed);
      } catch {}
    }
    let messages;
    if (before) {
      messages = allMessages.filter(m => m._ts < before).slice(-limit);
    } else {
      messages = allMessages.slice(-limit);
    }
    messages.forEach(m => delete m._ts);
    res.json({ messages, hasMore: messages.length >= limit });
  } catch { res.json({ messages: [], hasMore: false }); }
});

// ===== Server-side Message Processing =====
// Returns pre-computed session state for frontend (no client-side processing needed)
app.get('/api/session-state/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const recentMinutes = parseInt(req.query.recentMinutes) || config.display?.recentMinutes || 10;
  const cutoffMs = Date.now() - recentMinutes * 60 * 1000;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const before = req.query.before ? new Date(req.query.before).getTime() : null;

  // Find which agent this belongs to
  let filePath = null;
  let sessionKey = null;
  for (const [agentName, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      if (sess.sessionId === sessionId) {
        filePath = path.join(AGENTS_DIR, agentName, 'sessions', sessionId + '.jsonl');
        sessionKey = key;
        break;
      }
    }
    if (filePath) break;
  }
  if (!filePath || !fs.existsSync(filePath)) {
    return res.json({ eventLog: [], state: 'idle', userMsg: '', userName: '', replyText: '', hasMore: false });
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const allMessages = [];
    
    for (const line of lines.slice(-500)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message') continue;
        const msg = entry.message || {};
        const ts = new Date(entry.timestamp).getTime();
        allMessages.push({ role: msg.role, timestamp: entry.timestamp, id: entry.id, _ts: ts, msg });
      } catch {}
    }

    // Get messages for display (with pagination)
    let displayMessages;
    if (before) {
      displayMessages = allMessages.filter(m => m._ts < before).slice(-limit);
    } else {
      displayMessages = allMessages.slice(-limit);
    }

    // Build eventLog (server-side, no frontend processing needed)
    const eventLog = [];
    for (const entry of displayMessages) {
      const { msg, timestamp: ts } = entry;
      if (msg.role === 'assistant') {
        const ac = parseAssistantContent(msg.content);
        if (ac.thinking) {
          eventLog.push({ type: 'think', text: ac.thinking, ts, fullContent: ac.thinking });
        }
        for (const tc of (ac.toolCalls || [])) {
          eventLog.push({ type: 'tool_use', text: tc.name, args: tc.args, ts });
        }
        if (ac.texts?.length) {
          // Don't add reply text to event log (user doesn't want it in thinking panel)
        }
      } else if (msg.role === 'toolResult') {
        const result = parseToolResult(msg.content);
        eventLog.push({
          type: 'tool_result',
          text: (msg.toolName || '?') + ' ✓',
          result: result,
          ts,
          fullContent: result
        });
      }
    }

    // Get last user message
    const lastUserMsg = allMessages.filter(m => m.msg.role === 'user').pop();
    let userMsg = '';
    let userName = '';
    if (lastUserMsg) {
      userMsg = parseUserMessage(
        typeof lastUserMsg.msg.content === 'string'
          ? lastUserMsg.msg.content
          : JSON.stringify(lastUserMsg.msg.content)
      );
      // Extract sender name from message
      const rawContent = typeof lastUserMsg.msg.content === 'string'
        ? lastUserMsg.msg.content
        : JSON.stringify(lastUserMsg.msg.content);
      const nameMatch = rawContent.match(/\]\s*(\S+?):\s*/);
      userName = nameMatch ? nameMatch[1] : '';
    }

    // Determine state
    const lastMsg = allMessages[allMessages.length - 1];
    let state = 'idle';
    if (lastMsg) {
      if (lastMsg.msg.role === 'assistant') {
        const ac = parseAssistantContent(lastMsg.msg.content);
        state = ac.texts?.length ? 'done' : 'thinking';
      } else if (lastMsg.msg.role === 'toolResult') {
        state = 'thinking';
      } else if (lastMsg.msg.role === 'user') {
        state = 'thinking';
      }
    }

    // Get last reply text
    const lastReply = allMessages.filter(m => {
      if (m.msg.role !== 'assistant') return false;
      const ac = parseAssistantContent(m.msg.content);
      return ac.texts?.length > 0;
    }).pop();
    let replyText = '';
    if (lastReply) {
      const ac = parseAssistantContent(lastReply.msg.content);
      replyText = ac.texts.join(' ');
    }

    res.json({
      eventLog,
      state,
      userMsg,
      userName,
      replyText,
      hasMore: displayMessages.length >= limit || (before ? allMessages.filter(m => m._ts < (before || Infinity)).length > displayMessages.length : false),
      oldestTimestamp: displayMessages.length > 0 ? displayMessages[0].timestamp : null,
      sessionKey
    });
  } catch (err) {
    res.json({ eventLog: [], state: 'idle', userMsg: '', userName: '', replyText: '', hasMore: false });
  }
});

// SSE
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  // Send initial world state
  res.write(`data: ${JSON.stringify({ type: 'init', data: getWorldState() })}\n\n`);

  req.on('close', () => sseClients.delete(res));
});

// Minion profiles
app.get('/api/minion-profiles', (req, res) => {
  res.json(loadProfiles());
});
app.post('/api/minion-profiles', (req, res) => {
  try {
    const existing = loadProfiles();
    for (const [key, profile] of Object.entries(req.body)) {
      existing[key] = { ...(existing[key] || {}), ...profile };
    }
    saveProfiles(existing);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Minion State Persistence =====
app.get('/api/state', (req, res) => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return res.json(JSON.parse(raw));
    }
  } catch {}
  res.json({ positions: {}, states: {}, openBubbles: [], fixedPanelSession: null });
});

app.post('/api/state', (req, res) => {
  try {
    const state = {
      positions: req.body.positions || {},
      states: req.body.states || {},
      openBubbles: req.body.openBubbles || [],
      fixedPanelSession: req.body.fixedPanelSession || null,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resolve Feishu name
app.get('/api/resolve/:id', async (req, res) => {
  const name = await resolveFeishuName(req.params.id);
  res.json({ id: req.params.id, name });
});

// ===== Config Watch =====
chokidar.watch(CONFIG_FILE, { ignoreInitial: true }).on('change', () => {
  log('info', 'Config changed, reloading');
  config = loadConfig();
  initAll();
});

// ===== Init =====
function initAll() {
  // Close existing watchers
  for (const [key, w] of Object.entries(watchedSessions)) {
    try { w.watcher.close(); } catch {}
  }
  Object.keys(watchedSessions).forEach(k => delete watchedSessions[k]);

  discoverAgents();

  // Start watching all session files
  for (const [agentName, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      // Filter by display config
      if (!config.display.showCron && sess.type === 'cron') continue;
      if (!config.display.showSubagent && sess.type === 'subagent') continue;
      watchSessionFile(agentName, key, sess.sessionId);
    }
  }

  broadcast({ type: 'init', data: getWorldState() });
  log('info', `Initialized: ${Object.keys(agentState).length} agents, ${Object.values(agentState).reduce((s, a) => s + Object.keys(a.sessions).length, 0)} sessions`);
}

// Also watch sessions.json files for new sessions
function watchSessionMaps() {
  try {
    const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of agentDirs) {
      const sessFile = path.join(AGENTS_DIR, dir.name, 'sessions', 'sessions.json');
      if (!fs.existsSync(sessFile)) continue;
      chokidar.watch(sessFile, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 1000 } }).on('change', () => {
        log('info', `sessions.json changed for ${dir.name}`);
        initAll();
      });
    }
  } catch {}
}

// Watch for new agent directories being created
try {
  chokidar.watch(AGENTS_DIR, { ignoreInitial: true, depth: 0, awaitWriteFinish: { stabilityThreshold: 500 } }).on('addDir', (dirPath) => {
    log('info', `New agent directory detected: ${dirPath}`);
    // Re-scan and re-init
    setTimeout(() => { watchSessionMaps(); initAll(); }, 1000);
  });
} catch (e) { log('error', 'Failed to watch agents dir: ' + e.message); }

// ===== Start =====
initAll();
watchSessionMaps();

const PORT = config.server?.port || 7777;
const HOST = config.server?.host || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  log('info', `🟢 OpenClaw Monitor v7 on http://${HOST}:${PORT}`);
});

// ===== WebSocket Server =====
const wss = new WebSocketServer({ server });
const wsClients = new Map(); // ws -> { userId, name }

wss.on('connection', (ws, req) => {
  log('info', 'WebSocket connected');
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'position') {
        // User position update via WebSocket
        const { userId, x, y, z, yaw, pitch, name } = msg;
        if (!userId) return;
        
        if (!connectedUsers[userId]) {
          connectedUsers[userId] = { color: userColors[userColorIdx++ % userColors.length] };
        }
        connectedUsers[userId].x = x;
        connectedUsers[userId].y = y;
        connectedUsers[userId].z = z;
        connectedUsers[userId].yaw = yaw;
        connectedUsers[userId].pitch = pitch;
        connectedUsers[userId].name = name || '匿名';
        connectedUsers[userId].lastSeen = Date.now();
        
        // Store client info
        wsClients.set(ws, { userId, name: name || '匿名' });
      }
    } catch (e) {
      log('error', 'WebSocket message error: ' + e.message);
    }
  });
  
  ws.on('close', () => {
    const client = wsClients.get(ws);
    if (client) {
      log('info', `WebSocket disconnected: ${client.name}`);
      wsClients.delete(ws);
    }
  });
  
  ws.on('error', (err) => {
    log('error', 'WebSocket error: ' + err.message);
  });
});

// Broadcast to WebSocket clients
function broadcastWS(data) {
  const msg = JSON.stringify(data);
  for (const [ws] of wsClients) {
    try {
      if (ws.readyState === 1) { // OPEN
        ws.send(msg);
      }
    } catch {}
  }
}

// CLI endpoint
app.post('/api/cli', (req, res) => {
  const cmd = (req.body.cmd || '').trim();
  if (!cmd.startsWith('openclaw')) return res.status(400).json({ error: 'Only openclaw commands allowed' });
  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.json({ error: stderr || err.message });
    res.json({ output: stdout || stderr || 'Done' });
  });
});

// ===== MCP Control Endpoints =====

function round2(n) { return Math.round(n * 100) / 100; }

// Track minion positions reported by the 3D client
const minionPositions = {}; // sessionKey -> { x, y, z, state }

// Client reports positions periodically
app.post('/api/minions/positions', (req, res) => {
  const positions = req.body.positions;
  if (positions && typeof positions === 'object') {
    for (const [sk, pos] of Object.entries(positions)) {
      minionPositions[sk] = pos;
    }
  }
  res.json({ ok: true });
});

// List all minions with positions, states, session info
app.get('/api/minions', (req, res) => {
  const result = [];
  const profiles = loadProfiles();
  for (const [agentName, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      const pos = minionPositions[key];
      result.push({
        sessionKey: key,
        sessionId: sess.sessionId,
        agentName,
        sessionType: sess.type,
        sessionLabel: sess.label,
        chineseName: (profiles[key] || {}).name || '',
        position: pos ? { x: round2(pos.x), y: round2(pos.y || 0), z: round2(pos.z) } : null,
        state: pos?.state || 'unknown',
        bounds: pos?.bounds || null,
      });
    }
  }
  res.json({ minions: result, count: result.length });
});

// Move a minion toward a target position (pathfinding walk)
app.post('/api/minions/:sessionKey/move', (req, res) => {
  const sk = req.params.sessionKey;
  const { x, z, speed } = req.body;
  if (x === undefined || z === undefined) return res.status(400).json({ error: 'Missing x or z' });

  broadcast({
    type: 'control',
    data: { action: 'move', sessionKey: sk, x: parseFloat(x), z: parseFloat(z), speed: speed ? parseFloat(speed) : undefined }
  });
  log('info', `MCP move: ${sk} → (${x}, ${z})`);
  res.json({ ok: true, action: 'move', sessionKey: sk, target: { x: parseFloat(x), z: parseFloat(z) } });
});

// Move a minion toward another minion
app.post('/api/minions/:sessionKey/move-to/:targetKey', (req, res) => {
  const sk = req.params.sessionKey;
  const tk = req.params.targetKey;
  const { offsetDistance } = req.body;

  broadcast({
    type: 'control',
    data: { action: 'move_to_minion', sessionKey: sk, targetKey: tk, offsetDistance: offsetDistance ? parseFloat(offsetDistance) : 1.5 }
  });
  log('info', `MCP move-to-minion: ${sk} → ${tk}`);
  res.json({ ok: true, action: 'move_to_minion', sessionKey: sk, target: tk });
});

// Teleport a minion instantly
app.post('/api/minions/:sessionKey/teleport', (req, res) => {
  const sk = req.params.sessionKey;
  const { x, z } = req.body;
  if (x === undefined || z === undefined) return res.status(400).json({ error: 'Missing x or z' });

  broadcast({
    type: 'control',
    data: { action: 'teleport', sessionKey: sk, x: parseFloat(x), z: parseFloat(z) }
  });
  log('info', `MCP teleport: ${sk} → (${x}, ${z})`);
  res.json({ ok: true, action: 'teleport', sessionKey: sk, position: { x: parseFloat(x), z: parseFloat(z) } });
});

// Play animation
app.post('/api/minions/:sessionKey/animate', (req, res) => {
  const sk = req.params.sessionKey;
  const { animation, duration } = req.body;
  const validAnims = ['jump', 'wave', 'dance', 'spin', 'nod', 'shake', 'bow', 'clap', 'think', 'celebrate'];
  if (!animation || !validAnims.includes(animation)) {
    return res.status(400).json({ error: `Invalid animation. Valid: ${validAnims.join(', ')}` });
  }

  broadcast({
    type: 'control',
    data: { action: 'animate', sessionKey: sk, animation, duration: duration ? parseFloat(duration) : 2.0 }
  });
  log('info', `MCP animate: ${sk} → ${animation}`);
  res.json({ ok: true, action: 'animate', sessionKey: sk, animation, duration: duration || 2.0 });
});

// Show speech bubble
app.post('/api/minions/:sessionKey/say', (req, res) => {
  const sk = req.params.sessionKey;
  const { text, duration, sender } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  broadcast({
    type: 'control',
    data: {
      action: 'say', sessionKey: sk,
      text: text.slice(0, 500),
      duration: duration ? parseFloat(duration) : 5.0,
      sender: sender || '🤖 MCP'
    }
  });
  log('info', `MCP say: ${sk} "${text.slice(0, 60)}"`);
  res.json({ ok: true, action: 'say', sessionKey: sk, text: text.slice(0, 500) });
});

// Get detailed info about a specific minion
app.get('/api/minions/:sessionKey', (req, res) => {
  const sk = req.params.sessionKey;
  for (const [agentName, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      if (key === sk) {
        const profiles = loadProfiles();
        const profile = profiles[sk] || {};
        return res.json({
          sessionKey: key,
          sessionId: sess.sessionId,
          agentName,
          type: sess.type,
          label: sess.label,
          displayName: sess.displayName,
          channel: sess.channel,
          chatType: sess.chatType,
          profile,
          controlState: null,
        });
      }
    }
  }
  res.status(404).json({ error: 'Minion not found' });
});

// Batch control: send multiple commands at once
app.post('/api/minions/batch', (req, res) => {
  const commands = req.body.commands;
  if (!Array.isArray(commands)) return res.status(400).json({ error: 'Expected { commands: [...] }' });

  const results = [];
  for (const cmd of commands.slice(0, 20)) { // max 20 per batch
    if (!cmd.action || !cmd.sessionKey) {
      results.push({ error: 'Missing action or sessionKey', cmd });
      continue;
    }
    broadcast({ type: 'control', data: cmd });
    results.push({ ok: true, action: cmd.action, sessionKey: cmd.sessionKey });
  }
  log('info', `MCP batch: ${results.length} commands`);
  res.json({ results, count: results.length });
});

// Make all minions in an agent do something together
app.post('/api/agents/:agentName/action', (req, res) => {
  const agentName = req.params.agentName;
  const { action, animation, text, duration } = req.body;

  const agent = agentState[agentName];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const sessionKeys = Object.keys(agent.sessions);
  if (action === 'celebrate') {
    for (const sk of sessionKeys) {
      const anims = ['jump', 'dance', 'clap', 'celebrate'];
      const pick = anims[Math.floor(Math.random() * anims.length)];
      broadcast({ type: 'control', data: { action: 'animate', sessionKey: sk, animation: pick, duration: 3.0 } });
    }
  } else if (action === 'gather') {
    // Gather all minions to the center of their continent
    for (const sk of sessionKeys) {
      broadcast({ type: 'control', data: { action: 'move_to_minion', sessionKey: sk, targetKey: sessionKeys[0], offsetDistance: 1.5 } });
    }
  } else if (action === 'animate') {
    if (!animation) return res.status(400).json({ error: 'Missing animation' });
    for (const sk of sessionKeys) {
      broadcast({ type: 'control', data: { action: 'animate', sessionKey: sk, animation, duration: duration || 2.0 } });
    }
  } else if (action === 'say') {
    if (!text) return res.status(400).json({ error: 'Missing text' });
    for (const sk of sessionKeys) {
      broadcast({ type: 'control', data: { action: 'say', sessionKey: sk, text, duration: duration || 5.0, sender: '🤖 Agent' } });
    }
  } else {
    return res.status(400).json({ error: `Unknown action. Valid: celebrate, gather, animate, say` });
  }

  log('info', `MCP agent action: ${agentName} → ${action}`);
  res.json({ ok: true, action, agentName, minionCount: sessionKeys.length });
});

// Direct chat: inject message via OpenClaw Gateway API
app.post('/api/chat/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Empty message' });

  let agentName = null, sessionKey = null;
  for (const [an, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      if (sess.sessionId === sessionId) {
        agentName = an; sessionKey = key;
        break;
      }
    }
    if (sessionKey) break;
  }
  if (!sessionKey) return res.status(404).json({ error: 'Session not found' });

  // Broadcast to SSE clients immediately so the bubble updates
  broadcast({
    type: 'event',
    data: {
      type: 'user_msg',
      agent: agentName,
      session: sessionKey,
      msg: text,
      userName: '🖥️ Monitor',
      ts: new Date().toISOString(),
    }
  });

  // Send via Gateway API (same as `openclaw agent --session-id ... --message ...`)
  const gwPort = config.gateway?.port || 18789;
  const gwUrl = `http://127.0.0.1:${gwPort}/api/agent/message`;

  log('info', `Direct chat → session=${sessionId}, text="${text.slice(0, 80)}"`);

  // Use async exec to avoid blocking the response
  const safeText = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const cmd = `openclaw agent --session-id "${sessionId}" --message "[Direct Chat from Monitor] ${safeText}" --json`;
  exec(cmd, { timeout: 60000, env: { ...process.env } }, (err, stdout, stderr) => {
    if (err) {
      log('error', `Direct chat agent error: ${stderr || err.message}`);
    } else {
      log('info', `Direct chat agent response: ${(stdout || '').slice(0, 200)}`);
    }
  });

  res.json({ ok: true, method: 'gateway' });
});

// Abort: terminate a session's active run via Gateway API
app.post('/api/sessions/:sessionId/abort', (req, res) => {
  const sessionId = req.params.sessionId;

  // Find the session key from agentState
  let sessionKey = null;
  for (const [, info] of Object.entries(agentState)) {
    for (const [key, sess] of Object.entries(info.sessions)) {
      if (sess.sessionId === sessionId) {
        sessionKey = key;
        break;
      }
    }
    if (sessionKey) break;
  }
  if (!sessionKey) return res.status(404).json({ error: 'Session not found' });

  log('info', `Abort → session=${sessionId}, key=${sessionKey}`);

  const cmd = `openclaw gateway call chat.abort --params '${JSON.stringify({ sessionKey })}' --json`;
  exec(cmd, { timeout: 10000, env: { ...process.env } }, (err, stdout, stderr) => {
    if (err) {
      log('error', `Abort error: ${stderr || err.message}`);
      return res.status(500).json({ error: stderr || err.message });
    }
    try {
      const result = JSON.parse(stdout || '{}');
      log('info', `Abort result: ${JSON.stringify(result)}`);
      res.json({ ok: true, ...result });
    } catch {
      res.json({ ok: true, raw: stdout });
    }
  });
});
