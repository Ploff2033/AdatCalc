// Сценарии спеки notifications/telegram-delivery (change telegram-proxy-failover):
// поиск сервера, очередь недоставленных, тестовые кнопки, ручной режим, статус.
// Сеть подменена: telegram.transport.post решает по proxyUrl, "жив" ли сервер,
// и записывает, что через какой прокси ушло. Манифест пула — временный файл.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-test-xray-'));
const MANIFEST = path.join(tmpDir, 'manifest.json');
process.env.TELEGRAM_PROXY_MANIFEST = MANIFEST;

const { db, requireDb, ready, resetTelegram, resetRegistry, resetClients } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const telegram = require('../telegram');

const url = (i) => 'socks5://xray:' + (10800 + i);

let calls = [];   // каждая попытка: { proxyUrl, attempts, chatId, text }
let sent = [];    // ушедшие сообщения
let dead = new Set();
let delayMs = 0;
let telegramError = null; // { proxyUrl, status } — ответ Telegram 4xx через этот прокси
let logs = [];

telegram.transport.post = async (botToken, chatId, text, proxyUrl, threadId, attempts) => {
  calls.push({ proxyUrl, attempts, chatId: String(chatId), threadId, text });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  if (telegramError && telegramError.proxyUrl === proxyUrl) {
    const err = new Error('HTTP ' + telegramError.status + ': Bad Request: chat not found');
    err.telegramStatus = telegramError.status;
    throw err;
  }
  if (dead.has(proxyUrl)) {
    const err = new Error('connect ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    throw err;
  }
  sent.push({ proxyUrl, chatId: String(chatId), threadId, text });
};

function writeManifest(nums, refreshedAt) {
  fs.writeFileSync(MANIFEST, JSON.stringify({
    refreshedAt: (refreshedAt || new Date()).toISOString(),
    servers: nums.map((i) => ({ id: 'id' + i, name: 'Сервер ' + i, address: 'srv' + i + '.example.net', proxyUrl: url(i) }))
  }));
}

function noManifest() {
  try { fs.unlinkSync(MANIFEST); } catch (e) { /* нет — и ладно */ }
}

const flush = () => new Promise((r) => setTimeout(r, 50));
const origError = console.error;

test.after(async () => {
  console.error = origError;
  noManifest();
  await stop();
});

test.beforeEach(async () => {
  calls = [];
  sent = [];
  dead = new Set();
  delayMs = 0;
  telegramError = null;
  logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  telegram.resetPoolForTests();
  writeManifest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  if (await ready()) {
    await resetRegistry();
    await resetTelegram();
  }
});

// Сделать текущим сервер n: все до него «мертвы» на время одной отправки.
async function makeCurrent(n) {
  for (let i = 1; i < n; i++) dead.add(url(i));
  await telegram.sendTest();
  dead = new Set();
  calls = [];
  sent = [];
  logs = [];
}

const switches = () => logs.filter((l) => l.includes('переключение на'));

// ---- Поиск рабочего сервера при сбое ----

test('Текущий сервер умер: 3 → 4, следующее сообщение сразу через 4', async (t) => {
  if (!(await requireDb(t))) return;
  await makeCurrent(3);
  dead.add(url(3));
  await telegram.sendTest();
  assert.deepStrictEqual(calls.map((c) => c.proxyUrl), [url(3), url(4)]);
  assert.ok(calls.every((c) => c.attempts === 1), 'по одной попытке на сервер');
  assert.strictEqual(sent[0].proxyUrl, url(4));
  calls = [];
  await telegram.sendTest();
  assert.deepStrictEqual(calls.map((c) => c.proxyUrl), [url(4)]);
  assert.strictEqual(switches().length, 1);
  assert.match(switches()[0], /сервер «Сервер 3» не ответил .*ETIMEDOUT.*переключение на «Сервер 4»/);
});

test('Худший случай перебора: 1 → … → 10, ровно 10 попыток', async (t) => {
  if (!(await requireDb(t))) return;
  for (let i = 1; i <= 9; i++) dead.add(url(i));
  await telegram.sendTest();
  assert.deepStrictEqual(calls.map((c) => c.proxyUrl), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(url));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].proxyUrl, url(10));
  const st = await telegram.status();
  assert.strictEqual(st.current.index, 10);
});

