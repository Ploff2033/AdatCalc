// Сценарии спеки orders/hired-delivery (change order-hired-delivery): режим
// доставки «Найм» — снимок в заказе, проверка ставки, режим старых заказов.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetClients, ready } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const orders = require('../handlers/orders');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

const { call, stop } = require('./helpers/http');

// stop() закрывает и HTTP-сервер, и пул БД.
test.after(async () => { await stop(); });
test.beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  if (await ready()) await resetClients();
});

// Тело наёмного заказа: 20 м³, ставка 500 ₽/м³, клиенту 700 ₽/м³ — расход
// 10 000, выручка 14 000, прибыль доставки 4 000 (как считает order-calc.js).
function hiredExtra(extra) {
  return Object.assign({
    deliveryMode: 'hired', hireRatePerM3: 500, mixerId: null, mixerName: 'Найм', mixerPlate: '',
    address: 'пос. Северный', distanceKm: 30, saleVolume: 20, tripCount: 0, deliveryChargePerM3: 700,
    deliveryCostTotal: 10000, deliveryRevenue: 14000, deliveryProfit: 4000, selfPickup: undefined
  }, extra);
}

async function setup() {
  const p = await fx.plant('Северный');
  const c = await fx.client('СтройИнвест', p.id);
  const r = await fx.recipe(p.id, 'М300', 11000);
  const m = await fx.mixer('Миксер 3', 8);
  return { p, c, r, m };
}

async function rowCount(sql, params) {
  const { rows } = await db.pool.query(sql, params);
  return Number(rows[0].n);
}

test('Наёмный заказ: режим «Найм», ставка 500, адрес и 30 км, 0 рейсов', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  const o = await fx.order(p, c, r, null, hiredExtra());
  assert.strictEqual(o.deliveryMode, 'hired');
  assert.strictEqual(o.hireRatePerM3, 500);
  assert.strictEqual(o.address, 'пос. Северный');
  assert.strictEqual(o.distanceKm, 30);
  assert.strictEqual(o.tripCount, 0);
  assert.strictEqual(o.mixerName, 'Найм');
  assert.strictEqual(o.mixerId, null);
  assert.strictEqual(o.maxLoadM3, null);
});

test('Свой миксер: режим «Своя», ставка пустая (даже если пришла в теле)', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const o = await fx.order(p, c, r, m, { deliveryMode: 'own', hireRatePerM3: 500 });
  assert.strictEqual(o.deliveryMode, 'own');
  assert.strictEqual(o.hireRatePerM3, null);
});

test('Старое тело без deliveryMode: самовывоз → pickup, миксер → own', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const pickup = await fx.order(p, c, r, null);
  assert.strictEqual(pickup.deliveryMode, 'pickup');
  const own = await fx.order(p, c, r, m);
  assert.strictEqual(own.deliveryMode, 'own');
  const legacy = fx.orderBody(p, c, r, null);
  delete legacy.selfPickup;
  assert.strictEqual((await orders.create(legacy)).deliveryMode, 'pickup');
});

for (const [name, rate] of [['нулевой', 0], ['пустой', ''], ['отрицательной', -100], ['без поля', undefined]]) {
  test('Запрос с ' + name + ' ставкой: 400 «Укажите ставку найма», ничего не меняется', async (t) => {
    if (!(await requireDb(t))) return;
    const { p, c, r } = await setup();
    await assert.rejects(() => fx.order(p, c, r, null, hiredExtra({ hireRatePerM3: rate })),
      (err) => err.status === 400 && err.message === 'Укажите ставку найма');
    assert.strictEqual(await rowCount('SELECT count(*) AS n FROM orders WHERE client_id = $1', [c.id]), 0);
    const { rows } = await db.pool.query('SELECT terms_updated_at FROM clients WHERE id = $1', [c.id]);
    assert.strictEqual(rows[0].terms_updated_at, null);
  });
}

