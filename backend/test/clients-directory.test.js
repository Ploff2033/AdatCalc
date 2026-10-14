// Сценарии спеки clients/directory (change client-list): привязка клиента к
// заводу, видимость по токену, назначение завода, выкатка без переноса данных.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetClients, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const clients = require('../handlers/clients');
const orders = require('../handlers/orders');
const plants = require('../handlers/plants');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(stop);
test.beforeEach(async () => { if (await ready()) await resetClients(); });

async function twoPlants() {
  return { p1: await fx.plant('Джага'), p2: await fx.plant('Теберда') };
}

function names(list) { return list.map((c) => c.name).sort(); }

test('Существующие клиенты после выкатки: на месте, без завода, связи заказов целы, память пуста', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  const r = await fx.recipe(p1.id, 'М300', 11000);
  const m = await fx.mixer('Howo 752', 8);
  const a = await fx.client('СтройИнвест', null, 'legal');
  const b = await fx.client('Иванов И.', null, 'individual');
  const order = await orders.create(fx.orderBody(p1, a, r, m));

  // Откатываем схему к состоянию "до change" (данные в старых колонках
  // остаются) и прогоняем migrate(), как при выкатке.
  await db.pool.query('UPDATE clients SET plant_id = NULL');
  await db.pool.query('DROP TABLE client_prices');
  for (const col of ['plant_id', 'vat_gross', 'site_address', 'site_distance_km', 'site_neighbor_city', 'delivery_charge_per_m3', 'self_pickup', 'mixer_id', 'max_load_m3', 'terms_updated_at', 'terms_source']) {
    await db.pool.query(`ALTER TABLE clients DROP COLUMN ${col}`);
  }
  await db.pool.query('ALTER TABLE orders DROP COLUMN max_load_m3');
  await db.migrate();

  const all = await clients.list({});
  const sa = all.find((c) => c.id === a.id);
  const iv = all.find((c) => c.id === b.id);
  assert.strictEqual(sa.name, 'СтройИнвест');
  assert.strictEqual(sa.type, 'legal');
  assert.strictEqual(iv.type, 'individual');
  for (const c of [sa, iv]) {
    assert.strictEqual(c.plantId, null);
    assert.deepStrictEqual(c.prices, []);
    assert.strictEqual(c.siteAddress, '');
    assert.strictEqual(c.maxLoadM3, null);
  }
  const { rows } = await db.pool.query('SELECT client_id, client_name, max_load_m3 FROM orders WHERE id = $1', [order.id]);
  assert.strictEqual(rows[0].client_id, a.id);
  assert.strictEqual(rows[0].client_name, 'СтройИнвест');
  assert.strictEqual(rows[0].max_load_m3, null);
  assert.deepStrictEqual(names(await clients.list({ plantId: p1.id })), ['Иванов И.', 'СтройИнвест']);
  assert.deepStrictEqual(names(await clients.list({ plantId: p2.id })), ['Иванов И.', 'СтройИнвест']);
});

test('Клиенты двух заводов: форма Завода 1 видит своих и «Без завода»', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  await fx.client('А', p1.id);
  await fx.client('Б', p2.id);
  await fx.client('В', null);
  const res = await call('GET', '/api/clients?token=' + p1.token);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(names(res.data), ['А', 'В']);
});

test('Попытка получить клиентов чужого завода: ?plantId= у работника игнорируется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  await fx.client('А', p1.id);
  await fx.client('Б', p2.id);
  await fx.client('В', null);
  const res = await call('GET', '/api/clients?token=' + p1.token + '&plantId=' + p2.id);
  assert.deepStrictEqual(names(res.data), ['А', 'В']);
  const noToken = await call('GET', '/api/clients');
  assert.notStrictEqual(noToken.status, 200);
});

test('Универсальная ссылка: клиенты выбранного завода и «Без завода»', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  await fx.client('А', p1.id);
  await fx.client('Б', p2.id);
  await fx.client('В', null);
  const { rows } = await db.pool.query('SELECT universal_worker_token AS t FROM config WHERE id = 1');
  const res = await call('GET', '/api/clients?token=' + rows[0].t + '&plantId=' + p2.id);
  assert.deepStrictEqual(names(res.data), ['Б', 'В']);
});

test('Manager без plantId видит всех клиентов, с plantId — завод и «Без завода»', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  await fx.client('А', p1.id);
  await fx.client('Б', p2.id);
  await fx.client('В', null);
  const cookie = await cookieFor('manager');
  assert.deepStrictEqual(names((await call('GET', '/api/clients', { cookie })).data), ['А', 'Б', 'В']);
  assert.deepStrictEqual(names((await call('GET', '/api/clients?plantId=' + p2.id, { cookie })).data), ['Б', 'В']);
});

