// Сценарии спеки clients/memory (change client-list): что хранится, как
// перезаписывается заказом ("оператор — первая инстанция") и правкой в CRM.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetClients, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const clients = require('../handlers/clients');
const orders = require('../handlers/orders');
const recipes = require('../handlers/recipes');
const telegram = require('../telegram');

let sent = [];
telegram.transport.post = async (botToken, chatId, text) => { sent.push(text); };

test.after(stop);
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

const flush = () => new Promise((r) => setTimeout(r, 50));

// Завод с М300 (прайс 11 000) и М350 (11 500), миксеры на 8 и 10 м³,
// клиент «СтройИнвест» этого завода.
async function setup() {
  const p = await fx.plant('Джага');
  const m300 = await fx.recipe(p.id, 'М300', 11000);
  const m350 = await fx.recipe(p.id, 'М350', 11500);
  const mx1 = await fx.mixer('Миксер 1', 8);
  const mx3 = await fx.mixer('Миксер 3', 10);
  const c = await fx.client('СтройИнвест', p.id, 'legal');
  return { p, m300, m350, mx1, mx3, c };
}

async function memory(clientId) {
  return (await clients.list({})).find((x) => x.id === clientId);
}
function priceOf(mem, recipeId) { return mem.prices.find((x) => x.recipeId === recipeId); }

test('Новый клиент: памяти нет, НДС «без»', async (t) => {
  if (!(await requireDb(t))) return;
  const p = await fx.plant('Джага');
  const c = await clients.create({ name: 'Новый', plantId: p.id });
  assert.deepStrictEqual(c.prices, []);
  assert.strictEqual(c.vatGross, false);
  assert.strictEqual(c.siteAddress, '');
  assert.strictEqual(c.siteDistanceKm, null);
  assert.strictEqual(c.deliveryChargePerM3, null);
  assert.strictEqual(c.mixerId, null);
  assert.strictEqual(c.maxLoadM3, null);
  assert.strictEqual(c.selfPickup, false);
});

test('Оператор перебил цену: М300 10 700 → 10 000, М350 без изменений', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await clients.setPrice(s.c.id, s.m300.id, { priceNet: 10700 }, 'manager');
  await clients.setPrice(s.c.id, s.m350.id, { priceNet: 11500 }, 'manager');
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10000 }));
  const mem = await memory(s.c.id);
  assert.strictEqual(priceOf(mem, s.m300.id).priceNet, 10000);
  assert.strictEqual(priceOf(mem, s.m300.id).source, 'order');
  assert.strictEqual(priceOf(mem, s.m300.id).sourceLabel, 'Заказ · Джага');
  assert.strictEqual(priceOf(mem, s.m350.id).priceNet, 11500);
  assert.strictEqual(priceOf(mem, s.m350.id).source, 'crm');
});

test('Цена введена с НДС: 12 200 / 1,22 = 10 000 без НДС, режим «с НДС»', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  // Форма шлёт цену уже без НДС (OrderCalc: priceNet), vatApplied — режим.
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 12200 / 1.22, vatApplied: true }));
  const mem = await memory(s.c.id);
  assert.strictEqual(Math.round(priceOf(mem, s.m300.id).priceNet * 100) / 100, 10000);
  assert.strictEqual(mem.vatGross, true);
});

test('Значение совпало: цена та же, дата обновляется', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await clients.setPrice(s.c.id, s.m300.id, { priceNet: 10700 }, 'manager');
  await db.pool.query("UPDATE client_prices SET updated_at = '2026-10-01T09:00:00Z'");
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10700 }));
  const pr = priceOf(await memory(s.c.id), s.m300.id);
  assert.strictEqual(pr.priceNet, 10700);
  assert.ok(new Date(pr.updatedAt) > new Date('2026-10-02T00:00:00Z'));
});

test('Новый объект перезаписывает прежний', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { address: 'ул. Ленина, 5', distanceKm: 12 }));
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx3, { address: 'пос. Северный', distanceKm: 30, neighborCity: true, deliveryChargePerM3: 700 }));
  const mem = await memory(s.c.id);
  assert.strictEqual(mem.siteAddress, 'пос. Северный');
  assert.strictEqual(mem.siteDistanceKm, 30);
  assert.strictEqual(mem.siteNeighborCity, true);
  assert.strictEqual(mem.deliveryChargePerM3, 700);
  assert.strictEqual(mem.mixerId, s.mx3.id);
  assert.strictEqual(mem.termsSource, 'order');
});

test('Ограничение загрузки сохраняется, снимается и не сохраняется сверх вместимости', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  // Форма шлёт maxLoadM3 только когда загрузка меньше вместимости.
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { maxLoadM3: 5, tripCount: 2 }));
  assert.strictEqual((await memory(s.c.id)).maxLoadM3, 5);
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { maxLoadM3: null }));
  assert.strictEqual((await memory(s.c.id)).maxLoadM3, null);
  // Введено 10 на миксере 8 → расчёт по вместимости → форма шлёт null.
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1));
  assert.strictEqual((await memory(s.c.id)).maxLoadM3, null);
});

