const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');
const YAML = require('yaml');
const { execSync, exec } = require('child_process');
const { WebSocketServer } = require('ws');
const auth = require('./auth');

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

// ===== Express App =====
const app = express();
app.use(express.json());

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').filter(Boolean)
      .map(c => c.trim().split('='))
      .map(([k, ...v]) => [k.trim(), v.join('=')])
  );
}
function setCookie(res, name, value, maxAge = 7 * 86400) {
  res.setHeader('Set-Cookie', `${name}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
}
function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; Path=/; Max-Age=0`);
}


// Generate admin path (random slug, persists across restarts)
const ADMIN_PATH_FILE = path.join(LOG_DIR, 'admin-path.txt');
let adminPath;
try {
  adminPath = fs.readFileSync(ADMIN_PATH_FILE, 'utf-8').trim();
} catch {
  adminPath = '/admin/' + crypto.randomBytes(8).toString('hex');
  try { fs.writeFileSync(ADMIN_PATH_FILE, adminPath); } catch {}
}

// Serve admin.html at secret path + keep /admin for backwards compat
function serveAdmin(req, res) {
  // Skip auth check when auth is disabled globally
  if (config.auth?.enabled === false) {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  const cookies = parseCookies(req);
  const session = auth.getSession(cookies.sessionToken);
  if (!session) return res.redirect('/login.html');
  const user = auth.getUserById(session.user_id);
  if (!user || user.role !== 'admin') return res.status(403).send('Forbidden — Admin only');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
}
app.get(adminPath, serveAdmin);

app.use(express.static(path.join(__dirname, 'public')));

// ===== Auth Middleware =====
// Applied to all /api/* routes except /api/auth/*
// When auth.enabled=false in config.yaml, a virtual admin user is attached so requireAdmin still works
const VIRTUAL_ADMIN = { id: 'local', username: 'local', role: 'admin', email: '' };
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/auth/')) return next(); // public auth endpoints

  // If auth is explicitly disabled, attach a virtual admin and skip token check
  if (config.auth?.enabled === false) {
    req.user = VIRTUAL_ADMIN;
    req.sessionToken = null;
    return next();
  }

  const cookies = parseCookies(req);
  const token = cookies.sessionToken || req.headers['x-session-token'];
  const session = auth.getSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized', needsAuth: true });
  
  const user = auth.getUserById(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found', needsAuth: true });
  
  req.user = user;
  req.sessionToken = token;
  next();
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ===== Auth API =====

// Check if any users exist (frontend decides to show register vs login)
app.get('/api/auth/status', (req, res) => {
  // When auth is disabled, always report as authenticated (virtual admin)
  if (config.auth?.enabled === false) {
    return res.json({
      hasUsers: true,
      authenticated: true,
      user: { id: 'local', username: 'local', role: 'admin' },
    });
  }
  const hasUsers = auth.getUserCount() > 0;
  const cookies = parseCookies(req);
  const session = auth.getSession(cookies.sessionToken);
  const user = session ? auth.getUserById(session.user_id) : null;
  res.json({
    hasUsers,
    authenticated: !!user,
    user: user ? { id: user.id, username: user.username, role: user.role } : null,
  });
});

// Register (first user = admin, subsequent = needs admin session)
app.post('/api/auth/register', (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });

  const isFirst = auth.getUserCount() === 0;

  if (!isFirst) {
    // Subsequent registrations require admin session
    const cookies = parseCookies(req);
    const session = auth.getSession(cookies.sessionToken);
    const caller = session ? auth.getUserById(session.user_id) : null;
    if (!caller || caller.role !== 'admin') {
      return res.status(403).json({ error: '注册需要管理员授权' });
    }
  }

  if (auth.getUserByUsername(username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  try {
    const role = isFirst ? 'admin' : 'user';
    const user = auth.createUser(username, password, role, email || '');
    if (isFirst) {
      // First admin gets full access
      auth.setUserPermissions(user.id, [{ type: 'all', resourceId: null }]);
    }
    const token = auth.createSession(user.id);
    setCookie(res, 'sessionToken', token);
    log('info', `User registered: ${username} (${role})`);
    res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role }, isFirst });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });

  const user = auth.getUserByUsername(username);
  if (!user || !auth.verifyPassword(password, user.pwd_hash, user.salt)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  auth.touchLogin(user.id);
  const token = auth.createSession(user.id);
  setCookie(res, 'sessionToken', token);
  log('info', `User login: ${username}`);
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sessionToken) auth.deleteSession(cookies.sessionToken);
  clearCookie(res, 'sessionToken');
  res.json({ ok: true });
});

