const db = require('../db');
const HttpError = require('../http-error');
const { verifyPassword } = require('../auth');
const { createSession, destroySession, getSession } = require('../sessions');

async function login(password) {
  if (typeof password !== 'string' || !password) {
    throw new HttpError(400, 'Введите пароль');
  }
  const { rows } = await db.pool.query('SELECT admin_salt, admin_hash, manager_salt, manager_hash FROM config WHERE id = 1');
  const cfg = rows[0];
  if (cfg && verifyPassword(password, cfg.admin_salt, cfg.admin_hash)) {
    return { token: await createSession('admin'), role: 'admin' };
  }
  if (cfg && verifyPassword(password, cfg.manager_salt, cfg.manager_hash)) {
    return { token: await createSession('manager'), role: 'manager' };
  }
  throw new HttpError(401, 'Неверный пароль');
}

async function logout(token) {
  await destroySession(token);
}

async function me(token) {
  const session = await getSession(token);
  return { role: session ? session.role : null };
}

module.exports = { login, logout, me };