test('Заказ не оформлен (сервер отклонил): память не меняется', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await clients.setPrice(s.c.id, s.m300.id, { priceNet: 10700 }, 'manager');
  await assert.rejects(orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10000, saleVolume: 'abc' })), { status: 400 });
  // Отказ уже внутри транзакции (после записи памяти) — тоже откат.
  await assert.rejects(orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, {
    salePrice: 10000, materials: [{ name: 'Цемент', unit: 'т', qty: 1, materialId: 'нет-такого' }]
  })));
  assert.strictEqual(priceOf(await memory(s.c.id), s.m300.id).priceNet, 10700);
});

test('Разовый самовывоз не затирает объект, миксер и загрузку', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { address: 'ул. Ленина, 5', distanceKm: 12, maxLoadM3: 5 }));
  await orders.create(fx.orderBody(s.p, s.c, s.m350, null, { salePrice: 11000 }));
  let mem = await memory(s.c.id);
  assert.strictEqual(mem.selfPickup, true);
  assert.strictEqual(mem.siteAddress, 'ул. Ленина, 5');
  assert.strictEqual(mem.siteDistanceKm, 12);
  assert.strictEqual(mem.mixerId, s.mx1.id);
  assert.strictEqual(mem.maxLoadM3, 5);
  assert.strictEqual(priceOf(mem, s.m350.id).priceNet, 11000);
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1));
  mem = await memory(s.c.id);
  assert.strictEqual(mem.selfPickup, false);
});

test('Старое тело без recipeId/mixerId/selfPickup: заказ создаётся, цена и миксер не пишутся', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { address: 'ул. Ленина, 5' }));
  const body = fx.orderBody(s.p, s.c, s.m300, s.mx3, { address: 'пос. Северный', salePrice: 9000 });
  delete body.recipeId; delete body.mixerId; delete body.selfPickup;
  const o = await orders.create(body);
  assert.ok(o.id);
  const mem = await memory(s.c.id);
  assert.strictEqual(priceOf(mem, s.m300.id).priceNet, 11000);
  assert.strictEqual(mem.mixerId, s.mx1.id);
  assert.strictEqual(mem.siteAddress, 'пос. Северный');
  const pickup = fx.orderBody(s.p, s.c, s.m300, null);
  delete pickup.selfPickup;
  await orders.create(pickup);
  assert.strictEqual((await memory(s.c.id)).selfPickup, true);
});

test('Отменили заказ с новой ценой: память не откатывается', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const o = await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10000 }));
  await orders.cancel(o.id);
  assert.strictEqual(priceOf(await memory(s.c.id), s.m300.id).priceNet, 10000);
  await orders.remove(o.id);
  assert.strictEqual(priceOf(await memory(s.c.id), s.m300.id).priceNet, 10000);
});

test('Правка в CRM после заказа: последняя запись побеждает', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10000 }));
  const res = await call('PUT', '/api/clients/' + s.c.id + '/prices/' + s.m300.id, { cookie: await cookieFor('manager'), json: { priceNet: 10500 } });
  assert.strictEqual(res.status, 200);
  const pr = priceOf(res.data, s.m300.id);
  assert.strictEqual(pr.priceNet, 10500);
  assert.strictEqual(pr.source, 'crm');
  assert.strictEqual(pr.sourceLabel, 'CRM · manager');
  const terms = await clients.update(s.c.id, { name: 'СтройИнвест', type: 'legal', siteAddress: 'пос. Южный' });
  assert.strictEqual(terms.termsSource, 'crm');
  assert.strictEqual(terms.siteAddress, 'пос. Южный');
});

test('Одновременные заказы по одному клиенту не дают ошибки', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await Promise.all([
    orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10000 })),
    orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { salePrice: 10100 }))
  ]);
  assert.ok([10000, 10100].includes(priceOf(await memory(s.c.id), s.m300.id).priceNet));
});

test('Добавление цены по КП и удаление строки (manager)', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const cookie = await cookieFor('manager');
  const res = await call('PUT', '/api/clients/' + s.c.id + '/prices/' + s.m300.id, { cookie, json: { priceNet: 10700 } });
  assert.strictEqual(priceOf(res.data, s.m300.id).priceNet, 10700);
  const del = await call('DELETE', '/api/clients/' + s.c.id + '/prices/' + s.m300.id, { cookie });
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual(del.data.prices, []);
});

test('Цена клиенту без завода и по рецепту другого завода — 400', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const other = await fx.plant('Теберда');
  const foreign = await fx.recipe(other.id, 'М250', 9800);
  const noPlant = await fx.client('Иванов И.', null);
  await assert.rejects(clients.setPrice(noPlant.id, s.m300.id, { priceNet: 10000 }, 'manager'), { status: 400, message: /Сначала выберите завод/ });
  await assert.rejects(clients.setPrice(s.c.id, foreign.id, { priceNet: 9800 }, 'manager'), { status: 400, message: /другого завода/ });
});