test('Наёмный заказ с рейсами отклоняется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  await assert.rejects(() => fx.order(p, c, r, null, hiredExtra({ tripCount: 3 })), (err) => err.status === 400);
});

test('Неизвестный режим доставки отклоняется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  await assert.rejects(() => fx.order(p, c, r, m, { deliveryMode: 'rent' }), (err) => err.status === 400);
});

test('Старый самовывоз и старый заказ на миксере после миграции', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const pickup = await fx.order(p, c, r, null);
  const own = await fx.order(p, c, r, m);
  // Как до выкатки: колонка режима ещё не заполнена — у всех DEFAULT 'own'.
  await db.pool.query("UPDATE orders SET delivery_mode = 'own' WHERE id = ANY($1)", [[pickup.id, own.id]]);
  const before = await db.pool.query('SELECT id, total_profit FROM orders WHERE id = ANY($1) ORDER BY id', [[pickup.id, own.id]]);
  await db.migrate();
  await db.migrate();
  const { rows } = await db.pool.query('SELECT id, delivery_mode, total_profit FROM orders WHERE id = ANY($1) ORDER BY id', [[pickup.id, own.id]]);
  const mode = Object.fromEntries(rows.map((x) => [x.id, x.delivery_mode]));
  assert.strictEqual(mode[pickup.id], 'pickup');
  assert.strictEqual(mode[own.id], 'own');
  assert.deepStrictEqual(rows.map((x) => x.total_profit), before.rows.map((x) => x.total_profit));
});

test('CHECK: в колонку режима нельзя записать произвольное значение', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const o = await fx.order(p, c, r, m);
  await assert.rejects(() => db.pool.query("UPDATE orders SET delivery_mode = 'x' WHERE id = $1", [o.id]));
});

// ---- Расчёт на фронте (frontend-v2/js/order-calc.js) ----
const frontend = require('./helpers/frontend');
const w = frontend.load(['frontend/js/shared/calc.js', 'frontend-v2/js/order-calc.js']);
// Миксер на 8 м³, расход на рейс 3 000 ₽ (100 км × 40 л/100 км × 75 ₽/л) —
// как в delivery-trips.test.js; надбавка соседнего города 1 500 ₽/рейс.
const MIXER = { id: 'm8', name: 'Howo 752', capacity: 8, fuelRate: 40, ureaRate: 0, platonRatePerKm: 0, balance: 0, residual: 0, mileage: 1 };
const DATA = { materials: [], aggregateTrucks: [], plants: [], personnelSummary: { byPlant: {}, sharedTotal: 0 }, config: {} };
const PLANT = { id: 'p', name: 'Джага', neighborCitySurcharge: 1500 };
const RECIPE = { id: 'r', name: 'М300', salePrice: 11000, items: [] };
function calcInput(extra) {
  return Object.assign({
    plant: PLANT, recipe: RECIPE, mixer: MIXER, data: DATA, saleVolume: 20, dist: 50, addressFilled: true,
    priceNet: 11000, vatGrossMode: false, nbCity: false, fuelPrice: 75, ureaPrice: 0, deliveryChargePerM3: 700
  }, extra);
}
const hiredCalc = (rate, charge, extra) => w.OrderCalc.run(calcInput(Object.assign({ deliveryMode: 'hired', hireRate: rate, deliveryChargePerM3: charge }, extra)));

test('Доставка в плюс: 20 м³ × 500 — расход 10 000, выручка 14 000, прибыль 4 000', () => {
  const c = hiredCalc(500, 700);
  assert.strictEqual(c.deliveryReady, true);
  assert.strictEqual(c.deliveryCostTotal, 10000);
  assert.strictEqual(c.deliveryRevenue, 14000);
  assert.strictEqual(c.deliveryProfit, 4000);
  assert.strictEqual(c.trips, 0);
  assert.strictEqual(c.fuelCostPerTrip + c.amortCostPerTrip + c.surchargePerTrip + c.ureaCostPerTrip + c.platonCostPerTrip, 0);
});