test('Перебор с конца списка по кругу: 9 → 10 → 1', async (t) => {
  if (!(await requireDb(t))) return;
  await makeCurrent(9);
  dead.add(url(9));
  dead.add(url(10));
  await telegram.sendTest();
  assert.deepStrictEqual(calls.map((c) => c.proxyUrl), [url(9), url(10), url(1)]);
  assert.strictEqual(sent[0].proxyUrl, url(1));
});

test('Ошибка Telegram, а не прокси: без перебора, без очереди', async (t) => {
  if (!(await requireDb(t))) return;
  await makeCurrent(3);
  telegramError = { proxyUrl: url(3), status: 400 };
  telegram.notifyOrderCreated({ plantName: 'Завод', recipeName: 'М300', mixerName: 'Миксер', saleVolume: 10, distanceKm: 5, totalRevenue: 1, totalProfit: 1, totalMarginPercent: 1 });
  await flush();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual((await db.pool.query('SELECT count(*)::int AS n FROM telegram_outbox')).rows[0].n, 0);
  assert.strictEqual((await telegram.status()).current.index, 3);
  assert.ok(logs.some((l) => l.includes('chat not found')));
});

test('Два сбоя одновременно: один перебор, оба сообщения через найденный сервер', async (t) => {
  if (!(await requireDb(t))) return;
  await db.pool.query("UPDATE config SET telegram_registry_chat_id = 'registry-chat' WHERE id = 1");
  await makeCurrent(3);
  dead.add(url(3));
  delayMs = 20;
  await Promise.all([telegram.sendTest(), telegram.sendRegistryTest()]);
  assert.strictEqual(sent.length, 2);
  assert.ok(sent.every((s) => s.proxyUrl === url(4)));
  assert.strictEqual(switches().length, 1);
  assert.ok(!calls.some((c) => c.proxyUrl === url(5)), 'дальше сервера 4 никто не искал');
});

test('Текущий сервер исчез из пула — начинаем с первого', async (t) => {
  if (!(await requireDb(t))) return;
  await makeCurrent(3);
  writeManifest([1, 2, 4, 5]);
  await telegram.sendTest();
  assert.deepStrictEqual(calls.map((c) => c.proxyUrl), [url(1)]);
});

// ---- Очередь недоставленных ----

test('Все серверы недоступны: заказ создан, сообщение в очереди', async (t) => {
  if (!(await requireDb(t))) return;
  await resetClients();
  for (let i = 1; i <= 10; i++) dead.add(url(i));
  await db.pool.query("UPDATE config SET telegram_orders_thread_id = '77' WHERE id = 1");
  const p = await fx.plant('Завод');
  const c = await fx.client('Клиент', p.id);
  const r = await fx.recipe(p.id, 'М300', 5000);
  const o = await fx.order(p, c, r, null);
  assert.ok(o.id, 'заказ создан');
  await flush();
  const { rows } = await db.pool.query('SELECT chat_id, thread_id, text, last_error FROM telegram_outbox');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].chat_id, 'orders-chat');
  assert.strictEqual(rows[0].thread_id, '77');
  assert.match(rows[0].text, /Новый заказ/);
  assert.match(rows[0].last_error, /ни один из 10 серверов/);
  await resetClients();
});

async function queued(text, createdAt, chatId, threadId) {
  await db.pool.query('INSERT INTO telegram_outbox (chat_id, thread_id, text, created_at) VALUES ($1, $2, $3, $4)', [chatId || 'orders-chat', threadId || null, text, createdAt]);
}

test('Досылка после восстановления: по порядку, со строкой «Задержано»', async (t) => {
  if (!(await requireDb(t))) return;
  await queued('Заказ А', '2026-10-28T11:05:00Z', 'orders-chat', '77');   // 14:05 МСК
  await queued('Заявка Б', '2026-10-28T11:20:00Z', 'registry-chat');       // 14:20 МСК
  await telegram.drainOutbox('2026-10-28T11:45:00Z');
  assert.deepStrictEqual(sent.map((s) => [s.chatId, s.threadId, s.text]), [
    ['orders-chat', '77', 'Заказ А\n⏱ Задержано: создано 14:05'],
    ['registry-chat', null, 'Заявка Б\n⏱ Задержано: создано 14:20']
  ]);
  assert.strictEqual((await db.pool.query('SELECT count(*)::int AS n FROM telegram_outbox')).rows[0].n, 0);
});

test('Сообщение со вчерашнего дня: «создано 27.10 23:50»', async (t) => {
  if (!(await requireDb(t))) return;
  await queued('Заказ', '2026-10-27T20:50:00Z');               // 27.10 23:50 МСК
  await telegram.drainOutbox('2026-10-27T21:10:00Z');          // 28.10 00:10 МСК
  assert.strictEqual(sent[0].text, 'Заказ\n⏱ Задержано: создано 27.10 23:50');
});

