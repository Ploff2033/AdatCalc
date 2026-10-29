// Сценарии спеки payment-registry/requests, покрываемые чистой логикой.
const test = require('node:test');
const assert = require('node:assert');
const calc = require('../registry-calc');

const TODAY = '2026-10-12';

function req(extra) {
  return Object.assign({ amount: '63800.00', decision: null, approved_amount: null, due_date: null }, extra);
}

test('Номер заявки: формат 121026-57', () => {
  assert.strictEqual(calc.formatNumber('2026-10-12', 57), '121026-57');
});

test('Номер заявки: сквозная нумерация через смену даты 131026-58', () => {
  assert.strictEqual(calc.formatNumber('2026-10-13', 58), '131026-58');
});

test('Сегодня по Москве, а не по UTC', () => {
  // 22:30 UTC 12.10 = 01:30 МСК 13.10
  assert.strictEqual(calc.todayMoscow(new Date('2026-10-12T22:30:00Z')), '2026-10-13');
});

test('Без решения: Не оплачено = Сумма', () => {
  const s = calc.computeState(req(), [], TODAY);
  assert.strictEqual(s.status, 'pending');
  assert.strictEqual(s.unpaid, 63800);
  assert.strictEqual(s.toPay, null);
});

test('Отложенная: Не оплачено = Сумма', () => {
  const s = calc.computeState(req({ amount: '52000', decision: 'postponed' }), [], TODAY);
  assert.strictEqual(s.status, 'postponed');
  assert.strictEqual(s.unpaid, 52000);
});

test('Отклонённая: Не оплачено = 0', () => {
  const s = calc.computeState(req({ decision: 'rejected' }), [], TODAY);
  assert.strictEqual(s.status, 'rejected');
  assert.strictEqual(s.unpaid, 0);
  assert.strictEqual(s.closed, true);
});

test('Одобрение части суммы: 4 000 000 → К оплате 1 500 000', () => {
  const s = calc.computeState(req({ amount: '4000000', decision: 'approved', approved_amount: '1500000' }), [], TODAY);
  assert.strictEqual(s.status, 'approved');
  assert.strictEqual(s.unpaid, 1500000);
});

test('Первая частичная оплата: 1 500 000 − 1 000 000 = 500 000', () => {
  const r = req({ amount: '4000000', decision: 'approved', approved_amount: '1500000' });
  const s = calc.computeState(r, [{ amount: '1000000', paid_on: TODAY }], TODAY);
  assert.strictEqual(s.status, 'partial');
  assert.strictEqual(s.paid, 1000000);
  assert.strictEqual(s.unpaid, 500000);
});

test('Закрывающая оплата: статус Оплачена, Не оплачено 0', () => {
  const r = req({ amount: '4000000', decision: 'approved', approved_amount: '1500000' });
  const s = calc.computeState(r, [{ amount: '1000000' }, { amount: '500000' }], TODAY);
  assert.strictEqual(s.status, 'paid');
  assert.strictEqual(s.unpaid, 0);
});

test('Пересчёт после удаления оплаты: 84 000 − 50 000 = 34 000, Частично', () => {
  const r = req({ amount: '84000', decision: 'approved', approved_amount: '84000' });
  assert.strictEqual(calc.computeState(r, [{ amount: '50000' }, { amount: '34000' }], TODAY).status, 'paid');
  const s = calc.computeState(r, [{ amount: '50000' }], TODAY);
  assert.strictEqual(s.status, 'partial');
  assert.strictEqual(s.unpaid, 34000);
});

test('Увеличение К оплате у оплаченной: Частично, Не оплачено 500 000', () => {
  const r = req({ amount: '4000000', decision: 'approved', approved_amount: '2000000' });
  const s = calc.computeState(r, [{ amount: '1500000' }], TODAY);
  assert.strictEqual(s.status, 'partial');
  assert.strictEqual(s.unpaid, 500000);
});

test('Копейки складываются без ошибок float', () => {
  const r = req({ amount: '0.30', decision: 'approved', approved_amount: '0.30' });
  const s = calc.computeState(r, [{ amount: '0.10' }, { amount: '0.20' }], TODAY);
  assert.strictEqual(s.status, 'paid');
  assert.strictEqual(s.unpaid, 0);
});

test('Просрочка: срок 10.10, сегодня 12.10, Не оплачено > 0', () => {
  const s = calc.computeState(req({ amount: '38600', due_date: '2026-10-10' }), [], TODAY);
  assert.strictEqual(s.overdue, true);
});

test('Срок прошёл, но оплачено — не просрочка', () => {
  const r = req({ amount: '38600', due_date: '2026-10-10', decision: 'approved', approved_amount: '38600' });
  assert.strictEqual(calc.computeState(r, [{ amount: '38600' }], TODAY).overdue, false);
});

