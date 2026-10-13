// Сценарии спеки payment-registry/requests (через handlers/registry.js).
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, ready, close } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const calc = require('../registry-calc');
const telegram = require('../telegram');

// Без сети: уведомления реестра в этих тестах не проверяются (см.
// registry-notifications.test.js), чат реестра в resetRegistry() пуст.
telegram.transport.post = async () => {};

test.after(close);
test.beforeEach(async () => { if (await ready()) await resetRegistry(); });

const TODAY = calc.todayMoscow();

async function base() {
  return { unitId: await fx.unit('Стройка'), categoryId: await fx.category('Материалы') };
}

function body(d, extra) {
  return Object.assign({ unitId: d.unitId, categoryId: d.categoryId, recipient: 'ООО "ПРОМХИМ"', amount: 63800, purpose: 'Фанера 18мм' }, extra);
}

async function approved(d, amount, toPay) {
  const r = await registry.create(body(d, { amount }));
  return registry.decide(r.id, { decision: 'approved', approvedAmount: toPay });
}

test('Успешное создание: статус Ожидает решения, Не оплачено = Сумма, номер DDMMYY-N', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  assert.strictEqual(r.state.status, 'pending');
  assert.strictEqual(r.state.unpaid, 63800);
  assert.strictEqual(r.number, calc.formatNumber(TODAY, 1));
  assert.strictEqual(r.unitName, 'Стройка');
});

test('Не заполнено обязательное поле или неверная сумма — 400, заявка не создаётся', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  for (const bad of [{ recipient: '' }, { categoryId: '' }, { amount: 0 }, { amount: -5 }, { purpose: '  ' }, { amount: '12.345' }]) {
    await assert.rejects(registry.create(body(d, bad)), { status: 400 }, JSON.stringify(bad));
  }
  const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM pay_requests');
  assert.strictEqual(rows[0].n, 0);
});

test('Сумма строкой с пробелами и запятой принимается', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d, { amount: '63 800,50' }));
  assert.strictEqual(r.amount, 63800.5);
});

test('Скрытое значение справочника нельзя выбрать', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const hiddenCat = await fx.category('Старое', true);
  await assert.rejects(registry.create(body(d, { categoryId: hiddenCat })), { status: 400 });
});

test('Номер не зависит от удалений: после удаления 1-й следующая получает 2', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r1 = await registry.create(body(d));
  await registry.remove(r1.id);
  const r2 = await registry.create(body(d));
  assert.strictEqual(r2.number, calc.formatNumber(TODAY, 2));
});

test('Заявка открывается по номеру (ссылка из Telegram)', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  assert.strictEqual((await registry.get(r.number)).id, r.id);
});

test('Одобрение в одно нажатие: К оплате = Сумма, дата решения', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  const a = await registry.decide(r.id, { decision: 'approved' });
  assert.strictEqual(a.state.status, 'approved');
  assert.strictEqual(a.approvedAmount, 63800);
  assert.ok(a.decidedAt);
});

test('Одобрение части суммы: 4 000 000 → 1 500 000', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 4000000, 1500000);
  assert.strictEqual(a.state.unpaid, 1500000);
});

test('К оплате вне границ (0 или больше суммы) — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  await assert.rejects(registry.decide(r.id, { decision: 'approved', approvedAmount: 0 }), { status: 400 });
  await assert.rejects(registry.decide(r.id, { decision: 'approved', approvedAmount: 63801 }), { status: 400 });
});

test('Отклонение с причиной: Не оплачено 0, комментарий сохранён', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  const x = await registry.decide(r.id, { decision: 'rejected', comment: 'Есть на складе' });
  assert.strictEqual(x.state.status, 'rejected');
  assert.strictEqual(x.state.unpaid, 0);
  assert.strictEqual(x.decisionComment, 'Есть на складе');
});