test('Ставка выше цены клиенту: прибыль −1 000, безубыточно от 750', () => {
  const c = hiredCalc(750, 700);
  assert.strictEqual(c.deliveryCostTotal, 15000);
  assert.strictEqual(c.deliveryProfit, -1000);
  assert.strictEqual(c.deliveryBreakevenPerM3, 750);
});

test('Бесплатная доставка: выручка 0, прибыль −10 000', () => {
  const c = hiredCalc(500, 0);
  assert.strictEqual(c.deliveryRevenue, 0);
  assert.strictEqual(c.deliveryProfit, -10000);
});

test('Соседний город не влияет: надбавка не начисляется', () => {
  const c = hiredCalc(500, 700, { nbCity: true });
  assert.strictEqual(c.surchargePerTrip, 0);
  assert.strictEqual(c.deliveryCostTotal, 10000);
});

test('Найм без ставки или адреса — доставка не готова; без км — готова', () => {
  assert.strictEqual(hiredCalc(0, 700).deliveryReady, false);
  assert.strictEqual(hiredCalc(500, 700, { addressFilled: false }).deliveryReady, false);
  assert.strictEqual(hiredCalc(500, 700, { dist: 0, mixer: null }).deliveryReady, true);
});

test('Заказ на своём миксере после выкатки: 3 рейса, 9 000 ₽; самовывоз — 0', () => {
  const own = w.OrderCalc.run(calcInput({ deliveryMode: 'own', deliveryChargePerM3: 500 }));
  assert.strictEqual(own.trips, 3);
  assert.strictEqual(own.deliveryCostTotal, 9000);
  const legacy = w.OrderCalc.run(calcInput({ selfPickup: false, deliveryChargePerM3: 500 }));
  assert.strictEqual(legacy.deliveryCostTotal, 9000);
  const pickup = w.OrderCalc.run(calcInput({ deliveryMode: 'pickup' }));
  assert.strictEqual(pickup.trips, 0);
  assert.strictEqual(pickup.deliveryCostTotal, 0);
  assert.strictEqual(pickup.deliveryRevenue, 0);
});

test('Payload найма: режим, ставка, «Найм» без миксера, км и адрес сохраняются', () => {
  const input = calcInput({ deliveryMode: 'hired', hireRate: 500, address: 'пос. Северный', dist: 30, nbCity: true, maxLoad: 5 });
  const payload = w.OrderCalc.toOrderPayload(input, w.OrderCalc.run(input));
  assert.strictEqual(payload.deliveryMode, 'hired');
  assert.strictEqual(payload.hireRatePerM3, 500);
  assert.strictEqual(payload.mixerName, 'Найм');
  assert.strictEqual(payload.mixerId, null);
  assert.strictEqual(payload.mixerPlate, '');
  assert.strictEqual(payload.maxLoadM3, null);
  assert.strictEqual(payload.neighborCity, false);
  assert.strictEqual(payload.tripCount, 0);
  assert.strictEqual(payload.distanceKm, 30);
  assert.strictEqual(payload.address, 'пос. Северный');
  assert.strictEqual(payload.deliveryCostTotal, 10000);
  const own = calcInput({ deliveryMode: 'own', address: 'ул. Ленина, 5' });
  const ownPayload = w.OrderCalc.toOrderPayload(own, w.OrderCalc.run(own));
  assert.strictEqual(ownPayload.deliveryMode, 'own');
  assert.strictEqual(ownPayload.hireRatePerM3, null);
  assert.strictEqual(ownPayload.mixerName, 'Howo 752');
});

