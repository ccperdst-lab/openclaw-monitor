const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { exec } = require('child_process');

const app = express();
const PORT = 7777;
const CONFIG_PATH = path.resolve(process.env.HOME, '.openclaw/openclaw.json');
const LOG_DIR = '/tmp/openclaw';
const AGENTS_DIR = path.resolve(process.env.HOME, '.openclaw/agents');
// Support multiple agents' session directories
function getSessionDirs() {
  const dirs = [];
  try {
    for (const name of fs.readdirSync(AGENTS_DIR)) {
      const sessDir = path.join(AGENTS_DIR, name, 'sessions');
      if (fs.existsSync(sessDir)) dirs.push({ agent: name === 'main' ? 'default' : name, dir: sessDir });
    }
  } catch {}
  return dirs.length > 0 ? dirs : [{ agent: 'default', dir: path.join(AGENTS_DIR, 'main', 'sessions') }];
}

let state = { agents: [], channels: [], bindings: [], gateway: {} };
const sseClients = new Set();

// Build agents + sessions dynamically from sessionMap
function buildAgentState() {
  const config = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; } })();
  const d = config.agents?.defaults || {};
  const bindings = config.bindings || [];

  // Collect all known agent IDs
  const agentIds = new Set(['default']);
  for (const b of bindings) {
    const aid = b.agentId || b.agent;
    if (aid) agentIds.add(aid);
  }
  // Also from session keys
  for (const key of Object.keys(sessionMap)) {
    const parts = key.split(':');
    if (parts[0] === 'agent') agentIds.add(parts[1] === 'main' ? 'default' : parts[1]);
  }

  const agentListCfg = {};
  for (const a of (config.agents?.list || [])) agentListCfg[a.id] = a;

  // Build agent objects with their sessions
  state.agents = [];
  for (const aid of agentIds) {
    const acfg = agentListCfg[aid] || {};
    const agent = {
      id: aid,
      model: acfg.model?.primary || d.model?.primary || '?',
      workspace: acfg.workspace || d.workspace || '?',
      sessions: []
    };

    // Find all sessions belonging to this agent
    for (const [key, val] of Object.entries(sessionMap)) {
      const parts = key.split(':');
      const sessionAgent = parts[0] === 'agent' ? (parts[1] === 'main' ? 'default' : parts[1]) : 'default';
      if (sessionAgent !== aid) continue;

      // Parse session type from key
      let sessionType = 'session';
      let sessionName = key;
      if (key.includes(':feishu:group:')) { sessionType = 'group'; sessionName = '💬 群聊'; }
      else if (key.includes(':feishu:dm:')) { sessionType = 'dm'; sessionName = '👤 私信'; }
      else if (key.includes(':cron:')) { sessionType = 'cron'; sessionName = '⏰ 定时任务'; }
      else if (key.includes(':subagent:')) { sessionType = 'subagent'; sessionName = '🤖 子任务'; }
      else if (key.endsWith(':main')) { sessionType = 'main'; sessionName = '🏠 主会话'; }

      agent.sessions.push({
        key,
        id: val.sessionId,
        type: sessionType,
        name: sessionName
      });
    }
    state.agents.push(agent);
  }

  // Channels (for sidebar)
  state.channels = [];
  for (const [name, ch] of Object.entries(config.channels || {})) {
    if (ch.enabled !== false) state.channels.push({ name, enabled: true, type: name });
  }
  state.bindings = bindings;
  state.gateway = { port: config.gateway?.port || 18789, bind: config.gateway?.bind || '?' };
}

// ===== Config =====
function readConfig() {
  try {
    buildAgentState();
    broadcast({ type: 'config', data: state });
  } catch (e) { console.error('Config error:', e.message); }
}

// ===== Session tracking =====
let sessionMap = {}; // sessionKey -> { sessionId, lastUserMsg, lastThinking, lastTool }
let sessionFiles = {};

function loadSessionMap() {
  try {
    for (const { agent, dir } of getSessionDirs()) {
      const mapPath = path.join(dir, 'sessions.json');
      if (fs.existsSync(mapPath)) {
        const raw = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
        for (const [key, val] of Object.entries(raw)) {
          if (!sessionMap[key]) sessionMap[key] = { sessionId: val.sessionId, agent, lastUserMsg: '', lastThinking: '', lastTool: '' };
          sessionMap[key].sessionId = val.sessionId;
          sessionMap[key].agent = agent;
        }
      }
    }
  } catch {}
}

