// Change waybill-fuel-chain, задача 2.4: цепочка топлива по полной истории
// техники с хранимыми коэффициентами (спека waybills/fuel-chain).
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetWaybills, ready } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const orders = require('../handlers/orders');
const waybillDocs = require('../waybill-docs');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(async () => { const { close } = require('./helpers/db'); await close(); });
test.beforeEach(async () => { if (await ready()) await resetWaybills(); });

const UNTIL = '2026-12-31';
const FUEL = ['totalFuelLiters', 'fuelFactLiters', 'fuelIssued', 'fuelBalanceAtDeparture', 'fuelBalanceAtReturn'];
const fuelOf = (d) => FUEL.map((f) => d[f]);

async function setup() {
  const p = await fx.plant('Джага');
  const r = await fx.recipe(p.id, 'М300', 11000);
  const m1 = await fx.mixer('Миксер №1', 8, { fuelRate: 40 });
  const m2 = await fx.mixer('Миксер №2', 8, { fuelRate: 40 });
  const c = await fx.client('СтройИнвест', p.id, 'legal');
  const d1 = await fx.driver(p.id, 'Водитель 1');
  const d2 = await fx.driver(p.id, 'Водитель 2');
  const o = await orders.create(fx.orderBody(p, c, r, m1, { saleVolume: 100, tripCount: 50 }));
  const add = (drv, veh, o2) => fx.waybillEntry(o.id, drv, veh, Object.assign({ plantId: p.id, plantName: p.name }, o2));
  return { p, m1, m2, d1, d2, add };
}
const byDate = (docs, date) => docs.find((d) => d.tripDate === date);
async function coeffRows() {
  const { rows } = await db.pool.query("SELECT doc_key, target_p, start_s FROM waybill_doc_fuel WHERE doc_key LIKE 'temp_%' ORDER BY doc_key");
  return rows;
}

test('Повторная выгрузка без изменений', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 3 });
  await s.add(s.d2, s.m1, { date: '2026-10-05', trips: 2 });
  const first = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  const rowsAfterFirst = await coeffRows();
  const second = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  assert.deepStrictEqual(second.map(fuelOf), first.map(fuelOf));
  assert.deepStrictEqual(await coeffRows(), rowsAfterFirst, 'новых коэффициентов не появилось');
  assert.strictEqual(rowsAfterFirst.length, 2);
});

test('Перенос на следующий день и другому водителю', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 3 });
  await s.add(s.d2, s.m1, { date: '2026-10-05', trips: 2 });
  const docs = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  assert.strictEqual(byDate(docs, '2026-10-05').fuelBalanceAtDeparture, byDate(docs, '2026-10-03').fuelBalanceAtReturn);
});

test('Правка рейса задним числом', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 1 });
  await s.add(s.d2, s.m1, { date: '2026-10-05', trips: 2 });
  const before = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  const coeffsBefore = await coeffRows();

  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 1 });
  const after = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  assert.deepStrictEqual(await coeffRows(), coeffsBefore, 'коэффициенты прежние');
  assert.strictEqual(byDate(after, '2026-10-03').totalFuelLiters, 2 * byDate(before, '2026-10-03').totalFuelLiters);
  assert.strictEqual(byDate(after, '2026-10-05').fuelBalanceAtDeparture, byDate(after, '2026-10-03').fuelBalanceAtReturn);
  assert.strictEqual(byDate(after, '2026-10-05').fuelFactLiters, byDate(before, '2026-10-05').fuelFactLiters, 'факт листа 05.10 не изменился');
  assert.strictEqual(byDate(after, '2026-10-03').fuelFactLiters, byDate(after, '2026-10-03').totalFuelLiters, 'факт = норма');
});

test('Удаление рейса', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 1 });
  const mid = await s.add(s.d1, s.m1, { date: '2026-10-04', trips: 1 });
  await s.add(s.d1, s.m1, { date: '2026-10-05', trips: 1 });
  await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  await db.pool.query('DELETE FROM waybill_entries WHERE id = $1', [mid]);
  const docs = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(byDate(docs, '2026-10-05').fuelBalanceAtDeparture, byDate(docs, '2026-10-03').fuelBalanceAtReturn);
});

test('Добавлен рейс раньше первого листа', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 3 });
  const before = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  const startBefore = before[0].fuelBalanceAtDeparture;

  await s.add(s.d1, s.m1, { date: '2026-10-01', trips: 1 });
  const docs = await waybillDocs.loadVehicleDocs([s.m1.id], UNTIL);
  const d01 = byDate(docs, '2026-10-01');
  const d03 = byDate(docs, '2026-10-03');
  const { rows } = await db.pool.query('SELECT start_s FROM waybill_doc_fuel WHERE doc_key = $1', [d01.id]);
  assert.strictEqual(d01.fuelBalanceAtDeparture, waybillDocs.round1(d01.totalFuelLiters * Number(rows[0].start_s)));
  assert.strictEqual(d03.fuelBalanceAtDeparture, d01.fuelBalanceAtReturn);
  assert.ok(startBefore > 0);
});

test('Другая машина того же водителя', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d2, s.m2, { date: '2026-10-02', trips: 2 });
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 3 });
  await s.add(s.d1, s.m2, { date: '2026-10-04', trips: 1 });
  const docs = await waybillDocs.loadVehicleDocs([s.m1.id, s.m2.id], UNTIL);
  const m2docs = docs.filter((d) => d.mixerId === s.m2.id);
  assert.strictEqual(byDate(m2docs, '2026-10-04').fuelBalanceAtDeparture, byDate(m2docs, '2026-10-02').fuelBalanceAtReturn);
});

test('Более поздние рейсы не влияют на расчёт до даты', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add(s.d1, s.m1, { date: '2026-10-03', trips: 2 });
  await s.add(s.d1, s.m1, { date: '2026-11-03', trips: 2 });
  const docs = await waybillDocs.loadVehicleDocs([s.m1.id], '2026-10-31');
  assert.deepStrictEqual(docs.map((d) => d.tripDate), ['2026-10-03']);
});
