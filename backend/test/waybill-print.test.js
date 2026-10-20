// Change waybill-fuel-chain, задачи 3.1–3.3: выгрузка 4-С по полной истории
// техники, печать готовых цифр топлива, учёт вне печатной формы по норме.
const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { db, requireDb, resetWaybills, ready } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const orders = require('../handlers/orders');
const waybillEntries = require('../handlers/waybill-entries');
const waybillDocs = require('../waybill-docs');
const waybillXlsx4s = require('../waybill-xlsx-4s');
const { buildWaybill4sDocuments } = require('../router');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(async () => { const { close } = require('./helpers/db'); await close(); });
test.beforeEach(async () => { if (await ready()) await resetWaybills(); });

async function setup() {
  const p = await fx.plant('Джага');
  await db.pool.query('UPDATE plants SET fuel_price = 75 WHERE id = $1', [p.id]);
  const r = await fx.recipe(p.id, 'М300', 11000);
  const m = await fx.mixer('Миксер №1', 8, { fuelRate: 40 });
  const c = await fx.client('СтройИнвест', p.id, 'legal');
  const drv = await fx.driver(p.id, 'Водитель 1');
  const o = await orders.create(fx.orderBody(p, c, r, m, { saleVolume: 100, tripCount: 50 }));
  const add = (o2) => fx.waybillEntry(o.id, drv, m, Object.assign({ plantId: p.id, plantName: p.name }, o2));
  return { p, m, drv, o, add };
}

// Значение ячейки inlineStr из XML листа (как её пишет setCell).
function cell(xml, addr) {
  const m = xml.match(new RegExp('<c r="' + addr + '"[^>]*t="inlineStr"><is><t[^>]*>([^<]*)</t>'));
  return m ? m[1] : null;
}
async function sheets(doc) {
  const zip = await JSZip.loadAsync(await waybillXlsx4s.buildDocumentWorkbook(doc, 'ООО Тест'));
  return {
    front: await zip.file('xl/worksheets/sheet1.xml').async('string'),
    back: await zip.file('xl/worksheets/sheet2.xml').async('string')
  };
}
function printableDoc(extra) {
  return Object.assign({
    id: 'x-p1', docNumber: 1, createdAt: new Date(2026, 9, 3, 12).toISOString(), plantName: 'Джага',
    driverName: 'Водитель 1', mixerName: 'Миксер №1', odometerStart: 1000, odometerEnd: 1300,
    timeStartMinutes: 540, timeEndMinutes: 780, engineMinutes: 200, totalFuelLiters: 120,
    fuelFactLiters: 120, fuelIssued: 122, fuelBalanceAtDeparture: 9.6, fuelBalanceAtReturn: 11.6,
    routes: [{ address: 'ул. Ленина, 5', plantName: 'Джага', cargo: 'Бетон', distanceKm: 50, tripCount: 3, tonsPerTrip: null, firstDropoffArrivalMinutes: 600 }],
    legs: []
  }, extra);
}

// ---- 3.1 ----

test('Выбрана одна запись из двух за день', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const a = await s.add({ date: '2026-10-03', trips: 1 });
  const b = await s.add({ date: '2026-10-03', trips: 1 });
  const [ea, eb] = await waybillEntries.getByIds([a, b]);
  const one = await buildWaybill4sDocuments([ea]);
  const both = await buildWaybill4sDocuments([ea, eb]);
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].legs.length, 2);
  const pick = (d) => [d.id, d.docNumber, d.totalFuelLiters, d.fuelFactLiters, d.fuelIssued, d.fuelBalanceAtDeparture, d.fuelBalanceAtReturn];
  assert.deepStrictEqual(pick(one[0]), pick(both[0]));
});

test('Выгружаются только листы с выбранными рейсами', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  await s.add({ date: '2026-10-03', trips: 2 });
  const b = await s.add({ date: '2026-10-05', trips: 2 });
  const docs = await buildWaybill4sDocuments(await waybillEntries.getByIds([b]));
  assert.deepStrictEqual(docs.map((d) => d.tripDate), ['2026-10-05']);
  assert.ok(docs[0].fuelBalanceAtDeparture > 0, 'остаток пришёл из листа 03.10, хотя он не выбран');
});

test('Номер, выданный до change, сохраняется', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const a = await s.add({ date: '2026-10-03', trips: 1 });
  const key = s.drv.id + '-' + s.m.id + '-2026-10-03-p1';
  const { rows } = await db.pool.query('INSERT INTO waybill_doc_numbers (doc_key) VALUES ($1) RETURNING number', [key]);
  const docs = await buildWaybill4sDocuments(await waybillEntries.getByIds([a]));
  assert.strictEqual(docs[0].id, key);
  assert.strictEqual(docs[0].docNumber, rows[0].number);
});

// ---- 3.2 ----

test('Сходимость лицевой стороны и оборота', async () => {
  const { front, back } = await sheets(printableDoc());
  assert.strictEqual(cell(front, 'AI25'), '122');
  assert.strictEqual(cell(front, 'AL25'), '9,6');
  assert.strictEqual(cell(front, 'AO25'), '11,6');
  assert.strictEqual(cell(back, 'A33'), '120,0');
  assert.strictEqual(cell(back, 'C33'), '120,0');
});

test('Лист без нормы — блок топлива пуст', async () => {
  const { front, back } = await sheets(printableDoc({ totalFuelLiters: 0, fuelFactLiters: 0, fuelIssued: 0, fuelBalanceAtDeparture: null, fuelBalanceAtReturn: null }));
  assert.strictEqual(cell(front, 'AE25'), null);
  assert.strictEqual(cell(front, 'AI25'), null);
  assert.strictEqual(cell(back, 'C33'), '0,0');
});

test('Третья смена до ночи — печать времени', async () => {
  const { front } = await sheets(printableDoc({ timeStartMinutes: 23 * 60, timeEndMinutes: 24 * 60 + 20 }));
  assert.strictEqual(cell(front, 'AM16'), '0');
  assert.strictEqual(cell(front, 'AO16'), '20');
});

// ---- 3.3 ----

test('Стоимость рейса по норме', async (t) => {
  if (!(await requireDb(t))) return;
  const s = await setup();
  const e = await waybillEntries.create({
    orderId: s.o.id, tripDate: '2026-10-03', driverId: s.drv.id, driverName: s.drv.name,
    mixerId: s.m.id, mixerName: s.m.name, distanceKm: 50, tripCount: 1
  });
  assert.strictEqual(e.fuelCostPerTrip, 3000);
  const docs = await waybillDocs.loadVehicleDocs([s.m.id], '2026-12-31');
  assert.strictEqual(docs[0].totalFuelLiters, 40);
  assert.strictEqual(docs[0].fuelFactLiters, 40);
  const [kept] = await waybillEntries.getByIds([e.id]);
  assert.strictEqual(kept.fuelCostPerTrip, 3000, 'расчёт листа на стоимость рейса не влияет');
});