test('Отложить без причины; из Отложена в Одобрена — дата решения обновляется', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  const p = await registry.decide(r.id, { decision: 'postponed' });
  assert.strictEqual(p.state.status, 'postponed');
  await db.pool.query("UPDATE pay_requests SET decided_at = now() - interval '1 day' WHERE id = $1", [r.id]);
  const before = (await registry.get(r.id)).decidedAt;
  const a = await registry.decide(r.id, { decision: 'approved' });
  assert.strictEqual(a.state.status, 'approved');
  assert.ok(new Date(a.decidedAt) > new Date(before));
});

test('Урезать К оплате ниже оплаченного — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 4000000, 1500000);
  await registry.addPayment(a.id, { amount: 1000000, paidOn: TODAY });
  await assert.rejects(registry.decide(a.id, { decision: 'approved', approvedAmount: 800000 }), { status: 409 });
});

test('Отклонить (и отложить) частично оплаченную — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 84000, 84000);
  await registry.addPayment(a.id, { amount: 50000, paidOn: TODAY });
  await assert.rejects(registry.decide(a.id, { decision: 'rejected' }), (e) => e.status === 409 && /удалите оплаты/.test(e.message));
  await assert.rejects(registry.decide(a.id, { decision: 'postponed' }), { status: 409 });
});

test('Увеличение К оплате у оплаченной: Частично, Не оплачено 500 000', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 4000000, 1500000);
  await registry.addPayment(a.id, { amount: 1500000, paidOn: TODAY });
  assert.strictEqual((await registry.get(a.id)).state.status, 'paid');
  const x = await registry.decide(a.id, { decision: 'approved', approvedAmount: 2000000 });
  assert.strictEqual(x.state.status, 'partial');
  assert.strictEqual(x.state.unpaid, 500000);
});

test('Первая частичная и закрывающая оплаты', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 4000000, 1500000);
  const p1 = await registry.addPayment(a.id, { amount: 1000000, paidOn: TODAY });
  assert.strictEqual(p1.state.status, 'partial');
  assert.strictEqual(p1.state.paid, 1000000);
  assert.strictEqual(p1.state.unpaid, 500000);
  const p2 = await registry.addPayment(a.id, { amount: 500000, paidOn: TODAY });
  assert.strictEqual(p2.state.status, 'paid');
  assert.strictEqual(p2.state.unpaid, 0);
  assert.strictEqual(p2.lastPaidOn, TODAY);
});

test('Переплата — отказ с подсказкой поднять К оплате', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 4000000, 1500000);
  await registry.addPayment(a.id, { amount: 1000000, paidOn: TODAY });
  await assert.rejects(registry.addPayment(a.id, { amount: 600000, paidOn: TODAY }), (e) => e.status === 409 && /увеличьте/.test(e.message));
});

test('Оплата без одобрения — отказ (ожидает, отложена, отклонена)', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  await assert.rejects(registry.addPayment(r.id, { amount: 1, paidOn: TODAY }), { status: 409 });
  await registry.decide(r.id, { decision: 'postponed' });
  await assert.rejects(registry.addPayment(r.id, { amount: 1, paidOn: TODAY }), { status: 409 });
  await registry.decide(r.id, { decision: 'rejected' });
  await assert.rejects(registry.addPayment(r.id, { amount: 1, paidOn: TODAY }), { status: 409 });
});

test('Дата оплаты из будущего — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 63800);
  const tomorrow = new Date(Date.parse(TODAY + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  await assert.rejects(registry.addPayment(a.id, { amount: 100, paidOn: tomorrow }), { status: 400 });
});

test('Пересчёт после удаления оплаты: 84 000 − 50 000 = 34 000, Частично', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 84000, 84000);
  await registry.addPayment(a.id, { amount: 50000, paidOn: TODAY });
  const full = await registry.addPayment(a.id, { amount: 34000, paidOn: TODAY });
  assert.strictEqual(full.state.status, 'paid');
  const last = full.payments.find((p) => p.amount === 34000);
  const after = await registry.removePayment(last.id);
  assert.strictEqual(after.state.status, 'partial');
  assert.strictEqual(after.state.unpaid, 34000);
});