// Current user
app.get('/api/auth/me', (req, res) => {
  // When auth is disabled, req.user is not set by the middleware (auth routes are skipped)
  if (config.auth?.enabled === false) {
    return res.json({ user: { id: 'local', username: 'local', role: 'admin', email: '' } });
  }
  const cookies = parseCookies(req);
  const token = cookies.sessionToken || req.headers['x-session-token'];
  const session = auth.getSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized', needsAuth: true });
  const user = auth.getUserById(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found', needsAuth: true });
  res.json({ user: { id: user.id, username: user.username, role: user.role, email: user.email } });
});

// ===== Admin API =====

// List all users with permissions
app.get('/api/admin/path', requireAdmin, (req, res) => {
  res.json({ path: adminPath });
});
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = auth.getAllUsers().map(u => ({
    ...u,
    permissions: auth.getUserPermissions(u.id),
  }));
  res.json({ users });
});

// Create user
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, role, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
  if (auth.getUserByUsername(username)) return res.status(409).json({ error: 'Username taken' });
  try {
    const user = auth.createUser(username, password, role || 'user', email || '');
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  auth.deleteUser(req.params.id);
  res.json({ ok: true });
});

// Update user role
app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'user', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  auth.updateUserRole(req.params.id, role);
  res.json({ ok: true });
});

// Update user permissions
app.put('/api/admin/users/:id/permissions', requireAdmin, (req, res) => {
  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions must be array' });
  auth.setUserPermissions(req.params.id, permissions);
  res.json({ ok: true });
});

// Admin: list all agents+sessions for permission assignment
app.get('/api/admin/world', requireAdmin, (req, res) => {
  res.json(getWorldState());
});


// ===== Logging =====
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const LOG_FILE = path.join(LOG_DIR, 'monitor.log');
const LOG_MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file
const LOG_MAX_ARCHIVES = 3;

function rotateLogs() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_BYTES) return;
    // Rotate: .log.2 -> .log.3, .log.1 -> .log.2, .log -> .log.1
    for (let i = LOG_MAX_ARCHIVES - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      const to = `${LOG_FILE}.${i + 1}`;
      try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch {}
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {}
}

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  try {
    rotateLogs();
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
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
  // Sanitize chat content: strip HTML tags to prevent XSS via chat messages
  const sanitize = s => (s || '').replace(/<[^>]*>/g, '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const safeText = sanitize(text).slice(0, 500);
  const safeName = sanitize(name || '匿名').slice(0, 50);
  const msg = { userId, name: safeName, text: safeText, time: Date.now() };
  chatMessages.push(msg);
  if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
  broadcast({ type: 'chat', data: { chat: msg } });
  broadcastWS({ type: 'chat', data: { chat: msg } });
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
      recordSessionEvent(sessionKey, 'user_msg', senderName ? `💬 ${senderName}` : '💬 msg');
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
        recordSessionEvent(sessionKey, 'thinking', '🤔 thinking');
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
        recordSessionEvent(sessionKey, 'tool_use', `🔧 ${tc.name}`);
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
        recordSessionEvent(sessionKey, 'reply_text', '💬 reply');
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
      recordSessionEvent(sessionKey, 'tool_result', `✅ ${toolName}`);
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
  const world = getWorldState();
  if (!req.user) return res.json(world);
  res.json(auth.filterWorldState(req.user.id, world));
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
          eventLog.push({
            type: 'reply_text',
            text: ac.texts.join(' ').slice(0, 300),
            ts,
            fullContent: ac.texts.join('\n')
          });
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

// ===== Agent Stats API =====
// Returns stats computed from full JSONL: turn count, tool counts, avg latency, timeline
app.get('/api/agent-stats/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
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
  if (!filePath || !fs.existsSync(filePath)) return res.json({ stats: null });

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);

    let userTurns = 0, assistantTurns = 0, toolCalls = 0, toolResults = 0, totalChars = 0;
    const toolCounts = {};
    const timeline = []; // last 50 events with ts
    let firstTs = null, lastTs = null;
    const latencies = []; // user→assistant latencies
    let lastUserTs = null;

    // For turn-by-turn latency
    const messages = [];
    for (const line of lines.slice(-1000)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message') continue;
        const ts = new Date(entry.timestamp).getTime();
        if (!firstTs) firstTs = ts;
        lastTs = ts;
        const msg = entry.message || {};
        messages.push({ role: msg.role, ts, content: msg.content, toolName: msg.toolName });
      } catch {}
    }

    for (const m of messages) {
      if (m.role === 'user') {
        userTurns++;
        lastUserTs = m.ts;
        const text = parseUserMessage(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
        if (timeline.length < 50) timeline.push({ type: 'user_msg', label: text.slice(0, 60), ts: m.ts });
      } else if (m.role === 'assistant') {
        assistantTurns++;
        if (lastUserTs) { latencies.push(m.ts - lastUserTs); lastUserTs = null; }
        const ac = parseAssistantContent(m.content);
        for (const tc of ac.toolCalls) {
          toolCalls++;
          toolCounts[tc.name] = (toolCounts[tc.name] || 0) + 1;
          if (timeline.length < 50) timeline.push({ type: 'tool_use', label: tc.name, ts: m.ts });
        }
        if (ac.texts.length) {
          totalChars += ac.texts.join('').length;
          if (timeline.length < 50) timeline.push({ type: 'reply_text', label: ac.texts.join('').slice(0, 60), ts: m.ts });
        }
        if (ac.thinking && timeline.length < 50) timeline.push({ type: 'thinking', label: '💭 thinking', ts: m.ts });
      } else if (m.role === 'toolResult') {
        toolResults++;
        if (timeline.length < 50) timeline.push({ type: 'tool_result', label: (m.toolName || '?') + ' ✓', ts: m.ts });
      }
    }

    const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0) / latencies.length) : 0;
    const durationMs = (firstTs && lastTs) ? (lastTs - firstTs) : 0;

    // Top tools sorted
    const topTools = Object.entries(toolCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,cnt])=>({ name, cnt }));

    res.json({
      stats: {
        userTurns, assistantTurns, toolCalls, toolResults, totalChars,
        avgLatencyMs, durationMs, firstTs, lastTs,
        topTools,
        timeline: timeline.slice(-30), // last 30 events
        messageCount: messages.length,
      }
    });
  } catch (err) {
    res.json({ stats: null, error: err.message });
  }
});

