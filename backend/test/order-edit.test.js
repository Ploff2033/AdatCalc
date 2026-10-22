// Сценарии спеки orders/order-edit (change order-edit): права и окно,
// пересчёт, бронь, блокировка при путевых, память клиента, журнал, Telegram.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetOrders, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const orders = require('../handlers/orders');
const clients = require('../handlers/clients');
const telegram = require('../telegram');

let sent = [];
let failTelegram = false;
telegram.transport.post = async (botToken, chatId, text) => {
  if (failTelegram) throw new Error('сеть недоступна');
  sent.push({ chatId, text });
};
const flush = () => new Promise((r) => setTimeout(r, 50));

const MANAGER = { role: 'manager', plantId: null };
const worker = (p) => ({ role: 'worker', plantId: p.id });

test.after(stop);
test.beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  sent = [];
  failTelegram = false;
  if (await ready()) {
    await resetOrders();
    await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_chat_id = 'orders-chat' WHERE id = 1");
  }
});

// Завод «Северный», клиент «СтройИнвест», М300 по 10 000 ₽, миксер на 8 м³.
// Заказ: самовывоз 10 м³ по 10 000 ₽, себестоимость 5 000 ₽/м³ → выручка
// 100 000, себестоимость 50 000, прибыль 50 000.
async function setup(extra) {
  const p = await fx.plant('Северный');
  const c = await fx.client('СтройИнвест', p.id);
  const r = await fx.recipe(p.id, 'М300', 10000);
  const m = await fx.mixer('Миксер 1', 8);
  const o = await fx.order(p, c, r, null, Object.assign(totals(10, 10000, 5000), extra));
  return { p, c, r, m, o };
}

function totals(volume, price, costPerM3) {
  const revenue = volume * price;
  const cost = volume * costPerM3;
  return {
    saleVolume: volume, salePrice: price, costPerM3, materialsCost: costPerM3,
    mixRevenue: revenue, mixCost: cost, mixProfit: revenue - cost, totalRevenue: revenue, totalProfit: revenue - cost
  };
}

// Тело исправления: то, что пришлёт форма — заказ целиком плюс версия.
function editBody(s, patch) {
  return Object.assign(fx.orderBody(s.p, s.c, s.r, null), {
    createdAt: s.o.createdAt, shipDate: s.o.shipDate, version: s.o.version
  }, totals(10, 10000, 5000), patch);
}

async function edits(orderId) {
  return (await orders.getByIds([orderId]))[0].edits;
}

// ---- 4.1 Транзакция, версия, отмена ----

test('Исправили объём: пересчёт и журнал', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const res = await orders.update(s.o.id, editBody(s, totals(12, 10000, 5000)), MANAGER);
  assert.strictEqual(res.saleVolume, 12);
  assert.strictEqual(res.totalRevenue, 120000);
  assert.strictEqual(res.mixCost, 60000);
  assert.strictEqual(res.totalProfit, 60000);
  assert.strictEqual(res.version, 2);
  const log = await edits(s.o.id);
  assert.strictEqual(log.length, 1);
  assert.deepStrictEqual(log[0].changes.map((c) => c.text), ['Объём: 10 → 12 м³']);
  assert.strictEqual(log[0].profit, 'Прибыль: 50 000 → 60 000 ₽');
  assert.strictEqual(log[0].actor, 'Менеджер');
});

test('Сохранение без изменений не создаёт запись и не меняет версию', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await flush();
  sent = [];
  const res = await orders.update(s.o.id, editBody(s, {}), MANAGER);
  assert.strictEqual(res.version, 1);
  assert.deepStrictEqual(await edits(s.o.id), []);
  await flush();
  assert.strictEqual(sent.length, 0);
});

test('Попытка исправить отменённый', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.cancel(s.o.id);
  await assert.rejects(orders.update(s.o.id, editBody(s, { saleVolume: 12 }), MANAGER), { status: 409, message: 'Заказ отменён' });
  assert.deepStrictEqual(await edits(s.o.id), []);
});

