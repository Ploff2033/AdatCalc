const HttpError = require('./http-error');

function str(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Поле "${field}" обязательно и должно быть непустой строкой`);
  }
  return value.trim();
}

function num(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpError(400, `Поле "${field}" должно быть числом`);
  }
  return n;
}

module.exports = { str, num };
