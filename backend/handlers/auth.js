const db = require('../db');
const HttpError = require('../http-error');
const { verifyPassword } = require('../auth');
const { createSession, destroySession, getSession } = require('../sessions');

async function login(password) {
  if (typeof password !== 'string' || !password) {
    throw new HttpError(400, 'Введите пароль');
  }
  const auth = db.get().config.auth || {};
  if (auth.admin && verifyPassword(password, auth.admin.salt, auth.admin.hash)) {
    return { token: await createSession('admin'), role: 'admin' };
  }
  if (auth.manager && verifyPassword(password, auth.manager.salt, auth.manager.hash)) {
    return { token: await createSession('manager'), role: 'manager' };
  }
  throw new HttpError(401, 'Неверный пароль');
}

async function logout(token) {
  await destroySession(token);
}

function me(token) {
  const session = getSession(token);
  return { role: session ? session.role : null };
}

module.exports = { login, logout, me };