test('Два исправления одного заказа', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const opened = s.o.version;
  await orders.update(s.o.id, editBody(s, { saleVolume: 11, version: opened }), worker(s.p));
  await assert.rejects(
    orders.update(s.o.id, editBody(s, { saleVolume: 15, version: opened }), MANAGER),
    { status: 409, message: 'Заказ уже исправили — откройте заново' }
  );
  const [o] = await orders.getByIds([s.o.id]);
  assert.strictEqual(o.saleVolume, 11);
});

// ---- 4.2 Права работника и менеджера ----

async function ageHours(orderId, hours) {
  await db.pool.query(`UPDATE orders SET inserted_at = now() - interval '${hours} hours' WHERE id = $1`, [orderId]);
}

test('Работник в пределах суток', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await ageHours(s.o.id, 23.98);
  const res = await orders.update(s.o.id, editBody(s, { saleVolume: 12 }), worker(s.p));
  assert.strictEqual(res.saleVolume, 12);
  assert.strictEqual((await edits(s.o.id))[0].actor, 'Работник · Северный');
});

test('Работник после суток', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await ageHours(s.o.id, 24.02);
  await assert.rejects(
    orders.update(s.o.id, editBody(s, { saleVolume: 12 }), worker(s.p)),
    { status: 403, message: 'Исправить заказ можно в течение суток — обратитесь к менеджеру' }
  );
});

test('Работник по общей ссылке — любой завод в пределах суток', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const res = await orders.update(s.o.id, editBody(s, { saleVolume: 12 }), { role: 'worker', plantId: null });
  assert.strictEqual(res.saleVolume, 12);
});

test('Работник чужого завода', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const south = await fx.plant('Южный');
  await assert.rejects(orders.update(s.o.id, editBody(s, { saleVolume: 12 }), worker(south)), { status: 403 });
  assert.strictEqual((await orders.getByIds([s.o.id]))[0].saleVolume, 10);
});

test('Работник меняет завод', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const south = await fx.plant('Южный');
  await assert.rejects(
    orders.update(s.o.id, editBody(s, { plantId: south.id, plantName: south.name }), worker(s.p)),
    { status: 403, message: 'Перенести заказ на другой завод может только менеджер' }
  );
});

test('Менеджер сдвинул дату вперёд — окно работника не сдвинулось', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await ageHours(s.o.id, 72);
  const moved = await orders.updateDate(s.o.id, new Date().toISOString(), null, 'manager');
  await assert.rejects(
    orders.update(s.o.id, editBody(s, { createdAt: moved.createdAt, version: moved.version, saleVolume: 12 }), worker(s.p)),
    { status: 403 }
  );
});

test('Менеджер правит старый заказ', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await ageHours(s.o.id, 24 * 30);
  const res = await orders.update(s.o.id, editBody(s, { saleVolume: 12 }), MANAGER);
  assert.strictEqual(res.saleVolume, 12);
});

test('Менеджер переносит заказ на другой завод', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const south = await fx.plant('Южный');
  const res = await orders.update(s.o.id, editBody(s, { plantId: south.id, plantName: 'что угодно' }), MANAGER);
  assert.strictEqual(res.plantId, south.id);
  assert.strictEqual(res.plantName, 'Южный');
  assert.deepStrictEqual((await edits(s.o.id))[0].changes.map((c) => c.text), ['Завод: Северный → Южный']);
});

// ---- 4.3 Путевые листы ----

async function withWaybill(s) {
  const drv = await fx.driver(s.p.id, 'Водитель');
  await fx.waybillEntry(s.o.id, drv, s.m, { date: '2026-10-20', trips: 1, plantId: s.p.id, plantName: s.p.name });
}

async function setupDelivery() {
  const p = await fx.plant('Северный');
  const c = await fx.client('СтройИнвест', p.id);
  const r = await fx.recipe(p.id, 'М300', 10000);
  const m = await fx.mixer('Миксер 1', 8);
  const o = await fx.order(p, c, r, m, Object.assign(totals(20, 10000, 5000), { tripCount: 3 }));
  const s = { p, c, r, m, o };
  s.body = (patch) => Object.assign(fx.orderBody(p, c, r, m), { createdAt: o.createdAt, version: o.version, tripCount: 3 }, totals(20, 10000, 5000), patch);
  return s;
}