function parseSessionEntry(line) {
  try {
    const d = JSON.parse(line);
    if (d.type !== 'message') return null;
    const msg = d.message || {};
    const role = msg.role;
    const content = msg.content;
    let result = { role, texts: [], thinking: '', toolName: '', toolArgs: '' };

    if (typeof content === 'string') {
      result.texts.push(content.slice(0, 300));
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === 'string') { result.texts.push(c.slice(0, 300)); continue; }
        if (c.type === 'text') result.texts.push((c.text || '').slice(0, 300));
        if (c.type === 'thinking') result.thinking = (c.thinking || '').slice(0, 300);
        if (c.type === 'toolCall') { result.toolName = c.name || ''; result.toolArgs = JSON.stringify(c.arguments || {}).slice(0, 200); }
      }
    }
    return result;
  } catch { return null; }
}

function watchSession(sessionKey, sessionId) {
  // Find the right sessions directory for this session
  const agentInfo = sessionMap[sessionKey];
  const agentName = agentInfo?.agent || 'default';
  const sessDirs = getSessionDirs();
  const sessDir = sessDirs.find(d => d.agent === agentName)?.dir || sessDirs[0].dir;
  const filePath = path.join(sessDir, sessionId + '.jsonl');
  if (!fs.existsSync(filePath)) { console.log('Session file not found:', filePath); return; }
  if (sessionFiles[sessionKey]) return;

  let lastSize = fs.statSync(filePath).size;
  console.log('Watching session:', sessionKey, '->', sessionId, 'size:', lastSize);
  const watcher = chokidar.watch(filePath, { persistent: true });

  watcher.on('change', () => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= lastSize) { lastSize = 0; return; }
      const stream = fs.createReadStream(filePath, { start: lastSize, encoding: 'utf-8' });
      let buf = '';
      stream.on('data', c => buf += c);
      stream.on('end', () => {
        lastSize = stat.size;
        const lines = buf.split('\n').filter(Boolean);
        console.log('Session', sessionKey, 'got', lines.length, 'new lines');
        lines.forEach(line => {
          const parsed = parseSessionEntry(line);
          if (!parsed) return;
          if (!sessionMap[sessionKey]) sessionMap[sessionKey] = { sessionId };
          const sm = sessionMap[sessionKey];

          if (parsed.role === 'user') {
            let rawText = parsed.texts.join(' ');
            // Extract sender_id from metadata block
            const senderMatch = rawText.match(/"sender_id":\s*"(ou_\w+)"/);
            // Also try to extract sender name from the @ mention in the message
            const atMatch = rawText.match(/<at[^>]*>([^<]*)<\/at>/);
            sm.lastUserMsg = cleanUserMessage(rawText);
            sm.lastUserName = atMatch?.[1] || '';
            if (senderMatch && !sm.lastUserName) {
              resolveFeishuName(senderMatch[1]).then(name => {
                sm.lastUserName = name;
                console.log('Resolved:', senderMatch[1], '->', name);
                broadcast({ type: 'event', data: { type: 'user_msg', session: sessionKey, agentId: agentFromSession(sessionKey), msg: sm.lastUserMsg, userName: name, ts: new Date().toISOString() }});
              }).catch(e => console.error('Name resolve error:', e.message));
            } else {
              broadcast({ type: 'event', data: { type: 'user_msg', session: sessionKey, agentId: agentFromSession(sessionKey), msg: sm.lastUserMsg, userName: sm.lastUserName, ts: new Date().toISOString() }});
            }
          }
          if (parsed.role === 'assistant') {
            if (parsed.thinking) {
              sm.lastThinking = parsed.thinking.slice(0, 200);
              broadcast({ type: 'event', data: { type: 'thinking_content', session: sessionKey, agentId: agentFromSession(sessionKey), thinking: sm.lastThinking, ts: new Date().toISOString() }});
            }
            if (parsed.toolName) {
              sm.lastTool = parsed.toolName;
              broadcast({ type: 'event', data: { type: 'tool_detail', session: sessionKey, agentId: agentFromSession(sessionKey), tool: parsed.toolName, args: parsed.toolArgs, ts: new Date().toISOString() }});
            }
          }
        });
      });
    } catch (e) { console.error('Session read error:', e.message); }
  });

  sessionFiles[sessionKey] = { watcher, path: filePath };
}

