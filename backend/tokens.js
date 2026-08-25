const crypto = require('crypto');

// 24 байта — тот же уровень энтропии, что у сессионных токенов (см. sessions.js).
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { genToken };
