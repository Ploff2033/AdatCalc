// Change waybill-fuel-chain, задачи 4.2–4.3: период сводки по умолчанию и
// раскладка ответа сервера в строки экрана/xlsx (frontend-v2/js/waybill-calc.js).
const test = require('node:test');
const assert = require('node:assert');
const frontend = require('./helpers/frontend');

const w = frontend.load(['frontend-v2/js/waybill-calc.js']);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('Период по умолчанию', () => {
  assert.deepStrictEqual(plain(w.WaybillCalc.monthRange('2026-10-19')), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepStrictEqual(plain(w.WaybillCalc.monthRange('2028-02-03')), { from: '2028-02-01', to: '2028-02-29' });
});

test('Строки xlsx совпадают с ответом сервера', () => {
  const summary = {
    from: '2026-10-01', to: '2026-10-31',
    rows: [
      { vehicleId: 'm1', name: 'Миксер №1', docs: 20, normLiters: 2400, factLiters: 2400, issuedLiters: 2408, startLiters: 15, endLiters: 23, mismatch: false },
      { vehicleId: 'm2', name: 'Миксер №2', docs: 9, normLiters: 1210.4, factLiters: 1210.4, issuedLiters: 1215, startLiters: null, endLiters: null, mismatch: true }
    ],
    total: { docs: 29, normLiters: 3610.4, factLiters: 3610.4, issuedLiters: 3623 }
  };
  const t = plain(w.WaybillCalc.fuelSummaryTable(summary));
  assert.strictEqual(t.head.length, 7);
  assert.deepStrictEqual(t.rows[0].cells, ['Миксер №1', 20, 2400, 2400, 2408, 15, 23]);
  assert.strictEqual(t.rows[1].mismatch, true);
  assert.deepStrictEqual(t.rows[1].cells.slice(5), [null, null]);
  assert.deepStrictEqual(t.total, ['Итого', 29, 3610.4, 3610.4, 3623, null, null]);
});