// SSE (requires login)
app.get('/api/events', (req, res) => {
  // Auth check via query param (SSE can't send headers easily)
  // Skip token check when auth is disabled globally
  if (config.auth?.enabled !== false) {
    const token = req.query.token || req.headers['x-session-token'];
    const session = auth.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
  }

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
app.post('/api/minion-profiles', requireAdmin, (req, res) => {
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
  log('info', `🛡️ Admin panel: http://${HOST}:${PORT}${adminPath}`);
});

// ===== WebSocket Server =====
const wss = new WebSocketServer({ server });
const wsClients = new Map(); // ws -> { userId, name }

wss.on('connection', (ws, req) => {
  // Auth check via query param — skip when auth is disabled globally
  if (config.auth?.enabled !== false) {
    const urlParams = new URLSearchParams(req.url.replace(/^[^?]*/, ''));
    const token = urlParams.get('token');
    const session = auth.getSession(token);
    if (!session) {
      log('info', 'WebSocket rejected: no valid token');
      ws.close(4001, 'Unauthorized');
      return;
    }
    log('info', `WebSocket connected (user: ${session.user_id})`);
  } else {
    log('info', 'WebSocket connected (auth disabled)');
  }
  
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

// CLI endpoint (admin only, strict whitelist — no shell interpretation)
// Allowed subcommands + their optional args (must match the FULL command, no extra tokens)
const ALLOWED_CLI_SUBCOMMANDS = [
  ['status'],
  ['gateway', 'status'],
  ['gateway', 'start'],
  ['gateway', 'stop'],
  ['gateway', 'restart'],
  ['agent', 'list'],
  ['help'],
];
app.post('/api/cli', requireAdmin, (req, res) => {
  const raw = (req.body.cmd || '').trim();
  // Split on whitespace; first token must be 'openclaw'
  const parts = raw.split(/\s+/);
  if (parts[0] !== 'openclaw') return res.status(400).json({ error: 'Only openclaw commands allowed' });
  const args = parts.slice(1);
  // Exact match against allowlist (no extra tokens, no shell operators)
  const allowed = ALLOWED_CLI_SUBCOMMANDS.some(
    allowed => allowed.length === args.length && allowed.every((a, i) => a === args[i])
  );
  if (!allowed) return res.status(403).json({ error: 'Command not in allowlist' });
  // Use spawn (not exec) so no shell is involved — prevents && ; | injection
  const { spawn } = require('child_process');
  const child = spawn('openclaw', args, { timeout: 30000 });
  let out = '', err = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => err += d);
  child.on('close', code => {
    if (code !== 0) return res.json({ error: err || `exit ${code}` });
    res.json({ output: out || err || 'Done' });
  });
  child.on('error', e => res.json({ error: e.message }));
});

// ===== MCP Control Endpoints =====

function round2(n) { return Math.round(n * 100) / 100; }

// Track minion positions reported by the 3D client
const minionPositions = {}; // sessionKey -> { x, y, z, state }

// ===== Trajectory Recording =====
// Store position history: sessionKey -> Array<{ts, x, y, z, state, event?}>
const TRAJECTORY_MAX_POINTS = 3600; // ~1 hour at 1pt/sec
const trajectoryHistory = {}; // sessionKey -> [{ts, x, z, state, event?}]

function recordTrajectoryPoint(sessionKey, pos, event = null) {
  if (!trajectoryHistory[sessionKey]) trajectoryHistory[sessionKey] = [];
  const arr = trajectoryHistory[sessionKey];
  const point = {
    ts: Date.now(),
    x: Math.round(pos.x * 10) / 10,
    z: Math.round((pos.z || 0) * 10) / 10,
    state: pos.state || 'idle',
  };
  if (event) point.event = event;
  // Deduplicate: skip if position unchanged and no event
  const last = arr[arr.length - 1];
  if (!event && last && last.x === point.x && last.z === point.z && last.state === point.state) return;
  arr.push(point);
  // Trim to max
  if (arr.length > TRAJECTORY_MAX_POINTS) arr.splice(0, arr.length - TRAJECTORY_MAX_POINTS);
}

// Also record events (tool calls, replies) into the trajectory timeline
// Called from processLine (broadcast events already happen there)
function recordSessionEvent(sessionKey, eventType, label) {
  const pos = minionPositions[sessionKey];
  if (!pos) return;
  recordTrajectoryPoint(sessionKey, pos, { type: eventType, label });
}

// Hook into broadcast to capture events for trajectory timeline
const _origBroadcast = broadcast;
// We intercept events after broadcast is defined; done below after processLine is patched

// Client reports positions periodically
app.post('/api/minions/positions', (req, res) => {
  const positions = req.body.positions;
  if (positions && typeof positions === 'object') {
    for (const [sk, pos] of Object.entries(positions)) {
      minionPositions[sk] = pos;
      recordTrajectoryPoint(sk, pos);
    }
  }
  res.json({ ok: true });
});

// Get trajectory for a session
app.get('/api/trajectory/:sessionKey', (req, res) => {
  const sk = req.params.sessionKey;
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const points = (trajectoryHistory[sk] || []).filter(p => p.ts >= since);
  res.json({ sessionKey: sk, points, count: points.length });
});

// Get trajectories for all sessions (for overview)
app.get('/api/trajectories', (req, res) => {
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const result = {};
  for (const [sk, arr] of Object.entries(trajectoryHistory)) {
    result[sk] = arr.filter(p => p.ts >= since);
  }
  res.json({ trajectories: result });
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
app.post('/api/minions/:sessionKey/move', requireAdmin, (req, res) => {
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
app.post('/api/minions/:sessionKey/move-to/:targetKey', requireAdmin, (req, res) => {
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
app.post('/api/minions/:sessionKey/teleport', requireAdmin, (req, res) => {
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
app.post('/api/minions/:sessionKey/animate', requireAdmin, (req, res) => {
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
app.post('/api/minions/:sessionKey/say', requireAdmin, (req, res) => {
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
app.post('/api/minions/batch', requireAdmin, (req, res) => {
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
app.post('/api/agents/:agentName/action', requireAdmin, (req, res) => {
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

// Direct chat: inject message via OpenClaw Gateway API (admin only)
app.post('/api/chat/:sessionId', requireAdmin, (req, res) => {
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
  // Pass sessionId and message as separate arguments (no shell interpolation) to prevent injection
  const { spawn } = require('child_process');
  const fullMsg = `[Direct Chat from Monitor] ${text}`;
  const child = spawn('openclaw', ['agent', '--session-id', sessionId, '--message', fullMsg, '--json'], {
    timeout: 60000,
    env: { ...process.env },
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d);
  child.stderr.on('data', d => stderr += d);
  child.on('close', code => {
    if (code !== 0) {
      log('error', `Direct chat agent error: ${stderr.slice(0, 200)}`);
    } else {
      log('info', `Direct chat agent response: ${stdout.slice(0, 200)}`);
    }
  });

  res.json({ ok: true, method: 'gateway' });
});

// Abort: terminate a session's active run via Gateway API (admin only)
app.post('/api/sessions/:sessionId/abort', requireAdmin, (req, res) => {
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