test('Устаревшее сообщение удаляется без отправки', async (t) => {
  if (!(await requireDb(t))) return;
  await queued('Старый заказ', '2026-10-28T06:00:00Z');        // 28.10 09:00 МСК
  await telegram.drainOutbox('2026-10-29T06:05:00Z');          // 29.10 09:05 МСК
  assert.strictEqual(calls.length, 0);
  assert.strictEqual((await db.pool.query('SELECT count(*)::int AS n FROM telegram_outbox')).rows[0].n, 0);
  assert.ok(logs.some((l) => l.includes('старше 24 ч')));
});

test('Сбой посреди досылки: первое ушло, второе и третье остались', async (t) => {
  if (!(await requireDb(t))) return;
  await queued('1', '2026-10-28T11:00:00Z');
  await queued('2', '2026-10-28T11:01:00Z');
  await queued('3', '2026-10-28T11:02:00Z');
  const realPost = telegram.transport.post;
  let n = 0;
  telegram.transport.post = async (...a) => {
    if (++n > 1) { const e = new Error('connect ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; }
    return realPost(...a);
  };
  try {
    await telegram.drainOutbox('2026-10-28T11:10:00Z');
  } finally {
    telegram.transport.post = realPost;
  }
  assert.strictEqual(sent.length, 1);
  const { rows } = await db.pool.query('SELECT text, attempts FROM telegram_outbox ORDER BY id');
  assert.deepStrictEqual(rows.map((r) => [r.text, r.attempts]), [['2', 1], ['3', 0]]);
});

test('Досылка: отказ Telegram (4xx) — удалить и идти дальше', async (t) => {
  if (!(await requireDb(t))) return;
  await queued('в удалённый чат', '2026-10-28T11:00:00Z', 'gone-chat');
  await queued('нормальное', '2026-10-28T11:01:00Z');
  const realPost = telegram.transport.post;
  telegram.transport.post = async (b, chatId, ...rest) => {
    if (chatId === 'gone-chat') { const e = new Error('HTTP 400'); e.telegramStatus = 400; throw e; }
    return realPost(b, chatId, ...rest);
  };
  try {
    await telegram.drainOutbox('2026-10-28T11:10:00Z');
  } finally {
    telegram.transport.post = realPost;
  }
  assert.deepStrictEqual(sent.map((s) => s.chatId), ['orders-chat']);
  assert.strictEqual((await db.pool.query('SELECT count(*)::int AS n FROM telegram_outbox')).rows[0].n, 0);
});

// ---- Тестовые кнопки ----

test('Тест при мёртвом текущем сервере: успех через сервер 3', async (t) => {
  if (!(await requireDb(t))) return;
  await makeCurrent(2);
  dead.add(url(2));
  const r = await call('POST', '/api/config/telegram-test', { cookie: await cookieFor('admin'), json: {} });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(sent[0].proxyUrl, url(3));
  assert.strictEqual((await telegram.status()).current.index, 3);
});

test('Тест, когда все серверы недоступны: ошибка, очередь пуста', async (t) => {
  if (!(await requireDb(t))) return;
  for (let i = 1; i <= 10; i++) dead.add(url(i));
  const r = await call('POST', '/api/config/telegram-test', { cookie: await cookieFor('admin'), json: {} });
  assert.strictEqual(r.status, 502);
  assert.match(r.data.error, /Не удалось отправить сообщение: ни один из 10 серверов прокси не ответил/);
  await db.pool.query("UPDATE config SET telegram_registry_chat_id = 'registry-chat' WHERE id = 1");
  await assert.rejects(telegram.sendRegistryTest(), /ни один из 10 серверов/);
  assert.strictEqual((await db.pool.query('SELECT count(*)::int AS n FROM telegram_outbox')).rows[0].n, 0);
});

// ---- Ручной режим ----

test('Пул есть, в поле «Прокси» старый адрес — поле игнорируется', async (t) => {
  if (!(await requireDb(t))) return;
  await db.pool.query("UPDATE config SET telegram_proxy_url = 'socks5://xray:10808' WHERE id = 1");
  await telegram.sendTest();
  assert.deepStrictEqual(calls.map((c) => c.proxyUrl), [url(1)]);
});

test('Без пула: прокси из поля, 3 попытки, при сбое — очередь', async (t) => {
  if (!(await requireDb(t))) return;
  noManifest();
  await db.pool.query("UPDATE config SET telegram_proxy_url = 'socks5://manual:1080' WHERE id = 1");
  await telegram.sendTest();
  assert.strictEqual(calls[0].proxyUrl, 'socks5://manual:1080');
  assert.strictEqual(calls[0].attempts, undefined, 'по умолчанию — прежние 3 попытки');
  dead.add('socks5://manual:1080');
  telegram.notifyStockDeficit({ name: 'Цемент' }, -5, 10);
  await flush();
  assert.strictEqual((await db.pool.query('SELECT count(*)::int AS n FROM telegram_outbox')).rows[0].n, 1);
  assert.strictEqual((await telegram.status()).mode, 'manual');
});

test('Локальная разработка: без пула и без поля — напрямую', async (t) => {
  if (!(await requireDb(t))) return;
  noManifest();
  const saved = process.env.TELEGRAM_PROXY_URL;
  delete process.env.TELEGRAM_PROXY_URL;
  try {
    await telegram.sendTest();
  } finally {
    if (saved !== undefined) process.env.TELEGRAM_PROXY_URL = saved;
  }
  assert.strictEqual(calls[0].proxyUrl, '');
});

// ---- Статус в Настройках ----

test('Статус: нормальная работа и застрявшая подписка с очередью', async (t) => {
  if (!(await requireDb(t))) return;
  await makeCurrent(4);
  let r = await call('GET', '/api/config/telegram-status', { cookie: await cookieFor('admin') });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.mode, 'auto');
  assert.deepStrictEqual([r.data.current.index, r.data.current.total, r.data.current.name], [4, 10, 'Сервер 4']);
  assert.ok(r.data.current.since);
  assert.strictEqual(r.data.subscription.count, 10);
  assert.strictEqual(r.data.subscription.stale, false);
  assert.strictEqual(r.data.queue.count, 0);
  assert.strictEqual(r.data.lastSwitch.fromName, 'Сервер 1');
  // Ключей и адреса подписки в ответе нет — только имя и номер.
  assert.ok(!JSON.stringify(r.data).includes('socks5://'));

  writeManifest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], new Date(Date.now() - 2 * 24 * 3600 * 1000));
  await queued('А', '2026-10-28T11:05:00Z');
  await queued('Б', '2026-10-28T11:06:00Z');
  r = await call('GET', '/api/config/telegram-status', { cookie: await cookieFor('admin') });
  assert.strictEqual(r.data.subscription.stale, true);
  assert.deepStrictEqual(r.data.queue, { count: 2, oldestAt: '2026-10-28T11:05:00.000Z' });
});