// ===== Log watching =====
function getLogPath() {
  const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return path.join(LOG_DIR, `openclaw-${d}.log`);
}

function parseLogLine(line) {
  try {
    const entry = JSON.parse(line);
    const msg = entry['1'] || '';
    const level = entry._meta?.logLevelName || 'INFO';
    const time = entry.time || '';
    let sub = entry['0'] || '';
    if (typeof sub === 'string' && sub.startsWith('{')) { try { sub = JSON.parse(sub).subsystem || sub; } catch {} }
    const msgStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
    let event = null;

    if (msgStr.includes('dispatching to agent')) {
      const chMatch = msgStr.match(/(\w+)\[default\]/);
      const sessMatch = msgStr.match(/session=([^\)]+)/);
      event = { type: 'thinking', agentId: agentFromSession(chMatch?.[1]), channel: chMatch?.[1] || '?', session: sessMatch?.[1] || '', time, raw: msgStr };
      // Start watching this session - look up real sessionId from sessions.json
      if (sessMatch?.[1]) {
        const sessionKey = sessMatch[1];
        loadSessionMap();
        const sm = sessionMap[sessionKey];
        if (sm?.sessionId) {
          watchSession(sessionKey, sm.sessionId);
        }
      }
    }
    if (msgStr.includes('Started streaming')) { const ch = msgStr.match(/channel=(\S+)/)?.[1] || msgStr.match(/session[=:](\S+)/)?.[1]; event = { type: 'streaming', session: ch || '', agentId: agentFromSession(ch), time, raw: msgStr }; }
    if (msgStr.includes('Closed streaming')) { const ch = msgStr.match(/channel=(\S+)/)?.[1] || msgStr.match(/session[=:](\S+)/)?.[1]; event = { type: 'stream_done', session: ch || '', agentId: agentFromSession(ch), time, raw: msgStr }; }
    if (msgStr.includes('dispatch complete')) {
      const replyMatch = msgStr.match(/replies=(\d+)/);
      event = { type: 'idle', session: sessMatch?.[1] || '', agentId: agentFromSession(sessMatch?.[1]), replies: parseInt(replyMatch?.[1] || '0'), time, raw: msgStr };
    }
    if (sub.includes('agent/embedded')) {
      if (msgStr.includes('start') || msgStr.includes('begin')) event = { type: 'agent_run', time, raw: msgStr };
      if (msgStr.includes('end') || msgStr.includes('complete')) event = { type: 'agent_done', isError: msgStr.includes('error'), time, raw: msgStr };
    }
    if (sub.includes('/tool') && !msgStr.includes('allowlist') && !msgStr.includes('profile')) {
      event = { type: 'tool', tool: msgStr.match(/(\w[\w.]*).*?(called|start|→)/i)?.[1] || sub, time, raw: msgStr };
    }
    if (level === 'ERROR') event = { type: 'error', message: msgStr.slice(0, 200), time, raw: msgStr };
    if (event) event.level = level;
    return event;
  } catch { return null; }
}


// Extract agent ID from session key (format: agent:AGENT_NAME:channel:...)
function agentFromSession(sessionKey) {
  if (!sessionKey) return 'default';
  const parts = sessionKey.split(':');
  if (parts[0] === 'agent' && parts[1] && parts[1] !== 'main') return parts[1];
  return 'default';
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) { try { c.write(msg); } catch {} }
  // Persist events to file
  if (data.type === 'event') {
    try {
      fs.appendFileSync(path.join(LOG_DIR, 'monitor-events.jsonl'), JSON.stringify({ ...data.data, broadcastAt: new Date().toISOString() }) + '\n');
    } catch {}
  }
}

