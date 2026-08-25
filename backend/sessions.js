const crypto = require('crypto');
const db = require('./db');

// Persisted in Postgres (not in-memory) so a server restart/deploy
// doesn't silently log everyone out.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the cookie's Max-Age

async function createSession(role) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  await db.pool.query('DELETE FROM sessions WHERE expires_at < $1', [now]);
  await db.pool.query('INSERT INTO sessions (token, role, expires_at) VALUES ($1,$2,$3)', [token, role, now + SESSION_TTL_MS]);
  return token;
}

async function getSession(token) {
  if (!token) return null;
  const { rows } = await db.pool.query('SELECT role, expires_at FROM sessions WHERE token = $1', [token]);
  if (!rows.length) return null;
  if (Number(rows[0].expires_at) < Date.now()) return null;
  return { role: rows[0].role };
}

async function destroySession(token) {
  if (!token) return;
  await db.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

module.exports = { createSession, getSession, destroySession };