test('Исправить цену при разнесённых рейсах', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setupDelivery();
  await withWaybill(s);
  const { rows: before } = await db.pool.query('SELECT * FROM waybill_entries WHERE order_id = $1', [s.o.id]);
  const res = await orders.update(s.o.id, s.body(totals(20, 10700, 5000)), MANAGER);
  assert.strictEqual(res.salePrice, 10700);
  assert.strictEqual(res.tripCount, 3);
  const { rows: after } = await db.pool.query('SELECT * FROM waybill_entries WHERE order_id = $1', [s.o.id]);
  assert.deepStrictEqual(after, before);
});

test('Изменить объём при разнесённых рейсах', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setupDelivery();
  await withWaybill(s);
  for (const patch of [{ saleVolume: 24, tripCount: 3 }, { mixerId: null, mixerName: 'Самовывоз', selfPickup: true, tripCount: 0 }, { maxLoadM3: 5, tripCount: 4 }]) {
    await assert.rejects(orders.update(s.o.id, s.body(patch), MANAGER), { status: 409, message: 'По заказу есть путевые листы — сначала удалите их' });
  }
});

// ---- 4.4 Бронь ----

async function reserved(materialId) {
  const { rows } = await db.pool.query('SELECT stock_reserved FROM materials WHERE id = $1', [materialId]);
  return Number(rows[0].stock_reserved);
}

test('Увеличили объём: бронь пересчитана', async (t) => {
  if (!(await requireDb(t))) return;
  const p = await fx.plant('Северный');
  const cement = await fx.material(p.id, 'Цемент', 100000);
  const mats = (qty) => [{ name: 'Цемент', unit: 'кг', qty, materialId: cement.id }];
  const s = await setup({ plantId: p.id, plantName: p.name, materials: mats(3000) });
  s.p = p;
  assert.strictEqual(await reserved(cement.id), 3000);
  await orders.update(s.o.id, editBody(s, Object.assign(totals(12, 10000, 5000), { materials: mats(3600) })), MANAGER);
  assert.strictEqual(await reserved(cement.id), 3600);
  const { rows } = await db.pool.query(
    "SELECT kind, qty FROM stock_movements WHERE order_id = $1 AND kind IN ('release', 'reserve') ORDER BY id", [s.o.id]
  );
  assert.deepStrictEqual(rows.map((r) => [r.kind, Number(r.qty)]), [['reserve', 3000], ['release', -3000], ['reserve', 3600]]);
});

test('Ошибка внутри исправления — заказ, бронь и журнал прежние', async (t) => {
  if (!(await requireDb(t))) return;
  const p = await fx.plant('Северный');
  const cement = await fx.material(p.id, 'Цемент', 100000);
  const s = await setup({ plantId: p.id, plantName: p.name, materials: [{ name: 'Цемент', unit: 'кг', qty: 3000, materialId: cement.id }] });
  s.p = p;
  // Неизвестный материал: reserve() упадёт на FK уже после release().
  const bad = [{ name: 'Нет такого', unit: 'кг', qty: 10, materialId: 'tmat_missing' }];
  await assert.rejects(orders.update(s.o.id, editBody(s, Object.assign(totals(12, 10000, 5000), { materials: bad })), MANAGER));
  const [o] = await orders.getByIds([s.o.id]);
  assert.strictEqual(o.saleVolume, 10);
  assert.strictEqual(o.version, 1);
  assert.strictEqual(o.materials[0].qty, 3000);
  assert.strictEqual(await reserved(cement.id), 3000);
  assert.deepStrictEqual(o.edits, []);
});

// ---- 4.5 Память клиента ----

async function memoryPrice(clientId, recipeId) {
  const mem = (await clients.list({})).find((x) => x.id === clientId);
  const p = mem.prices.find((x) => x.recipeId === recipeId);
  return p ? p.priceNet : null;
}