test('Срок сегодня — ещё не просрочка', () => {
  assert.strictEqual(calc.computeState(req({ due_date: TODAY }), [], TODAY).overdue, false);
});

function item(seq, extra, payments) {
  const r = req(Object.assign({ seq }, extra));
  r.payments = payments || [];
  r.state = calc.computeState(r, r.payments, TODAY);
  return r;
}

test('Порядок списка: группы и срок внутри группы (10.10, 15.10, без срока)', () => {
  const list = [
    item(1, { decision: 'postponed', due_date: '2026-10-01' }),
    item(2, { due_date: '2026-10-15' }),
    item(3, { due_date: null }),
    item(4, { decision: 'approved', approved_amount: '63800', due_date: '2026-10-13' }),
    item(5, { due_date: '2026-10-10' })
  ];
  list.sort(calc.compareForList);
  assert.deepStrictEqual(list.map((x) => x.seq), [5, 2, 3, 4, 1]);
});

test('Итоги: 65 952 / 220 000 / 50 000 за октябрь', () => {
  const items = [
    item(1, { amount: '38600' }),
    item(2, { amount: '27352' }),
    item(3, { amount: '186000', decision: 'approved', approved_amount: '186000' }),
    item(4, { amount: '84000', decision: 'approved', approved_amount: '84000' }, [{ amount: '50000', paid_on: '2026-10-04' }])
  ];
  const t = calc.computeTotals(items, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepStrictEqual(t.pending, { sum: 65952, count: 2 });
  assert.deepStrictEqual(t.toPay, { sum: 220000, count: 2 });
  assert.deepStrictEqual(t.paid, { sum: 50000, count: 1 });
});

test('Итоги: оплата вне периода не попадает в Оплачено', () => {
  const items = [item(1, { amount: '84000', decision: 'approved', approved_amount: '84000' }, [{ amount: '50000', paid_on: '2026-09-30' }])];
  const t = calc.computeTotals(items, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepStrictEqual(t.paid, { sum: 0, count: 0 });
});

// ---------- «Платёжка готова» (change reestr-payment-order) ----------

test('Платёжка готова: одобрено + отметка + остаток > 0', () => {
  const r = req({ amount: '95450', decision: 'approved', approved_amount: '95450', payment_order_at: '2026-10-29T07:40:00Z' });
  const s = calc.computeState(r, [], TODAY);
  assert.strictEqual(s.status, 'ready');
  assert.strictEqual(s.statusLabel, 'Платёжка готова');
  assert.strictEqual(s.unpaid, 95450);
  assert.strictEqual(s.group, 0);
});

test('Отметка без остатка не делает «Платёжка готова» — «Оплачена»', () => {
  const r = req({ amount: '1000', decision: 'approved', approved_amount: '1000', payment_order_at: '2026-10-29T07:40:00Z' });
  assert.strictEqual(calc.computeState(r, [{ amount: '1000' }], TODAY).status, 'paid');
});

test('Отметка у неодобренной заявки статус не меняет', () => {
  const r = req({ decision: 'postponed', payment_order_at: '2026-10-29T07:40:00Z' });
  assert.strictEqual(calc.computeState(r, [], TODAY).status, 'postponed');
});

test('Порядок групп: Платёжка готова, Ожидает, Одобрена/Частично, Отложена; в «готова» — дольше ждущие выше', () => {
  const list = [
    item(1, { decision: 'postponed' }),
    item(2, {}),
    item(3, { decision: 'approved', approved_amount: '63800' }),
    item(4, { decision: 'approved', approved_amount: '63800', payment_order_at: '2026-10-29T07:00:00Z' }),
    item(5, { decision: 'approved', approved_amount: '63800', payment_order_at: '2026-10-27T07:00:00Z' })
  ];
  list.forEach((x) => { x.state = calc.computeState(x, x.payments, TODAY); });
  list.sort(calc.compareForList);
  assert.deepStrictEqual(list.map((x) => x.seq), [5, 4, 2, 3, 1]);
  assert.deepStrictEqual(list.map((x) => x.state.group), [0, 0, 1, 2, 3]);
});

test('Плитка «К оплате» включает «Платёжка готова»: 186 000 + 34 000 = 220 000', () => {
  const items = [
    item(1, { amount: '186000', decision: 'approved', approved_amount: '186000' }),
    item(2, { amount: '84000', decision: 'approved', approved_amount: '84000', payment_order_at: '2026-10-29T07:00:00Z' }, [{ amount: '50000', paid_on: '2026-10-04' }])
  ];
  items.forEach((x) => { x.state = calc.computeState(x, x.payments, TODAY); });
  assert.strictEqual(items[1].state.status, 'ready');
  const t = calc.computeTotals(items, null);
  assert.deepStrictEqual(t.toPay, { sum: 220000, count: 2 });
  assert.deepStrictEqual(t.groups[0], { sum: 34000, count: 1 });
});
