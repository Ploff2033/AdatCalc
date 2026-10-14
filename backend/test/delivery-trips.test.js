// Сценарии спеки orders/delivery-trips (change client-list): число рейсов с
// учётом макс. загрузки, снимок в заказе, строка в Telegram, путевые и ГСМ.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetClients, ready } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const frontend = require('./helpers/frontend');
const orders = require('../handlers/orders');
const waybillEntries = require('../handlers/waybill-entries');
const telegram = require('../telegram');

const w = frontend.load(['frontend/js/shared/calc.js', 'frontend-v2/js/order-calc.js', 'frontend-v2/js/waybill-calc.js']);

let sent = [];
telegram.transport.post = async (botToken, chatId, text) => { sent.push(text); };
const flush = () => new Promise((r) => setTimeout(r, 50));

test.after(async () => { const { close } = require('./helpers/db'); await close(); });
test.beforeEach(async () => {
  // Уведомления уходят без await — дожидаемся хвостов прошлого теста, чтобы
  // они не попали в sent этого.
  await new Promise((r) => setTimeout(r, 60));
  sent = [];
  if (await ready()) {
    await resetClients();
    await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_chat_id = 'orders-chat' WHERE id = 1");
  }
});

// Миксер на 8 м³, расход на рейс = 3 000 ₽: только топливо, 100 км туда-обратно
// × 40 л/100 км × 75 ₽/л. Остальные статьи нулевые.
const MIXER = { id: 'm8', name: 'Howo 752', capacity: 8, fuelRate: 40, ureaRate: 0, platonRatePerKm: 0, balance: 0, residual: 0, mileage: 1 };
const DATA = { materials: [], aggregateTrucks: [], plants: [], personnelSummary: { byPlant: {}, sharedTotal: 0 }, config: {} };
function run(volume, maxLoad) {
  return w.OrderCalc.run({
    plant: { id: 'p', name: 'Джага' }, recipe: { id: 'r', name: 'М300', salePrice: 11000, items: [] }, mixer: MIXER, data: DATA,
    selfPickup: false, saleVolume: volume, dist: 50, addressFilled: true, priceNet: 11000, vatGrossMode: false,
    nbCity: false, fuelPrice: 75, ureaPrice: 0, deliveryChargePerM3: 500, maxLoad: maxLoad
  });
}

test('Без ограничения: 20 м³ на 8 м³ — 3 рейса, 9 000 ₽', () => {
  const c = run(20);
  assert.strictEqual(c.fuelCostPerTrip, 3000);
  assert.strictEqual(c.trips, 3);
  assert.strictEqual(c.deliveryCostTotal, 9000);
  assert.strictEqual(c.loadLimited, false);
  assert.strictEqual(w.Calc.tripsForVolume(MIXER, 20), 3);
});

test('Ограничение подъезда: макс. загрузка 5 м³ — 4 рейса, 12 000 ₽', () => {
  const c = run(20, 5);
  assert.strictEqual(c.trips, 4);
  assert.strictEqual(c.deliveryCostTotal, 12000);
  assert.strictEqual(c.effectiveLoad, 5);
  assert.strictEqual(c.loadLimited, true);
});

test('Загрузка больше вместимости: 10 м³ на миксере 8 — считаем по 8, 3 рейса', () => {
  const c = run(20, 10);
  assert.strictEqual(c.trips, 3);
  assert.strictEqual(c.effectiveLoad, 8);
  assert.strictEqual(c.loadLimited, false);
});

test('Малый объём: 3 м³ при загрузке 5 — 1 рейс', () => {
  assert.strictEqual(run(3, 5).trips, 1);
});

test('Payload: maxLoadM3 только при ограничении; без maxLoad расчёт прежний', () => {
  const input = { plant: { id: 'p', name: 'Джага' }, recipe: { id: 'r', name: 'М300' }, mixer: MIXER, selfPickup: false, saleVolume: 20, dist: 50, address: 'пос. Северный' };
  const limited = w.OrderCalc.toOrderPayload(input, run(20, 5));
  assert.strictEqual(limited.maxLoadM3, 5);
  assert.strictEqual(limited.tripCount, 4);
  assert.strictEqual(limited.recipeId, 'r');
  assert.strictEqual(limited.mixerId, 'm8');
  assert.strictEqual(limited.selfPickup, false);
  assert.strictEqual(w.OrderCalc.toOrderPayload(input, run(20, 10)).maxLoadM3, null);
  const before = w.OrderCalc.toOrderPayload(input, run(20));
  const same = w.OrderCalc.toOrderPayload(input, run(20, null));
  delete before.createdAt; delete same.createdAt;
  assert.deepStrictEqual(same, before);
  assert.strictEqual(before.maxLoadM3, null);
  assert.strictEqual(before.tripCount, 3);
});

