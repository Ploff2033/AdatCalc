// Change waybill-fuel-chain, задачи 2.1–2.3: чистый расчёт листов 4-С —
// порядок рейсов, время и одометр (спека waybills/vehicle-timeline), норма и
// цепочка топлива (спека waybills/fuel-chain). Без БД.
const test = require('node:test');
const assert = require('node:assert');
const wd = require('../waybill-docs');

const CFG = { shiftStartMinutes: 540, avgSpeedKmh: 50, unloadMinutes: 20 };
let seq = 0;
function entry(o) {
  seq += 1;
  return Object.assign({
    id: 'e' + String(seq).padStart(3, '0'),
    tripDate: '2026-10-03', driverId: 'd1', driverName: 'Водитель 1', mixerId: 'm1', mixerName: 'Миксер №1',
    plantName: 'Джага', address: 'ул. Ленина, 5', distanceKm: 25, tripCount: 1, fuelRate: 40,
    fuelPricePerLiter: 75, fuelCostPerTrip: 0, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)).toISOString()
  }, o);
}
function build(entries, extra) {
  return wd.buildVehicleDocs(wd.orderVehicleEntries(entries), Object.assign({ cfg: CFG, baselineKm: 0 }, extra));
}
function chain(norms, coeffs) {
  const docs = norms.map((n, i) => ({ id: 'doc' + i, totalFuelLiters: n }));
  const map = new Map(coeffs.map((c, i) => ['doc' + i, c]));
  return wd.applyFuelChain(docs, map);
}

// ---- 2.1 Порядок рейсов техники ----

test('Записи двух водителей вперемешку', () => {
  const a = entry({ driverId: 'd1' });
  const b = entry({ driverId: 'd2' });
  const c = entry({ driverId: 'd1' });
  assert.deepStrictEqual(wd.orderVehicleEntries([c, b, a]).map((e) => e.id), [a.id, c.id, b.id]);
});

test('Порядок: сначала дата, потом смены', () => {
  const late = entry({ tripDate: '2026-10-05' });
  const early = entry({ tripDate: '2026-10-03', driverId: 'd2' });
  assert.deepStrictEqual(wd.orderVehicleEntries([late, early]).map((e) => e.id), [early.id, late.id]);
});

// ---- 2.2 Время, одометр, разбиение, норма ----

test('Две смены на одном миксере', () => {
  const docs = build([entry({ driverId: 'd1', tripCount: 3 }), entry({ driverId: 'd2', tripCount: 2 })]);
  assert.strictEqual(docs.length, 2);
  assert.deepStrictEqual([docs[0].timeStartMinutes, docs[0].timeEndMinutes], [9 * 60, 13 * 60]);
  assert.deepStrictEqual([docs[1].timeStartMinutes, docs[1].timeEndMinutes], [13 * 60, 15 * 60 + 40]);
  assert.strictEqual(docs[1].id, 'd2-m1-2026-10-03-p1');
});

test('Один водитель на двух машинах', () => {
  const m1 = build([entry({ mixerId: 'm1', tripCount: 3 })]);
  const m2 = build([entry({ mixerId: 'm2', tripCount: 1 })]);
  assert.strictEqual(m1[0].timeEndMinutes, 13 * 60);
  assert.strictEqual(m2[0].timeStartMinutes, 9 * 60, 'у второй машины своё начало смены');
});

test('Новый день начинается с начала смены', () => {
  const docs = build([entry({ tripCount: 3 }), entry({ tripDate: '2026-10-04', driverId: 'd2' })]);
  assert.strictEqual(docs[1].timeStartMinutes, 9 * 60);
});

test('Третья смена до ночи', () => {
  const docs = build([entry({ driverId: 'd3' })], { cfg: Object.assign({}, CFG, { shiftStartMinutes: 23 * 60 }) });
  assert.strictEqual(docs[0].timeEndMinutes, 24 * 60 + 20); // печатается как 0:20 (см. waybill-xlsx-4s.test.js)
  assert.strictEqual(docs[0].tripDate, '2026-10-03');
});

test('Одометр через смену', () => {
  const docs = build([entry({ driverId: 'd1', tripCount: 3 }), entry({ driverId: 'd2', tripCount: 2 })], { baselineKm: 1000 });
  assert.deepStrictEqual([docs[0].odometerStart, docs[0].odometerEnd], [1000, 1150]);
  assert.deepStrictEqual([docs[1].odometerStart, docs[1].odometerEnd], [1150, 1250]);
});

test('Десять ездок одного водителя', () => {
  const docs = build([entry({ tripCount: 10 })]);
  assert.deepStrictEqual(docs.map((d) => d.legs.length), [3, 3, 3, 1]);
  assert.deepStrictEqual(docs.map((d) => d.id.slice(-2)), ['p1', 'p2', 'p3', 'p4']);
  for (let i = 1; i < docs.length; i++) {
    assert.strictEqual(docs[i].timeStartMinutes, docs[i - 1].timeEndMinutes);
    assert.strictEqual(docs[i].odometerStart, docs[i - 1].odometerEnd);
  }
});

