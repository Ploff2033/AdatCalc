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
  await db.pool.query('TRUNCATE pay_notify_messages, pay_files, pay_payments, pay_requests, pay_categories, pay_units RESTART IDENTITY CASCADE');
  await db.pool.query(`UPDATE config SET telegram_registry_chat_id = NULL, telegram_registry_thread_id = NULL,
    telegram_registry_owner_username = NULL, telegram_registry_buh_chat_id = NULL, telegram_registry_buh_thread_id = NULL,
    telegram_registry_buh_username = NULL, telegram_registry_events = NULL WHERE id = 1`);
  // Сбой отправки теперь кладёт сообщение в очередь (change
  // telegram-proxy-failover) — не тащим его в следующий тест.
  await db.pool.query('TRUNCATE telegram_outbox RESTART IDENTITY');
}

// Очередь недоставленных и настройки Telegram (change telegram-proxy-failover).
async function resetTelegram() {
  await db.pool.query('TRUNCATE telegram_outbox RESTART IDENTITY');
  await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_chat_id = 'orders-chat', telegram_proxy_url = NULL, telegram_orders_thread_id = NULL, telegram_stock_thread_id = NULL, telegram_registry_chat_id = NULL, telegram_registry_thread_id = NULL WHERE id = 1");
}

// Для тестов клиентов/заказов (change client-list): заказы тестовых заводов,
// вся память и справочник клиентов, тестовые рецепты/миксеры/заводы (префикс
// t* — их создаёт fixtures.js; рейсы путевых и движения остатков уходят
// каскадом вместе с заказами/материалами). Сид-данные БД (plant_seed1 и т.п.) не трогаем.
async function resetClients() {
  // Записи ДДС тестовых заводов (тест «не трогает ДДС», change order-edit)
  // держат FK на plants — иначе удаление заводов ниже падает.
  await db.pool.query("DELETE FROM cash_entries WHERE plant_id LIKE 'tplant_%'");
  await db.pool.query("DELETE FROM orders WHERE plant_id LIKE 'tplant_%'");
  await db.pool.query('DELETE FROM client_prices');
  await db.pool.query('DELETE FROM clients');
  await db.pool.query("DELETE FROM recipes WHERE id LIKE 'trec_%'");
  await db.pool.query("DELETE FROM materials WHERE id LIKE 'tmat_%'");
  await db.pool.query("DELETE FROM employees WHERE id LIKE 'temp_%'");
  await db.pool.query("DELETE FROM mixers WHERE id LIKE 'tmix_%'");
  await db.pool.query("DELETE FROM plants WHERE id LIKE 'tplant_%'");
}

// Для тестов путевых листов (change waybill-fuel-chain): коэффициенты и
// номера листов тестовой техники (ключ листа начинается с id водителя
// temp_*), инертовозы ttruck_*, затем всё, что чистит resetClients (рейсы
// уходят каскадом вместе с тестовыми заказами).
async function resetWaybills() {
  await db.pool.query("DELETE FROM waybill_doc_fuel WHERE doc_key LIKE 'temp_%'");
  await db.pool.query("DELETE FROM waybill_doc_numbers WHERE doc_key LIKE 'temp_%'");
  await resetClients();
  await db.pool.query("DELETE FROM aggregate_trucks WHERE id LIKE 'ttruck_%'");
}

// Для тестов исправления заказов (change order-edit): то же, что
// resetClients — журнал правок (order_edits) уходит каскадом вместе с
// тестовыми заказами.
async function resetOrders() {
  await resetClients();
}

async function close() {
  await db.pool.end();
}

module.exports = { db, ready, requireDb, resetRegistry, resetTelegram, resetClients, resetWaybills, resetOrders, close };