async function setup() {
  const p = await fx.plant('Джага');
  const r = await fx.recipe(p.id, 'М300', 11000);
  const m = await fx.mixer('Howo 752', 8);
  const c = await fx.client('СтройИнвест', p.id, 'legal');
  return { p, r, m, c };
}

test('Заказ с ограничением: 4 рейса и загрузка 5 м³; без ограничения — пусто', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const a = await orders.create(fx.orderBody(s.p, s.c, s.r, s.m, { saleVolume: 20, tripCount: 4, maxLoadM3: 5 }));
  assert.strictEqual(a.tripCount, 4);
  assert.strictEqual(a.maxLoadM3, 5);
  const b = await orders.create(fx.orderBody(s.p, s.c, s.r, s.m, { saleVolume: 20, tripCount: 3, maxLoadM3: null }));
  assert.strictEqual(b.tripCount, 3);
  assert.strictEqual(b.maxLoadM3, null);
  const listed = (await orders.list({ plantId: s.p.id }, 'admin')).find((o) => o.id === a.id);
  assert.strictEqual(listed.maxLoadM3, 5);
  await assert.rejects(orders.create(fx.orderBody(s.p, s.c, s.r, s.m, { maxLoadM3: 0 })), { status: 400 });
});

test('Уведомление с ограничением: строка «Рейсов: 4 × 5 м³» сразу после «Объём»', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.create(fx.orderBody(s.p, s.c, s.r, s.m, { saleVolume: 20, tripCount: 4, maxLoadM3: 5 }));
  await flush();
  const lines = sent[0].split('\n');
  const i = lines.indexOf('Объём: 20 м³');
  assert.ok(i > 0);
  assert.strictEqual(lines[i + 1], 'Рейсов: 4 × 5 м³ (ограничение подъезда)');
});

test('Уведомление без ограничения: текст как до изменения', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const o = await orders.create(fx.orderBody(s.p, s.c, s.r, s.m, { saleVolume: 20, tripCount: 3 }));
  await flush();
  assert.ok(!sent[0].includes('Рейсов'));
  assert.deepStrictEqual(sent[0].split('\n').slice(0, 5), ['🧱 <b>Новый заказ — Джага</b>', 'Марка: М300', 'Миксер: Howo 752', 'Объём: 20 м³', 'Расстояние: 12 км']);
  assert.strictEqual(o.maxLoadM3, null);
});

test('Разнесение рейсов в путевые: к разнесению 4 рейса, топливо 4 × 1 503 / 75,15 = 80 л', () => {
  const order = { id: 'o1', tripCount: 4, fuelCostPerTrip: 1503, fuelPricePerLiter: 75.15 };
  assert.strictEqual(w.WaybillCalc.remainingForOrder([], order), 4);
  // Та же формула литров, что в путевом листе (waybill-xlsx.js) и в
  // WaybillCalc: рейсы × стоимость рейса / цена литра.
  const entries = [{ orderId: 'o1', tripCount: 4, fuelCostPerTrip: 1503, fuelPricePerLiter: 75.15 }];
  assert.strictEqual(w.WaybillCalc.remainingForOrder(entries, order), 0);
  const liters = entries.reduce((s, e) => s + e.tripCount * e.fuelCostPerTrip / e.fuelPricePerLiter, 0);
  assert.strictEqual(Math.round(liters * 100) / 100, 80);
});

test('Списание материалов по рейсу: 1 рейс из 4 списывает 1/4; больше 4 рейсов не разнести', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const cement = await fx.material(s.p.id, 'Цемент', 100);
  const drv = await fx.driver(s.p.id, 'Водитель Тест');
  const o = await orders.create(fx.orderBody(s.p, s.c, s.r, s.m, {
    saleVolume: 20, tripCount: 4, maxLoadM3: 5, materials: [{ name: 'Цемент', unit: 'т', qty: 8, materialId: cement.id }]
  }));
  const entry = { orderId: o.id, tripDate: '2026-10-14', driverId: drv.id, driverName: drv.name, mixerId: s.m.id, mixerName: s.m.name, distanceKm: 12 };
  await waybillEntries.create(Object.assign({}, entry, { tripCount: 1 }));
  const { rows } = await db.pool.query('SELECT stock_on_hand, stock_reserved FROM materials WHERE id = $1', [cement.id]);
  assert.strictEqual(Number(rows[0].stock_on_hand), 98);
  assert.strictEqual(Number(rows[0].stock_reserved), 6);
  await assert.rejects(waybillEntries.create(Object.assign({}, entry, { tripCount: 4 })), { status: 400, message: /осталось разнести 3 из 4/ });
});
