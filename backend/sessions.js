const crypto = require('crypto');
const db = require('./db');

// Persisted to db.json (not just in-memory) so a server restart/deploy
// doesn't silently log everyone out — matches the rest of the app's
// "single JSON datastore" approach instead of adding a separate store.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the cookie's Max-Age

async function createSession(role) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  await db.mutate((draft) => {
    draft.sessions = (draft.sessions || []).filter((s) => s.expiresAt > now);
    draft.sessions.push({ token, role, expiresAt: now + SESSION_TTL_MS });
    return draft;
  });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sessions = db.get().sessions || [];
  const session = sessions.find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) return null;
  return session;
}

async function destroySession(token) {
  if (!token) return;
  await db.mutate((draft) => {
    draft.sessions = (draft.sessions || []).filter((s) => s.token !== token);
    return draft;
  });
}

module.exports = { createSession, getSession, destroySession };
