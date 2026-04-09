// auth.js – User authentication, session management, permission control
// Uses Node.js built-in node:sqlite (v22.5+) and crypto, zero extra deps.
'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');

// Prefer persistent storage under ~/.openclaw; fall back to /tmp/openclaw
const PERSISTENT_DIR = path.join(process.env.HOME || '/root', '.openclaw', 'monitor');
const DB_DIR = (() => {
  try { fs.mkdirSync(PERSISTENT_DIR, { recursive: true }); return PERSISTENT_DIR; } catch { return '/tmp/openclaw'; }
})();
const DB_PATH = path.join(DB_DIR, 'monitor-auth.db');
try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync('/tmp/openclaw', { recursive: true }); } catch {}

// Suppress experimental warning for sqlite
process.removeAllListeners('warning');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    pwd_hash   TEXT NOT NULL,
    salt       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    email      TEXT DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS permissions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT,
    UNIQUE(user_id, resource_type, resource_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ── Password helpers ─────────────────────────────────────────────────────────
function hashPasswordSync(password, salt) {
  // Use scryptSync for simplicity (blocking but only on login/register)
  const buf = crypto.scryptSync(password, salt, 64);
  return buf.toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function verifyPassword(password, hash, salt) {
  return hashPasswordSync(password, salt) === hash;
}

// ── User ops ─────────────────────────────────────────────────────────────────
const stmts = {
  countUsers:    db.prepare('SELECT COUNT(*) AS cnt FROM users'),
  userByName:    db.prepare('SELECT * FROM users WHERE username=?'),
  userById:      db.prepare('SELECT * FROM users WHERE id=?'),
  allUsers:      db.prepare('SELECT id,username,role,email,created_at,last_login FROM users ORDER BY created_at'),
  insertUser:    db.prepare('INSERT INTO users(id,username,pwd_hash,salt,role,email) VALUES(?,?,?,?,?,?)'),
  deleteUser:    db.prepare('DELETE FROM users WHERE id=?'),
  updateRole:    db.prepare('UPDATE users SET role=? WHERE id=?'),
  touchLogin:    db.prepare("UPDATE users SET last_login=strftime('%s','now') WHERE id=?"),
  insertSession: db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)'),
  getSession:    db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?'),
  delSession:    db.prepare('DELETE FROM sessions WHERE token=?'),
  cleanSess:     db.prepare("DELETE FROM sessions WHERE expires_at<=strftime('%s','now')"),
  getPerms:      db.prepare('SELECT * FROM permissions WHERE user_id=?'),
  delPerms:      db.prepare('DELETE FROM permissions WHERE user_id=?'),
  insertPerm:    db.prepare('INSERT OR IGNORE INTO permissions(id,user_id,resource_type,resource_id) VALUES(?,?,?,?)'),
};

function getUserCount()             { return stmts.countUsers.get().cnt; }
function getUserByUsername(u)       { return stmts.userByName.get(u); }
function getUserById(id)            { return stmts.userById.get(id); }
function getAllUsers()               { return stmts.allUsers.all(); }

function createUser(username, password, role = 'user', email = '') {
  const id   = crypto.randomUUID();
  const salt = newSalt();
  const hash = hashPasswordSync(password, salt);
  stmts.insertUser.run(id, username, hash, salt, role, email);
  return { id, username, role, email };
}

function deleteUser(id)             { stmts.deleteUser.run(id); }
function updateUserRole(id, role)   { stmts.updateRole.run(role, id); }
function touchLogin(id)             { stmts.touchLogin.run(id); }

// ── Session ops ──────────────────────────────────────────────────────────────
function createSession(userId) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400; // 7 days
  stmts.insertSession.run(token, userId, expiresAt);
  return token;
}
function getSession(token) {
  if (!token) return null;
  return stmts.getSession.get(token, Math.floor(Date.now() / 1000));
}
function deleteSession(token) { stmts.delSession.run(token); }
function cleanExpiredSessions() { stmts.cleanSess.run(); }

// ── Permission ops ───────────────────────────────────────────────────────────
function getUserPermissions(userId) { return stmts.getPerms.all(userId); }

function setUserPermissions(userId, permissions) {
  stmts.delPerms.run(userId);
  for (const p of permissions) {
    stmts.insertPerm.run(crypto.randomUUID(), userId, p.type, p.resourceId ?? null);
  }
}

// ── Access check ─────────────────────────────────────────────────────────────
function canAccess(userId, resourceType, resourceId) {
  const user = getUserById(userId);
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = getUserPermissions(userId);
  if (perms.some(p => p.resource_type === 'all')) return true;
  return perms.some(p => p.resource_type === resourceType && p.resource_id === resourceId);
}

// ── World state filter ───────────────────────────────────────────────────────
function filterWorldState(userId, worldState) {
  const user = getUserById(userId);
  if (!user) return { agents: [], config: worldState.config };
  if (user.role === 'admin') return worldState;

  const perms = getUserPermissions(userId);
  if (perms.some(p => p.resource_type === 'all')) return worldState;

  const allowedAgents   = new Set(perms.filter(p => p.resource_type === 'agent').map(p => p.resource_id));
  const allowedSessions = new Set(perms.filter(p => p.resource_type === 'session').map(p => p.resource_id));

  const agents = (worldState.agents || [])
    .map(a => {
      const sessions = allowedAgents.has(a.name)
        ? a.sessions
        : (a.sessions || []).filter(s => allowedSessions.has(s.key));
      return { ...a, sessions };
    })
    .filter(a => a.sessions.length > 0);

  return { ...worldState, agents };
}

module.exports = {
  getUserCount, getUserByUsername, getUserById, getAllUsers,
  createUser, deleteUser, updateUserRole, touchLogin,
  verifyPassword,
  createSession, getSession, deleteSession, cleanExpiredSessions,
  getUserPermissions, setUserPermissions,
  canAccess, filterWorldState,
};