test('Новый клиент с Завода 2: завод из токена, тело игнорируется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  const res = await call('POST', '/api/clients?token=' + p2.token, { json: { name: 'Петров П.', type: 'individual', plantId: p1.id } });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.plantId, p2.id);
  assert.deepStrictEqual(names((await call('GET', '/api/clients?token=' + p1.token)).data), []);
  assert.deepStrictEqual(names((await call('GET', '/api/clients?token=' + p2.token)).data), ['Петров П.']);
});

test('Новый клиент без токена (старый фронтенд) создаётся «Без завода»', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1 } = await twoPlants();
  const res = await call('POST', '/api/clients', { json: { name: 'Сидоров', plantId: p1.id } });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.plantId, null);
});

test('Первый заказ старого клиента назначает завод; у клиента с заводом завод не меняется', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  const r1 = await fx.recipe(p1.id, 'М300', 11000);
  const r2 = await fx.recipe(p2.id, 'М300', 11000);
  const m = await fx.mixer('Howo 752', 8);
  const c = await fx.client('СтройИнвест', null, 'legal');
  await orders.create(fx.orderBody(p1, c, r1, m));
  let all = await clients.list({});
  assert.strictEqual(all.find((x) => x.id === c.id).plantId, p1.id);
  assert.deepStrictEqual(names(await clients.list({ plantId: p2.id })), []);
  await orders.create(fx.orderBody(p2, c, r2, m));
  all = await clients.list({});
  assert.strictEqual(all.find((x) => x.id === c.id).plantId, p1.id);
});

test('Ручное назначение завода в CRM (manager); работник не может', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1, p2 } = await twoPlants();
  const c = await fx.client('Иванов И.', null);
  const worker = await call('PUT', '/api/clients/' + c.id + '?token=' + p1.token, { json: { name: 'Иванов И.', plantId: p1.id } });
  assert.strictEqual(worker.status, 403);
  const res = await call('PUT', '/api/clients/' + c.id, { cookie: await cookieFor('manager'), json: { name: 'Иванов И.', type: 'individual', plantId: p2.id } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.plantId, p2.id);
  assert.deepStrictEqual(names(await clients.list({ plantId: p1.id })), []);
});

test('Старый экран (только name/type) не обнуляет условия и завод', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1 } = await twoPlants();
  const c = await fx.client('А', p1.id);
  await clients.update(c.id, { name: 'А', siteAddress: 'ул. Ленина, 5', siteDistanceKm: 12, maxLoadM3: 5 });
  const after = await clients.update(c.id, { name: 'А2', type: 'legal' });
  assert.strictEqual(after.plantId, p1.id);
  assert.strictEqual(after.siteAddress, 'ул. Ленина, 5');
  assert.strictEqual(after.siteDistanceKm, 12);
  assert.strictEqual(after.maxLoadM3, 5);
});

test('Удаление завода с клиентами отклоняется 409', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1 } = await twoPlants();
  await fx.client('А', p1.id);
  await assert.rejects(plants.remove(p1.id), { status: 409 });
  const { rows } = await db.pool.query('SELECT plant_id FROM clients');
  assert.strictEqual(rows[0].plant_id, p1.id);
});

test('Удаление клиента с заказами: память удалена, заказ со снимком имени остаётся', async (t) => {
  if (!(await requireDb(t))) return;
  const { p1 } = await twoPlants();
  const r1 = await fx.recipe(p1.id, 'М300', 11000);
  const r2 = await fx.recipe(p1.id, 'М350', 11500);
  const m = await fx.mixer('Howo 752', 8);
  const c = await fx.client('СтройИнвест', p1.id, 'legal');
  const o = await orders.create(fx.orderBody(p1, c, r1, m));
  await clients.setPrice(c.id, r2.id, { priceNet: 11500 }, 'manager');
  await clients.remove(c.id);
  const { rows: prices } = await db.pool.query('SELECT count(*)::int AS n FROM client_prices WHERE client_id = $1', [c.id]);
  assert.strictEqual(prices[0].n, 0);
  const { rows } = await db.pool.query('SELECT client_id, client_name FROM orders WHERE id = $1', [o.id]);
  assert.strictEqual(rows[0].client_id, null);
  assert.strictEqual(rows[0].client_name, 'СтройИнвест');
});