test('Исправили последний заказ — память обновлена', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup({ salePrice: 9000 });
  assert.strictEqual(await memoryPrice(s.c.id, s.r.id), 9000);
  await orders.update(s.o.id, editBody(s, { salePrice: 10000, totalRevenue: 100001 }), MANAGER);
  assert.strictEqual(await memoryPrice(s.c.id, s.r.id), 10000);
});

test('Исправили старый заказ — память не меняется', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup({ salePrice: 9000, createdAt: '2026-10-18T10:00:00.000Z' });
  s.o = (await orders.getByIds([s.o.id]))[0];
  await fx.order(s.p, s.c, s.r, null, { salePrice: 9500, createdAt: '2026-10-20T10:00:00.000Z' });
  await orders.update(s.o.id, editBody(s, { salePrice: 12000 }), MANAGER);
  assert.strictEqual(await memoryPrice(s.c.id, s.r.id), 9500);
});

test('Сменили клиента — память нового обновлена, прежнего нет', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup({ salePrice: 9000 });
  const other = await fx.client('ГородСтрой', s.p.id);
  await orders.update(s.o.id, editBody(s, { clientId: other.id, clientName: other.name, salePrice: 9800 }), MANAGER);
  assert.strictEqual(await memoryPrice(other.id, s.r.id), 9800);
  assert.strictEqual(await memoryPrice(s.c.id, s.r.id), 9000);
});

test('Разовые покупатели — память не пишется', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const walk = await fx.client('Физлицо', null);
  await db.pool.query('UPDATE clients SET walk_in = TRUE WHERE id = $1', [walk.id]);
  await orders.update(s.o.id, editBody(s, { clientId: walk.id, clientName: walk.name }), MANAGER);
  assert.strictEqual(await memoryPrice(walk.id, s.r.id), null);
});

// ---- 4.6 Маршрут ----

test('Маршрут: работник по токену, менеджер по cookie, без токена — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  let res = await call('PUT', '/api/orders/' + s.o.id, { json: editBody(s, { saleVolume: 11 }) });
  assert.strictEqual(res.status, 401);
  res = await call('PUT', '/api/orders/' + s.o.id + '?token=wrong', { json: editBody(s, { saleVolume: 11 }) });
  assert.strictEqual(res.status, 404);
  res = await call('PUT', '/api/orders/' + s.o.id + '?token=' + s.p.token, { json: editBody(s, { saleVolume: 11 }) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.saleVolume, 11);
  res = await call('PUT', '/api/orders/' + s.o.id, { cookie: await cookieFor('manager'), json: editBody(s, { saleVolume: 12, version: 2 }) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.version, 3);
  const log = await edits(s.o.id);
  assert.deepStrictEqual(log.map((e) => e.actor), ['Менеджер', 'Работник · Северный']);
});

test('Маршрут: прежние операции с заказами не изменились', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const list = await call('GET', '/api/orders?token=' + s.p.token);
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual(list.data.map((o) => o.id), [s.o.id]);
  const created = await call('POST', '/api/orders', { json: fx.orderBody(s.p, s.c, s.r, null) });
  assert.strictEqual(created.status, 201);
  assert.strictEqual((await call('DELETE', '/api/orders/' + created.data.id, { cookie: await cookieFor('manager') })).status, 403);
  assert.strictEqual((await call('DELETE', '/api/orders/' + created.data.id, { cookie: await cookieFor('admin') })).status, 204);
});

// ---- 4.7 Журнал в списке ----

test('Просмотр правок: новые сверху, у заказа без правок пусто', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const plain = await fx.order(s.p, s.c, s.r, null);
  await orders.update(s.o.id, editBody(s, { saleVolume: 11 }), MANAGER);
  await orders.update(s.o.id, editBody(s, { saleVolume: 12, version: 2 }), MANAGER);
  const list = await orders.list({ plantId: s.p.id }, 'manager');
  const edited = list.find((o) => o.id === s.o.id);
  assert.deepStrictEqual(edited.edits.map((e) => e.changes[0].text), ['Объём: 11 → 12 м³', 'Объём: 10 → 11 м³']);
  assert.strictEqual(edited.hasWaybills, false);
  assert.deepStrictEqual(list.find((o) => o.id === plain.id).edits, []);
});

// ---- 5.1 Уведомление ----