test('Payload найма проходит серверную проверку и сохраняется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  const input = calcInput({ plant: { id: p.id, name: p.name }, recipe: Object.assign({}, RECIPE, { id: r.id, name: r.name }),
    deliveryMode: 'hired', hireRate: 500, address: 'пос. Северный', dist: 30 });
  const payload = Object.assign(w.OrderCalc.toOrderPayload(input, w.OrderCalc.run(input)), { clientId: c.id, clientName: c.name, clientType: 'individual' });
  const o = await orders.create(JSON.parse(JSON.stringify(payload)));
  assert.strictEqual(o.deliveryMode, 'hired');
  assert.strictEqual(o.deliveryCostTotal, 10000);
});

// ---- Память клиента (clients/memory: «Найм не затирает миксер») ----
const clientsApi = require('../handlers/clients');
const ClientMemory = require('../../frontend-v2/js/client-memory');

async function memoryOf(clientId) {
  return (await clientsApi.list({})).find((x) => x.id === clientId);
}

test('Разовый найм: объект и цена доставки записаны, миксер, ограничение и соседний город на месте', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  // Память до найма: «ул. Ленина, 5», 12 км, 600 ₽/м³, «Миксер 3», 5 м³, соседний город.
  await fx.order(p, c, r, m, { address: 'ул. Ленина, 5', distanceKm: 12, deliveryChargePerM3: 600, maxLoadM3: 5, neighborCity: true });
  await fx.order(p, c, r, null, hiredExtra({ address: 'пос. Северный', distanceKm: 30, deliveryChargePerM3: 700 }));
  const mem = await memoryOf(c.id);
  assert.strictEqual(mem.siteAddress, 'пос. Северный');
  assert.strictEqual(mem.siteDistanceKm, 30);
  assert.strictEqual(mem.deliveryChargePerM3, 700);
  assert.strictEqual(mem.selfPickup, false);
  assert.strictEqual(mem.mixerId, m.id);
  assert.strictEqual(mem.maxLoadM3, 5);
  assert.strictEqual(mem.siteNeighborCity, true);
  assert.ok(!('hireRatePerM3' in mem) || mem.hireRatePerM3 == null);
});

test('Найм после самовывоза: самовывоз в памяти выключен', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  await fx.order(p, c, r, null);
  assert.strictEqual((await memoryOf(c.id)).selfPickup, true);
  await fx.order(p, c, r, null, hiredExtra());
  assert.strictEqual((await memoryOf(c.id)).selfPickup, false);
});

test('Следующий заказ после найма: подставляется миксер и новый объект, режим не запоминается', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  await fx.order(p, c, r, m);
  await fx.order(p, c, r, null, hiredExtra());
  const terms = ClientMemory.termsToApply(await memoryOf(c.id), [{ id: m.id, name: m.name, capacity: 8 }]);
  assert.strictEqual(terms.selfPickup, false);
  assert.strictEqual(terms.mixerId, m.id);
  assert.strictEqual(terms.address, 'пос. Северный');
  assert.strictEqual(terms.distanceKm, 30);
  assert.ok(!('deliveryMode' in terms));
  assert.ok(!('hireRate' in terms));
});

// ---- Исправление заказа (orders/order-edit: блокировка режима) ----
const MANAGER = { role: 'manager', plantId: null };
// Тело исправления: исходный заказ + правки, версия — открытая в форме.
function editBody(o, extra) {
  const body = Object.assign({}, o, extra);
  body.version = extra && extra.version != null ? extra.version : o.version;
  return body;
}

test('Перевести в найм при разнесённых рейсах: 409, заказ не меняется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const o = await fx.order(p, c, r, m, { saleVolume: 20, tripCount: 3 });
  const drv = await fx.driver(p.id, 'Иванов');
  await fx.waybillEntry(o.id, drv, m, { date: '2026-10-20', plantId: p.id, plantName: p.name });
  await assert.rejects(orders.update(o.id, editBody(o, hiredExtra()), MANAGER),
    { status: 409, message: 'По заказу есть путевые листы — сначала удалите их' });
  const { rows } = await db.pool.query('SELECT delivery_mode, trip_count, version FROM orders WHERE id = $1', [o.id]);
  assert.strictEqual(rows[0].delivery_mode, 'own');
  assert.strictEqual(Number(rows[0].trip_count), 3);
});

