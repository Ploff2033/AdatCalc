// Тестовая БД — отдельная от рабочей (по умолчанию calc_test на локальном
// Postgres). DATABASE_URL выставляется ДО первого require('../../db'):
// backend/db.js читает его один раз при загрузке модуля. node --test гоняет
// каждый файл в своём процессе, так что переопределение не протекает.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/calc_test';

const db = require('../../db');

let readyPromise = null;

// Поднимает схему (те же migrate()+seedIfEmpty(), что и при старте сервера)
// один раз на процесс. null — БД недоступна, тесты пропускаются.
function ready() {
  if (!readyPromise) {
    readyPromise = db.load().then(() => true).catch((err) => {
      console.warn('Тестовая БД недоступна (' + process.env.DATABASE_URL + '): ' + err.message + ' — DB-тесты пропущены');
      return false;
    });
  }
  return readyPromise;
}

// В начале каждого DB-теста: false — тест уже помечен пропущенным.
async function requireDb(t) {
  if (await ready()) return true;
  t.skip('нет тестовой БД');
  return false;
}

async function resetRegistry() {
  await db.pool.query('TRUNCATE pay_files, pay_payments, pay_requests, pay_categories, pay_units RESTART IDENTITY CASCADE');
  await db.pool.query('UPDATE config SET telegram_registry_chat_id = NULL WHERE id = 1');
}

async function close() {
  await db.pool.end();
}

module.exports = { db, ready, requireDb, resetRegistry, close };
