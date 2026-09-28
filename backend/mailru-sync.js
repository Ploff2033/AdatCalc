// Автосинхронизация кассовой книги ДДС в Облако Mail.ru — по просьбе
// пользователя ("чтобы данные отображались в облачной таблице"). Логин и
// пароль для внешних приложений читаются из config (правятся в Настройках,
// как токен Telegram-бота — тот же приём, см. telegram.js::getCredentials)
// заново на каждый вызов, не кэшируются.
const db = require('./db');
const webdav = require('./mailru-webdav');
const { buildLedgerBuffer } = require('./cash-ledger');

async function getCredentials() {
  const { rows } = await db.pool.query('SELECT mailru_login, mailru_app_password FROM config WHERE id = 1');
  const row = rows[0] || {};
  return { login: row.mailru_login || '', appPassword: row.mailru_app_password || '' };
}

async function uploadLedger(plantId) {
  const { login, appPassword } = await getCredentials();
  if (!login || !appPassword) {
    const err = new Error('Mail.ru не настроен — задайте логин и пароль для внешних приложений в Настройках');
    err.notConfigured = true;
    throw err;
  }
  const { rows } = await db.pool.query('SELECT name FROM plants WHERE id = $1', [plantId]);
  const plantName = rows[0] ? rows[0].name : plantId;
  const buffer = await buildLedgerBuffer(plantId, plantName);
  await webdav.ensureFolder(login, appPassword, '/ДДС');
  await webdav.uploadFile(login, appPassword, '/ДДС/ДДС — ' + plantName + '.xlsx', buffer);
}

// Фоновая синхронизация — вызывается из handlers/cash-entries.js после
// create/update/remove/storno БЕЗ await (тот же приём, что и
// telegram.notifyOrderCreated): сбой сети до Mail.ru не должен ни
// задерживать ответ пользователю, ни ронять саму операцию с кассой. Пока
// Mail.ru не настроен (обычный случай, пока пользователь не заполнил
// Настройки) — молчим, а не спамим в консоль на каждую запись.
function syncPlant(plantId) {
  uploadLedger(plantId).catch((err) => {
    if (err.notConfigured) return;
    console.error('Mail.ru: не удалось синхронизировать ДДС (завод ' + plantId + '): ' + err.message);
  });
}

// Для кнопки "Проверить синхронизацию" в Настройках — в отличие от
// syncPlant() выше, реально ждёт результат и пробрасывает ошибку (включая
// "не настроено") наверх, к самой кнопке.
async function testSync(plantId) {
  await uploadLedger(plantId);
}

module.exports = { syncPlant, testSync };
