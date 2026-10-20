// Change waybill-fuel-chain, задачи 1.1–1.2: снимок ставки л/100км в записи
// рейса и бэкфилл старых записей.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetWaybills, ready } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const orders = require('../handlers/orders');
const waybillEntries = require('../handlers/waybill-entries');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(async () => { const { close } = require('./helpers/db'); await close(); });
test.beforeEach(async () => { if (await ready()) await resetWaybills(); });

async function setup() {
  const p = await fx.plant('Джага');
  const r = await fx.recipe(p.id, 'М300', 11000);
  const m = await fx.mixer('Миксер №1', 8, { fuelRate: 40 });
  const c = await fx.client('СтройИнвест', p.id, 'legal');
  const drv = await fx.driver(p.id, 'Водитель 1');
  const o = await orders.create(fx.orderBody(p, c, r, m, { saleVolume: 20, tripCount: 3 }));
  return { p, m, drv, o };
}

test('Бэкфилл: ставка восстанавливается из стоимости рейса', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const id = await fx.waybillEntry(s.o.id, s.drv, s.m, { date: '2026-10-03', km: 50, fuelRate: 40, price: 75 });
  // Как у записи, созданной до колонки: ставки нет, стоимость 3 000 ₽.
  await db.pool.query('UPDATE waybill_entries SET fuel_rate = NULL WHERE id = $1', [id]);
  await db.pool.query("UPDATE mixers SET fuel_rate = 99 WHERE id = $1", [s.m.id]);
  await db.migrate();
  await db.migrate();
  const { rows } = await db.pool.query('SELECT fuel_cost_per_trip, fuel_rate FROM waybill_entries WHERE id = $1', [id]);
  assert.strictEqual(Number(rows[0].fuel_cost_per_trip), 3000);
  assert.strictEqual(Number(rows[0].fuel_rate), 40);
});

test('Бэкфилл: при цене 0 — ставка из карточки техники', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const id = await fx.waybillEntry(s.o.id, s.drv, s.m, { date: '2026-10-03', km: 50, fuelRate: 40, price: 0 });
  await db.pool.query('UPDATE waybill_entries SET fuel_rate = NULL WHERE id = $1', [id]);
  await db.migrate();
  const { rows } = await db.pool.query('SELECT fuel_rate FROM waybill_entries WHERE id = $1', [id]);
  assert.strictEqual(Number(rows[0].fuel_rate), 40);
});

test('Ставка в карточке изменилась после распределения', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const body = {
    orderId: s.o.id, tripDate: '2026-10-03', driverId: s.drv.id, driverName: s.drv.name,
    mixerId: s.m.id, mixerName: s.m.name, distanceKm: 12, tripCount: 1
  };
  const e = await waybillEntries.create(body);
  assert.strictEqual(e.fuelRate, 40);

  await db.pool.query('UPDATE mixers SET fuel_rate = 45 WHERE id = $1', [s.m.id]);
  const [kept] = await waybillEntries.getByIds([e.id]);
  assert.strictEqual(kept.fuelRate, 40, 'снимок не меняется при правке карточки');

  const updated = await waybillEntries.update(e.id, body);
  assert.strictEqual(updated.fuelRate, 45, 'изменение записи берёт новую ставку');
});