let logWatcher = null, lastSize = 0;
function watchLog() {
  const p = getLogPath();
  if (!fs.existsSync(p)) { setTimeout(watchLog, 5000); return; }
  lastSize = fs.statSync(p).size;
  if (logWatcher) logWatcher.close();
  logWatcher = chokidar.watch(p);
  logWatcher.on('change', () => {
    try {
      const stat = fs.statSync(p);
      if (stat.size <= lastSize) { lastSize = 0; return; }
      const stream = fs.createReadStream(p, { start: lastSize, encoding: 'utf-8' });
      let buf = '';
      stream.on('data', c => buf += c);
      stream.on('end', () => {
        lastSize = stat.size;
        buf.split('\n').filter(Boolean).forEach(line => {
          const ev = parseLogLine(line);
          if (ev) broadcast({ type: 'event', data: ev });
        });
      });
    } catch {}
  });
}

// ===== Routes =====
chokidar.watch(CONFIG_PATH).on('change', readConfig);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/state', (req, res) => res.json(state));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'init', data: state })}\n\n`);
  req.on('close', () => sseClients.delete(res));
});
app.get('/api/logs/tail', (req, res) => {
  const p = getLogPath();
  if (!fs.existsSync(p)) return res.json({ events: [] });
  const stat = fs.statSync(p);
  const sz = Math.min(stat.size, 30000);
  const stream = fs.createReadStream(p, { start: stat.size - sz, encoding: 'utf-8' });
  let buf = '';
  stream.on('data', c => buf += c);
  stream.on('end', () => {
    res.json({ events: buf.split('\n').filter(Boolean).map(parseLogLine).filter(Boolean).slice(-15) });
  });
});

// Command execution endpoint
app.use(express.json());
app.post('/api/exec', (req, res) => {
  const cmd = req.body?.command;
  if (!cmd) return res.status(400).json({ error: 'No command' });
  // Whitelist: only openclaw commands
  if (!cmd.trim().startsWith('openclaw')) return res.status(403).json({ error: 'Only openclaw commands allowed' });
  exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
    res.json({ stdout: stdout?.slice(0, 2000) || '', stderr: stderr?.slice(0, 500) || '', code: err?.code || 0 });
  });
});

// ===== Feishu name resolution =====
let feishuToken = null, feishuTokenExpiry = 0;
const nameCache = {};

async function getFeishuToken() {
  if (feishuToken && Date.now() < feishuTokenExpiry) return feishuToken;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const feishuCh = config.channels?.feishu || {};
    // Support both single-account and multi-account formats
    const feishu = feishuCh.accounts?.default || feishuCh;
    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: feishu.appId, app_secret: feishu.appSecret })
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
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await resp.json();
      const name = data.data?.user?.name || id;
      nameCache[id] = name;
      return name;
    }
    if (id.startsWith('oc_')) {
      const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/chats/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await resp.json();
      const name = data.data?.name || id;
      nameCache[id] = name;
      return name;
    }
  } catch {}
  return id;
}

// Resolve names in user messages
function cleanUserMessage(raw) {
  if (!raw) return '';
  // Extract actual message after metadata
  const msgMatch = raw.match(/\[message_id:[^\]]*\]\s*\S+:\s*(.+)$/s);
  let text = msgMatch ? msgMatch[1].trim() : raw.slice(-200);
  // Clean up at tags
  text = text.replace(/<at[^>]*>([^<]*)<\/at>/g, '@$1');
  // Handle media attachments
  if (text.startsWith('[media attached:')) {
    text = '[图片消息]';
  }
  return text.slice(0, 300);
}

app.get('/api/resolve/:id', async (req, res) => {
  const name = await resolveFeishuName(req.params.id);
  res.json({ id: req.params.id, name });
});
app.get('/api/session/:key/latest', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const sm = sessionMap[key];
  res.json(sm || { lastUserMsg: '', lastThinking: '', lastTool: '' });
});

app.use(express.static(path.join(__dirname, 'public')));

// Init
loadSessionMap();
// Watch existing sessions from all agents
try {
  for (const { dir } of getSessionDirs()) {
    const mapPath = path.join(dir, 'sessions.json');
    if (fs.existsSync(mapPath)) {
      const sessionsRaw = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
      for (const [key, val] of Object.entries(sessionsRaw)) {
        if (key.includes('feishu:group')) watchSession(key, val.sessionId);
      }
    }
  }
} catch (e) { console.error('Session watch error:', e.message); }
readConfig();
watchLog();
app.listen(PORT, '0.0.0.0', () => console.log(`🟢 Monitor v6 on http://0.0.0.0:${PORT}`));