test('Статус после перезапуска: сервер 1, ещё не использовался', async (t) => {
  if (!(await requireDb(t))) return;
  const st = await telegram.status();
  assert.deepStrictEqual([st.current.index, st.current.since, st.lastSwitch], [1, null, null]);
});

test('Менеджер не видит статус', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await call('GET', '/api/config/telegram-status', { cookie: await cookieFor('manager') });
  assert.strictEqual(r.status, 403);
});

// ---- Что не меняется ----

test('Заказ при перебое: операция не ждёт поиска, служебных сообщений нет', async (t) => {
  if (!(await requireDb(t))) return;
  await db.pool.query("UPDATE config SET telegram_registry_chat_id = 'registry-chat', telegram_registry_buh_chat_id = 'registry-chat' WHERE id = 1");
  const req = await registry.create({ unitId: await fx.unit('Стройка'), categoryId: await fx.category('Материалы'), recipient: 'ООО "ПРОМХИМ"', purpose: 'Фанера', amount: 63800, dueDate: '2026-10-20' });
  await flush();
  sent = [];
  calls = [];
  for (let i = 1; i <= 3; i++) dead.add(url(i));
  delayMs = 100;
  const t0 = Date.now();
  const x = await registry.decide(req.id, { decision: 'approved' });
  assert.ok(Date.now() - t0 < 100, 'решение вернулось до окончания перебора');
  assert.strictEqual(x.state.status, 'approved');
  await new Promise((r) => setTimeout(r, 600));
  assert.strictEqual(sent.length, 1, 'ровно одно сообщение — само решение, без служебных');
  assert.strictEqual(sent[0].proxyUrl, url(4));
  assert.match(sent[0].text, /Можно делать платёжку: №/);
  assert.ok(!sent[0].text.includes('Задержано'));
});
