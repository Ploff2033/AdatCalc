// Change waybill-fuel-chain, задача 4.1: сводка списанного по путевым ГСМ
// (спека waybills/fuel-summary).
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetWaybills, ready } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const http = require('./helpers/http');
const orders = require('../handlers/orders');
const waybillEntries = require('../handlers/waybill-entries');
const waybillDocs = require('../waybill-docs');
const { buildWaybill4sDocuments } = require('../router');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(async () => { await http.stop(); });
test.beforeEach(async () => { if (await ready()) await resetWaybills(); });

const OCT = { from: '2026-10-01', to: '2026-10-31' };

async function setup() {
  const p = await fx.plant('Джага');
  const p2 = await fx.plant('Завод Б');
  const r = await fx.recipe(p.id, 'М300', 11000);
  const m1 = await fx.mixer('Миксер №1', 8, { fuelRate: 40 });
  const m2 = await fx.mixer('Миксер №2', 8, { fuelRate: 40 });
  const c = await fx.client('СтройИнвест', p.id, 'legal');
  const d1 = await fx.driver(p.id, 'Водитель 1');
  const o = await orders.create(fx.orderBody(p, c, r, m1, { saleVolume: 100, tripCount: 50 }));
  const add = (veh, o2) => fx.waybillEntry(o.id, d1, veh, Object.assign({ plantId: p.id, plantName: p.name }, o2));
  return { p, p2, m1, m2, d1, add };
}
const rowOf = (sum, vehicleId) => sum.rows.find((r) => r.vehicleId === vehicleId);

// Лист с нормой 2 400,0 л (3 рейса × 1 000 км × 40 л/100км) и
// коэффициентами, подобранными под пример спеки: выезд 15,0, факт = норма
// 2 400,0, выдано 2 408, возвращение 23,0.
async function octoberSheet(s) {
  await s.add(s.m1, { date: '2026-10-01', km: 1000, trips: 3 });
  const key = s.d1.id + '-' + s.m1.id + '-2026-10-01-p1';
  await db.pool.query('INSERT INTO waybill_doc_fuel (doc_key, target_p, start_s) VALUES ($1, $2, $3)',
    [key, 23 / 2400, 15 / 2400]);
}

test('Миксер за октябрь', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await octoberSheet(s);
  const row = rowOf(await waybillDocs.fuelSummary(OCT), s.m1.id);
  assert.deepStrictEqual(
    [row.normLiters, row.factLiters, row.issuedLiters, row.startLiters, row.endLiters, row.mismatch],
    [2400, 2400, 2408, 15, 23, false]
  );
});

test('Проверка равенства на нескольких листах', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  for (let day = 1; day <= 20; day++) await s.add(s.m1, { date: '2026-10-' + String(day).padStart(2, '0'), km: 20 + day, trips: 1 + (day % 4) });
  const row = rowOf(await waybillDocs.fuelSummary(OCT), s.m1.id);
  assert.strictEqual(row.mismatch, false);
  assert.strictEqual(waybillDocs.round1(row.startLiters + row.issuedLiters - row.factLiters), row.endLiters);
});

test('Техника без рейсов в периоде', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.m1, { date: '2026-10-03' });
  await s.add(s.m2, { date: '2026-11-03' });
  const sum = await waybillDocs.fuelSummary(OCT);
  assert.ok(rowOf(sum, s.m1.id));
  assert.strictEqual(rowOf(sum, s.m2.id), undefined);
});

test('Остаток на начало периода переносится из прошлого месяца', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.m1, { date: '2026-09-28', trips: 2 });
  await s.add(s.m1, { date: '2026-10-02', trips: 2 });
  const sep = rowOf(await waybillDocs.fuelSummary({ from: '2026-09-01', to: '2026-09-30' }), s.m1.id);
  const oct = rowOf(await waybillDocs.fuelSummary(OCT), s.m1.id);
  assert.strictEqual(oct.startLiters, sep.endLiters);
});