test('Работник пытается править память напрямую — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await clients.setPrice(s.c.id, s.m300.id, { priceNet: 10700 }, 'manager');
  for (const [method, url, json] of [
    ['PUT', '/api/clients/' + s.c.id + '/prices/' + s.m300.id + '?token=' + s.p.token, { priceNet: 1 }],
    ['DELETE', '/api/clients/' + s.c.id + '/prices/' + s.m300.id + '?token=' + s.p.token, undefined],
    ['PUT', '/api/clients/' + s.c.id + '?token=' + s.p.token, { name: 'СтройИнвест', siteAddress: 'x' }]
  ]) {
    const res = await call(method, url, { json });
    assert.strictEqual(res.status, 403, method + ' ' + url);
  }
  assert.strictEqual(priceOf(await memory(s.c.id), s.m300.id).priceNet, 10700);
});

test('Подняли прайс — цена клиента прежняя; удалили рецепт — строки цен исчезли', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const c2 = await fx.client('Петров П.', s.p.id);
  await clients.setPrice(s.c.id, s.m300.id, { priceNet: 10700 }, 'manager');
  await clients.setPrice(s.c.id, s.m350.id, { priceNet: 11500 }, 'manager');
  await clients.setPrice(c2.id, s.m350.id, { priceNet: 11400 }, 'manager');
  // Прайс и название меняем прямо в БД: recipes.update требует состав рецепта,
  // а здесь важно только, что цены клиентов при этом не трогаются.
  await db.pool.query("UPDATE recipes SET name = 'М300 F150', sale_price = 12000 WHERE id = $1", [s.m300.id]);
  let mem = await memory(s.c.id);
  assert.strictEqual(priceOf(mem, s.m300.id).priceNet, 10700);
  await recipes.remove(s.m350.id);
  mem = await memory(s.c.id);
  assert.strictEqual(priceOf(mem, s.m350.id), undefined);
  assert.strictEqual(priceOf(mem, s.m300.id).priceNet, 10700);
  assert.deepStrictEqual((await memory(c2.id)).prices, []);
});

test('Заказ с памятью и без: поля заказа и Telegram совпадают по составу', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const plain = fx.orderBody(s.p, s.c, s.m300, s.mx1);
  delete plain.recipeId; delete plain.mixerId; delete plain.selfPickup; delete plain.maxLoadM3;
  const a = await orders.create(plain);
  const b = await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1));
  await flush();
  assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort());
  assert.strictEqual(a.maxLoadM3, null);
  assert.strictEqual(b.maxLoadM3, null);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0], sent[1]);
  assert.ok(!sent[0].includes('Рейсов'));
});

// ---- Разовые покупатели (общий клиент «Физлицо») ----

test('Разовые покупатели: заказы на обоих заводах не назначают завод и не пишут память', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const p2 = await fx.plant('Теберда');
  const r2 = await fx.recipe(p2.id, 'М300', 11000);
  const fiz = await fx.client('Физлицо', null);
  await clients.update(fiz.id, { name: 'Физлицо', type: 'individual', walkIn: true });
  await orders.create(fx.orderBody(s.p, fiz, s.m300, s.mx1, { salePrice: 9000, address: 'ул. Мира, 1', maxLoadM3: 5 }));
  await orders.create(fx.orderBody(p2, fiz, r2, s.mx1, { salePrice: 9500 }));
  const mem = await memory(fiz.id);
  assert.strictEqual(mem.walkIn, true);
  assert.strictEqual(mem.plantId, null);
  assert.deepStrictEqual(mem.prices, []);
  assert.strictEqual(mem.siteAddress, '');
  assert.strictEqual(mem.maxLoadM3, null);
  assert.strictEqual(mem.termsUpdatedAt, null);
  assert.ok((await clients.list({ plantId: s.p.id })).some((c) => c.id === fiz.id));
  assert.ok((await clients.list({ plantId: p2.id })).some((c) => c.id === fiz.id));
});

test('Разовые покупатели: включение стирает завод, условия и цены; цену поставить нельзя', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await orders.create(fx.orderBody(s.p, s.c, s.m300, s.mx1, { address: 'ул. Ленина, 5', maxLoadM3: 5 }));
  const after = await clients.update(s.c.id, { name: 'СтройИнвест', type: 'legal', walkIn: true, plantId: s.p.id, siteAddress: 'x' });
  assert.strictEqual(after.walkIn, true);
  assert.strictEqual(after.plantId, null);
  assert.deepStrictEqual(after.prices, []);
  assert.strictEqual(after.siteAddress, '');
  assert.strictEqual(after.mixerId, null);
  assert.strictEqual(after.maxLoadM3, null);
  await assert.rejects(clients.setPrice(s.c.id, s.m300.id, { priceNet: 10000 }, 'manager'), { status: 400, message: /разовых покупателей/ });
  const back = await clients.update(s.c.id, { name: 'СтройИнвест', type: 'legal', walkIn: false, plantId: s.p.id });
  assert.strictEqual(back.walkIn, false);
  assert.strictEqual(back.plantId, s.p.id);
});