test('Сообщение в чат об исправлении', async (t) => {
  if (!(await requireDb(t))) return;
  const p = await fx.plant('Северный');
  const c = await fx.client('СтройИнвест', p.id);
  const r = await fx.recipe(p.id, 'М300', 10000);
  const m = await fx.mixer('Миксер 1', 8);
  const o = await fx.order(p, c, r, m, Object.assign(totals(10, 10000, 5000), { createdAt: '2026-10-20T09:00:00.000Z' }));
  await flush();
  sent = [];
  const body = Object.assign(fx.orderBody(p, c, r, m), { createdAt: o.createdAt, version: o.version }, totals(10, 10000, 5000), { address: 'ул. Ленина, 15' });
  await orders.update(o.id, body, MANAGER);
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, 'orders-chat');
  assert.deepStrictEqual(sent[0].text.split('\n'), [
    '✏️ <b>Заказ исправлен · Северный · СтройИнвест</b>',
    'Заказ от 20.10.2026',
    'Адрес: ул. Ленина, 5 → ул. Ленина, 15',
    'Прибыль: 50 000 → 50 000 ₽',
    'Исправил: Менеджер'
  ]);
});

test('Telegram недоступен — исправление и журнал сохранены', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  failTelegram = true;
  const res = await orders.update(s.o.id, editBody(s, { saleVolume: 12 }), MANAGER);
  await flush();
  assert.strictEqual(res.saleVolume, 12);
  assert.strictEqual((await edits(s.o.id)).length, 1);
});

test('Спецсимволы в сообщении экранируются', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await flush();
  sent = [];
  await orders.update(s.o.id, editBody(s, { address: '<b>ул. Мира</b> & Ко' }), MANAGER);
  await flush();
  assert.ok(sent[0].text.includes('Адрес: — → &lt;b&gt;ул. Мира&lt;/b&gt; &amp; Ко'));
});

// ---- 5.2 Старый маршрут даты (v1) ----

test('Дата из v1 — журнал и уведомление', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup({ createdAt: '2026-10-19T09:00:00.000Z' });
  await flush();
  sent = [];
  const res = await call('PUT', '/api/orders/' + s.o.id + '/date', {
    cookie: await cookieFor('manager'), json: { createdAt: '2026-10-20T09:00:00.000Z' }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.createdAt, '2026-10-20T09:00:00.000Z');
  assert.strictEqual(res.data.version, 2);
  const log = await edits(s.o.id);
  assert.deepStrictEqual(log[0].changes.map((c) => c.text), ['Дата: 19.10.2026 12:00 → 20.10.2026 12:00']);
  assert.strictEqual(log[0].actor, 'Менеджер');
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].text.includes('Исправил: Менеджер'));
});

test('Дата из v1 без изменений — ни журнала, ни уведомления', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await flush();
  sent = [];
  const res = await orders.updateDate(s.o.id, s.o.createdAt, s.o.plantId, 'admin');
  assert.strictEqual(res.version, 1);
  assert.deepStrictEqual(await edits(s.o.id), []);
  await flush();
  assert.strictEqual(sent.length, 0);
});

// ---- 5.3 Что исправление не трогает ----

test('Заказ с записью ДДС — запись прежняя, синхронизации нет', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await db.pool.query(
    "INSERT INTO cash_entries (id, plant_id, type, category, amount, order_id) VALUES ('tcash_1', $1, 'income', 'concrete_sale', 100000, $2)",
    [s.p.id, s.o.id]
  );
  const mailru = require('../mailru-sync');
  const original = mailru.syncPlant;
  let synced = 0;
  mailru.syncPlant = () => { synced++; };
  try {
    await orders.update(s.o.id, editBody(s, totals(12, 10000, 5000)), MANAGER);
  } finally {
    mailru.syncPlant = original;
  }
  const { rows } = await db.pool.query("SELECT amount, order_id FROM cash_entries WHERE id = 'tcash_1'");
  assert.strictEqual(Number(rows[0].amount), 100000);
  assert.strictEqual(rows[0].order_id, s.o.id);
  assert.strictEqual(synced, 0);
});