test('Перевести в найм без путевых: режим «Найм», 0 рейсов, расход 10 000', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const o = await fx.order(p, c, r, m, { saleVolume: 20, tripCount: 3, deliveryCostTotal: 9000 });
  const res = await orders.update(o.id, editBody(o, hiredExtra()), MANAGER);
  assert.strictEqual(res.deliveryMode, 'hired');
  assert.strictEqual(res.tripCount, 0);
  assert.strictEqual(res.deliveryCostTotal, 10000);
  assert.strictEqual(res.hireRatePerM3, 500);
  assert.strictEqual(res.mixerId, null);
});

test('Ставку найма можно менять при любом состоянии; без deliveryMode «Найм» требует ставку', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  const o = await fx.order(p, c, r, null, hiredExtra());
  const res = await orders.update(o.id, editBody(o, { hireRatePerM3: 550 }), MANAGER);
  assert.strictEqual(res.hireRatePerM3, 550);
  // Старая форма: без режима, но со снимком «Найм» и без ставки — 400.
  const legacy = editBody(res, { hireRatePerM3: undefined });
  delete legacy.deliveryMode;
  await assert.rejects(orders.update(o.id, legacy, MANAGER), { status: 400, message: 'Укажите ставку найма' });
});

// ---- Журнал исправлений (orders/order-edit: «Строки журнала о доставке») ----
const { diffOrder } = require('../order-edit-diff');
const base = { plantName: 'Северный', createdAt: '2026-10-20T10:00:00Z', recipeName: 'М300', saleVolume: 20, clientName: 'СтройИнвест',
  salePrice: 10000, vatApplied: false, address: 'пос. Северный', distanceKm: 30, neighborCity: false, deliveryChargePerM3: 700,
  maxLoadM3: null, fuelPricePerLiter: 75, ureaPricePerLiter: 0 };
const ownOrder = Object.assign({}, base, { deliveryMode: 'own', mixerName: 'Миксер 3', hireRatePerM3: null });
const hiredOrder = Object.assign({}, base, { deliveryMode: 'hired', mixerName: 'Найм', hireRatePerM3: 500 });
const texts = (a, b) => diffOrder(a, b).map((c) => c.text);

test('Журнал: перевели в найм — Доставка, Миксер и Ставка найма', () => {
  const lines = texts(ownOrder, hiredOrder);
  assert.ok(lines.includes('Доставка: Своя → Найм'), lines.join('\n'));
  assert.ok(lines.includes('Миксер: Миксер 3 → —'), lines.join('\n'));
  assert.ok(lines.includes('Ставка найма: — → 500 ₽/м³'), lines.join('\n'));
});

test('Журнал: поменяли ставку — без строки «Доставка»', () => {
  const lines = texts(hiredOrder, Object.assign({}, hiredOrder, { hireRatePerM3: 550 }));
  assert.deepStrictEqual(lines, ['Ставка найма: 500 → 550 ₽/м³']);
});

test('Журнал: самовывоз — «Доставка: Своя → Самовывоз»; старый заказ без режима', () => {
  const pickup = Object.assign({}, base, { mixerName: 'Самовывоз', hireRatePerM3: null }); // без deliveryMode — как до выкатки
  const lines = texts(ownOrder, pickup);
  assert.ok(lines.includes('Доставка: Своя → Самовывоз'), lines.join('\n'));
  assert.ok(!lines.some((l) => l.startsWith('Самовывоз:')));
  assert.deepStrictEqual(texts(ownOrder, Object.assign({}, ownOrder, { deliveryMode: undefined })), []);
});