test('Правка после одобрения: решение не сбрасывается, видно «изменена после решения»', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 63800);
  assert.strictEqual(a.editedAfterDecision, false);
  const x = await registry.update(a.id, { recipient: 'ООО "Другой"' });
  assert.strictEqual(x.state.status, 'approved');
  assert.strictEqual(x.approvedAmount, 63800);
  assert.strictEqual(x.editedAfterDecision, true);
});

test('Уменьшение суммы ниже К оплате — К оплате понижается до суммы', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 63800);
  const x = await registry.update(a.id, { amount: 60000 });
  assert.strictEqual(x.approvedAmount, 60000);
});

test('Уменьшение суммы ниже оплаченного — отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 84000);
  await registry.addPayment(a.id, { amount: 50000, paidOn: TODAY });
  await assert.rejects(registry.update(a.id, { amount: 40000 }), { status: 409 });
});

test('Удаление заявки с оплатой — отказ; без оплат — удаляется', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(await base(), 84000);
  await registry.addPayment(a.id, { amount: 1000, paidOn: TODAY });
  await assert.rejects(registry.remove(a.id), (e) => e.status === 409 && /удалите оплаты/.test(e.message));
  const r = await registry.create(body({ unitId: a.unitId, categoryId: a.categoryId }));
  await registry.remove(r.id);
  await assert.rejects(registry.get(r.id), { status: 404 });
});

test('Фильтр по подразделению и итоги учитывают только его', async (t) => {
  if (!(await requireDb(t))) return;
  const c = await fx.category('Сырьё');
  const teb = await fx.unit('Теберда');
  const jag = await fx.unit('Джага');
  await registry.create({ unitId: teb, categoryId: c, recipient: 'А', purpose: 'x', amount: 100 });
  await registry.create({ unitId: jag, categoryId: c, recipient: 'Б', purpose: 'y', amount: 200 });
  const res = await registry.list({ unit: teb });
  assert.deepStrictEqual(res.items.map((x) => x.unitName), ['Теберда']);
  assert.deepStrictEqual(res.totals.pending, { sum: 100, count: 1 });
});

test('Закрытые скрыты в режиме Активные и видны в Закрытых', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await registry.create(body(d));
  await registry.decide(r.id, { decision: 'rejected' });
  const open = await registry.create(body(d));
  assert.deepStrictEqual((await registry.list({})).items.map((x) => x.id), [open.id]);
  assert.deepStrictEqual((await registry.list({ closed: '1' })).items.map((x) => x.id), [r.id]);
});

test('Подсказка получателя по части названия', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  await registry.create(body(d, { recipient: 'ООО "ПРОМХИМ"', applicant: 'Руслан' }));
  assert.deepStrictEqual(await registry.suggest('recipient', 'ПРОМ'), ['ООО "ПРОМХИМ"']);
  assert.deepStrictEqual(await registry.suggest('applicant', 'рус'), ['Руслан']);
  assert.deepStrictEqual(await registry.suggest('recipient', '%'), []);
});

test('Оплата не попадает в ДДС и не запускает синхронизацию Mail.ru', async (t) => {
  if (!(await requireDb(t))) return;
  const mailru = require('../mailru-sync');
  const original = mailru.syncPlant;
  let synced = 0;
  mailru.syncPlant = () => { synced++; };
  try {
    const count = async () => (await db.pool.query('SELECT count(*)::int AS n FROM cash_entries')).rows[0].n;
    const before = await count();
    const a = await approved(await base(), 63800);
    await registry.addPayment(a.id, { amount: 63800, paidOn: TODAY });
    await registry.update(a.id, { purpose: 'другое' });
    assert.strictEqual(await count(), before);
    assert.strictEqual(synced, 0);
  } finally {
    mailru.syncPlant = original;
  }
});