test('Норма за три рейса', () => {
  const docs = build([entry({ distanceKm: 50, tripCount: 3, fuelRate: 40 })]);
  assert.strictEqual(docs[0].totalFuelLiters, 120);
});

test('Цена топлива завода равна нулю', () => {
  const docs = build([entry({ distanceKm: 50, tripCount: 3, fuelRate: 40, fuelPricePerLiter: 0, fuelCostPerTrip: 0 })]);
  assert.strictEqual(docs[0].totalFuelLiters, 120);
});

test('В листе записаны входящие в него рейсы', () => {
  const a = entry({ tripCount: 1 });
  const b = entry({ tripCount: 1 });
  const docs = build([a, b]);
  assert.deepStrictEqual(docs[0].entryIds, [a.id, b.id]);
});

// ---- 2.3 Цепочка топлива ----

test('Первый лист машины', () => {
  const [d] = chain([120], [{ p: 0.1, s: 0.08 }]);
  assert.strictEqual(d.fuelBalanceAtDeparture, 9.6);
});

test('Факт равен норме', () => {
  const [d] = chain([120], [{ p: 0.1, s: 0.08 }]);
  assert.strictEqual(d.fuelFactLiters, 120);
});

test('Дозаправка до целевого остатка и расчёт остатка при возвращении', () => {
  const [d] = chain([120], [{ p: 0.1, s: 0.08 }]);
  assert.strictEqual(d.fuelIssued, 122);
  assert.strictEqual(d.fuelBalanceAtReturn, 11.6);
});

test('Перенос на следующий лист', () => {
  const docs = chain([120, 80], [{ p: 0.1, s: 0.08 }, { p: 0.15, s: 0.09 }]);
  assert.strictEqual(docs[1].fuelBalanceAtDeparture, 11.6);
  assert.strictEqual(docs[1].fuelFactLiters, 80);
  assert.strictEqual(docs[1].fuelIssued, 80);
  assert.strictEqual(docs[1].fuelBalanceAtReturn, 11.6);
});

test('Сумма факта равна сумме нормы', () => {
  const docs = chain([120, 80], [{ p: 0.1, s: 0.08 }, { p: 0.15, s: 0.09 }]);
  assert.strictEqual(wd.round1(docs[0].fuelFactLiters + docs[1].fuelFactLiters), 200);
});

test('Старого остатка хватает', () => {
  const docs = chain([400, 30], [{ p: 0.125, s: 0.05 }, { p: 0.05, s: 0.05 }]);
  assert.strictEqual(docs[0].fuelBalanceAtReturn, 50);
  assert.strictEqual(docs[1].fuelIssued, 0);
  assert.strictEqual(docs[1].fuelBalanceAtReturn, 20);
});

test('Лист с нулевой ставкой между двумя обычными', () => {
  const docs = chain([120, 0, 80], [{ p: 0.1, s: 0.08 }, null, { p: 0.15, s: 0.09 }]);
  assert.strictEqual(docs[1].fuelBalanceAtDeparture, null);
  assert.strictEqual(docs[1].fuelFactLiters, 0);
  assert.strictEqual(docs[2].fuelBalanceAtDeparture, 11.6);
});

test('Смена в тот же день', () => {
  const docs = build([entry({ driverId: 'd1', distanceKm: 50, tripCount: 3 }), entry({ driverId: 'd2', distanceKm: 50, tripCount: 2 })]);
  const coeffs = new Map(docs.map((d) => [d.id, { p: 0.1, s: 0.07 }]));
  wd.applyFuelChain(docs, coeffs);
  assert.strictEqual(docs[1].fuelBalanceAtDeparture, docs[0].fuelBalanceAtReturn);
});

test('Сходимость каждого листа и случайные коэффициенты в границах', () => {
  let x = 0.123;
  const rand = () => { x = (x * 9301 + 49297) % 233280 / 233280; return x; };
  const norms = [], coeffs = [];
  for (let i = 0; i < 200; i++) {
    const c = wd.randomCoeffs(rand);
    assert.ok(c.p >= 0.05 && c.p <= 0.15 && c.s >= 0.05 && c.s <= 0.1);
    norms.push(10 + (i * 37) % 300);
    coeffs.push(c);
  }
  const docs = chain(norms, coeffs);
  docs.forEach((d, i) => {
    assert.strictEqual(wd.round1(d.fuelBalanceAtDeparture + d.fuelIssued - d.fuelFactLiters), d.fuelBalanceAtReturn);
    assert.ok(d.fuelBalanceAtReturn >= 0);
    assert.ok(Number.isInteger(d.fuelIssued));
    if (i) assert.strictEqual(d.fuelBalanceAtDeparture, docs[i - 1].fuelBalanceAtReturn);
  });
});