// ---- Telegram (orders/hired-delivery: «Наёмный заказ в Telegram») ----
test('Уведомление о найме: «Доставка: Найм · 500 ₽/м³» вместо миксера', async (t) => {
  if (!(await requireDb(t))) return;
  await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_chat_id = 'orders-chat' WHERE id = 1");
  const sent = [];
  telegram.transport.post = async (botToken, chatId, text) => { sent.push(text); };
  try {
    const { p, c, r, m } = await setup();
    await fx.order(p, c, r, null, hiredExtra());
    await new Promise((res) => setTimeout(res, 50));
    const msg = sent.pop();
    assert.ok(msg.includes('Доставка: Найм · 500 ₽/м³'), msg);
    assert.ok(!msg.includes('Миксер:'), msg);
    assert.ok(msg.includes('Объём: 20 м³'), msg);
    assert.ok(msg.includes('Расстояние: 30 км'), msg);
    await fx.order(p, c, r, m);
    await new Promise((res) => setTimeout(res, 50));
    const own = sent.pop();
    assert.ok(own.includes('Миксер: Миксер 3'), own);
    assert.ok(!own.includes('Доставка:'), own);
  } finally {
    telegram.transport.post = async () => {};
  }
});

// ---- Путевые листы и бронь (orders/hired-delivery: «Наёмный заказ без рейсов») ----
const waybillEntries = require('../handlers/waybill-entries');

test('Путевые листы: разнесение рейса по наёмному заказу отклоняется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const o = await fx.order(p, c, r, null, hiredExtra());
  const drv = await fx.driver(p.id, 'Иванов');
  await assert.rejects(waybillEntries.create({
    orderId: o.id, tripDate: '2026-10-20', driverId: drv.id, driverName: drv.name,
    mixerId: m.id, mixerName: m.name, distanceKm: 30, tripCount: 1
  }), (err) => err.status === 400 && /Превышено число рейсов/.test(err.message));
  assert.strictEqual(await rowCount('SELECT count(*) AS n FROM waybill_entries WHERE order_id = $1', [o.id]), 0);
});

test('Бронь: наёмный заказ бронирует материалы так же, как заказ на своём миксере', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r, m } = await setup();
  const cement = await fx.material(p.id, 'Цемент', 100000);
  const mats = [{ name: 'Цемент', unit: 'кг', qty: 3000, materialId: cement.id }];
  const reserved = async () => Number((await db.pool.query('SELECT stock_reserved FROM materials WHERE id = $1', [cement.id])).rows[0].stock_reserved);
  await fx.order(p, c, r, null, hiredExtra({ saleVolume: 10, materials: mats }));
  assert.strictEqual(await reserved(), 3000);
  await fx.order(p, c, r, m, { saleVolume: 10, materials: mats });
  assert.strictEqual(await reserved(), 6000);
});

// ---- Права (orders/hired-delivery: «Права на режим «Найм»») ----
test('Работник по ссылке завода оформляет найм', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  const res = await call('POST', '/api/orders?token=' + p.token, { json: fx.orderBody(p, c, r, null, hiredExtra()) });
  assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  assert.strictEqual(res.data.deliveryMode, 'hired');
});

test('Миграция восстанавливает найм, оформленный на старом сервере: ставка = расход / объём', async (t) => {
  if (!(await requireDb(t))) return;
  const { p, c, r } = await setup();
  const o = await fx.order(p, c, r, null, hiredExtra({ saleVolume: 5, deliveryCostTotal: 2000 }));
  // Как сохранял старый сервер: режима и ставки нет, снимок «Найм» остался.
  await db.pool.query("UPDATE orders SET delivery_mode = 'own', hire_rate_per_m3 = NULL WHERE id = $1", [o.id]);
  await db.migrate();
  const { rows } = await db.pool.query('SELECT delivery_mode, hire_rate_per_m3 FROM orders WHERE id = $1', [o.id]);
  assert.strictEqual(rows[0].delivery_mode, 'hired');
  assert.strictEqual(Number(rows[0].hire_rate_per_m3), 400);
});