test('Лист ещё не печатался', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const id = await s.add(s.m1, { date: '2026-10-10', trips: 2 });
  const row = rowOf(await waybillDocs.fuelSummary(OCT), s.m1.id);
  const { rows: numbered } = await db.pool.query("SELECT 1 FROM waybill_doc_numbers WHERE doc_key LIKE 'temp_%'");
  assert.strictEqual(numbered.length, 0, 'сводка не выдаёт номера');
  const docs = await buildWaybill4sDocuments(await waybillEntries.getByIds([id]));
  assert.strictEqual(docs[0].fuelFactLiters, row.factLiters);
  assert.ok(docs[0].docNumber > 0, 'номер выдан при выгрузке');
});

test('Сумма по напечатанным листам', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const ids = [];
  for (let day = 1; day <= 6; day++) ids.push(await s.add(s.m1, { date: '2026-10-0' + day, trips: 2 + day }));
  const row = rowOf(await waybillDocs.fuelSummary(OCT), s.m1.id);
  const docs = await buildWaybill4sDocuments(await waybillEntries.getByIds(ids));
  assert.strictEqual(waybillDocs.round1(docs.reduce((acc, d) => acc + d.fuelFactLiters, 0)), row.factLiters);
  assert.strictEqual(docs.length, row.docs);
});

test('Миксер работал на двух заводах', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.m1, { date: '2026-10-03', plantId: s.p.id, plantName: s.p.name });
  await s.add(s.m1, { date: '2026-10-05', plantId: s.p2.id, plantName: s.p2.name });
  await s.add(s.m2, { date: '2026-10-05', plantId: s.p2.id, plantName: s.p2.name });
  const sum = await waybillDocs.fuelSummary(Object.assign({ plantId: s.p.id }, OCT));
  assert.deepStrictEqual(sum.rows.map((r) => r.vehicleId), [s.m1.id]);
  assert.strictEqual(sum.rows[0].docs, 2, 'строка включает листы обоих заводов');
});

test('Фильтр по технике', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.m1, { date: '2026-10-03' });
  await s.add(s.m2, { date: '2026-10-03' });
  const sum = await waybillDocs.fuelSummary(Object.assign({ vehicleId: s.m2.id }, OCT));
  assert.deepStrictEqual(sum.rows.map((r) => r.vehicleId), [s.m2.id]);
});

test('Итог по двум машинам', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await octoberSheet(s);
  await s.add(s.m2, { date: '2026-10-07', km: 300, trips: 3 });
  const sum = await waybillDocs.fuelSummary(OCT);
  const [a, b] = [rowOf(sum, s.m1.id), rowOf(sum, s.m2.id)];
  assert.strictEqual(sum.total.factLiters, waybillDocs.round1(a.factLiters + b.factLiters));
  assert.strictEqual(sum.total.factLiters, sum.total.normLiters, 'факт = норма');
  assert.strictEqual(sum.total.normLiters, 2400 + 720);
  assert.strictEqual(sum.total.issuedLiters, a.issuedLiters + b.issuedLiters);
});

test('Неверный период', async (t) => {
  if (!(await requireDb(t))) return;
  await assert.rejects(waybillDocs.fuelSummary({ from: '2026-10-31', to: '2026-10-01' }), { status: 400 });
  await assert.rejects(waybillDocs.fuelSummary({ from: '01.10.2026', to: '2026-10-31' }), { status: 400 });
});

test('Пользователь без доступа к путевым', async (t) => {
  if (!(await requireDb(t))) return;
  const anon = await http.call('GET', '/api/waybill-entries/fuel-summary?from=2026-10-01&to=2026-10-31');
  assert.ok(anon.status === 401 || anon.status === 403, 'статус ' + anon.status);
  const ok = await http.call('GET', '/api/waybill-entries/fuel-summary?from=2026-10-01&to=2026-10-31', { cookie: await http.cookieFor('manager') });
  assert.strictEqual(ok.status, 200);
  assert.ok(Array.isArray(ok.data.rows));
});
