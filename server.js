const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const YAML = require('yaml');

// ===== Config =====
const CONFIG_FILE = path.join(__dirname, 'config.yaml');
const LOG_DIR = '/tmp/openclaw';

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

// ===== Express App =====
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Logging =====
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(LOG_DIR, 'monitor.log'), line + '\n'); } catch {}
}

// ===== SSE Clients =====
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
  return msg.slice(0, 500);
}

function parseAssistantContent(content) {
  const result = { thinking: '', toolCalls: [], texts: [] };
  if (!Array.isArray(content)) return result;
  for (const item of content) {
    if (typeof item === 'string') {
      result.texts.push(item.slice(0, 300));
      continue;
    }
    if (item.type === 'thinking') {
      result.thinking = (item.thinking || '').slice(0, 300);
    } else if (item.type === 'toolCall') {
      result.toolCalls.push({
        name: item.name || '?',
        args: JSON.stringify(item.arguments || {}).slice(0, 200),
      });
    } else if (item.type === 'text') {
      result.texts.push((item.text || '').slice(0, 300));
    }
  }
  return result;
}

function parseToolResult(content) {
  if (!Array.isArray(content)) return '';
  for (const item of content) {
    if (typeof item === 'string') return item.slice(0, 200);
    if (item.type === 'text') return (item.text || '').slice(0, 200);
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

  const watcher = chokidar.watch(filePath, { persistent: true, awaitWriteFinish: { stabilityThreshold: 200 } });

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
    }, 300);
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
        broadcast({
          type: 'event',
          data: {
            type: 'reply_text',
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
  if (!filePath || !fs.existsSync(filePath)) return res.json({ messages: [] });

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const messages = [];
    // Parse last N message entries
    for (const line of lines.slice(-50)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message') continue;
        const msg = entry.message || {};
        const parsed = {
          role: msg.role,
          timestamp: entry.timestamp,
          id: entry.id,
        };
        if (msg.role === 'user') {
          parsed.text = parseUserMessage(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        } else if (msg.role === 'assistant') {
          const ac = parseAssistantContent(msg.content);
          parsed.thinking = ac.thinking;
          parsed.toolCalls = ac.toolCalls;
          parsed.texts = ac.texts;
        } else if (msg.role === 'toolResult') {
          parsed.toolName = msg.toolName;
          parsed.result = parseToolResult(msg.content);
        }
        messages.push(parsed);
      } catch {}
    }
    res.json({ messages });
  } catch { res.json({ messages: [] }); }
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

// ===== Start =====
initAll();
watchSessionMaps();

const PORT = config.server?.port || 7777;
const HOST = config.server?.host || '0.0.0.0';
app.listen(PORT, HOST, () => {
  log('info', `🟢 OpenClaw Monitor v7 on http://${HOST}:${PORT}`);
});

// CLI endpoint
app.post('/api/cli', (req, res) => {
  const cmd = (req.body.cmd || '').trim();
  if (!cmd.startsWith('openclaw')) return res.status(400).json({ error: 'Only openclaw commands allowed' });
  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.json({ error: stderr || err.message });
    res.json({ output: stdout || stderr || 'Done' });
  });
});
