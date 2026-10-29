// «Платёжка готова» (change reestr-payment-order, задачи 2.1–2.2; спека
// payment-registry/payment-order).
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, ready } = require('./helpers/db');
const { stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const calc = require('../registry-calc');
const telegram = require('../telegram');

let sent = [];
telegram.transport.post = async (botToken, chatId, text) => { sent.push({ chatId: String(chatId), text }); };
const flush = () => new Promise((r) => setTimeout(r, 60));
const TODAY = calc.todayMoscow();

test.after(stop);
// Подразделение и категория — одни на тест (имена уникальны).
let dicts = null;
async function dict() {
  if (!dicts) dicts = { unitId: await fx.unit('Джага'), categoryId: await fx.category('Топливо') };
  return dicts;
}
test.beforeEach(async () => {
  sent = [];
  dicts = null;
  if (await ready()) {
    await resetRegistry();
    await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_registry_chat_id = 'owner-chat', telegram_registry_buh_chat_id = 'buh-chat' WHERE id = 1");
  }
});

async function approved(amount, approvedAmount) {
  const r = await registry.create({ ...(await dict()), recipient: 'ООО «ФОРА»', purpose: 'Топливо', amount });
  await registry.decide(r.id, approvedAmount ? { decision: 'approved', approvedAmount } : { decision: 'approved' });
  await flush();
  sent = [];
  return r;
}

test('Отметка платёжки: статус, время, «Не оплачено»', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await approved(95450);
  const before = Date.now();
  const x = await registry.markPaymentOrder(r.id);
  assert.strictEqual(x.state.status, 'ready');
  assert.strictEqual(x.state.statusLabel, 'Платёжка готова');
  assert.strictEqual(x.state.unpaid, 95450);
  assert.ok(Math.abs(new Date(x.paymentOrderAt).getTime() - before) < 5000);
  await assert.rejects(registry.markPaymentOrder(r.id), { status: 409 });
});

test('Недоступно без одобрения: ожидает, отложена, отклонена, оплачена — 409', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await registry.create({ ...(await dict()), recipient: 'x', purpose: 'x', amount: 1000 });
  await assert.rejects(registry.markPaymentOrder(r.id), { status: 409 });
  await registry.decide(r.id, { decision: 'postponed' });
  await assert.rejects(registry.markPaymentOrder(r.id), { status: 409 });
  await registry.decide(r.id, { decision: 'rejected' });
  await assert.rejects(registry.markPaymentOrder(r.id), { status: 409 });
  const p = await approved(1000);
  await fx.pay(p.id, { amount: 1000, paidOn: TODAY });
  await assert.rejects(registry.markPaymentOrder(p.id), { status: 409 });
  assert.strictEqual((await registry.get(p.id)).state.status, 'paid');
});

test('Оплата без платёжки — 409 «Сначала отметьте…»', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await approved(5000);
  await assert.rejects(registry.addPayment(r.id, { amount: 100, paidOn: TODAY }), (e) => e.status === 409 && /Сначала отметьте, что платёжка готова/.test(e.message));
});

test('Частичная оплата снимает отметку; следующая — только после новой «Платёжка готова»', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await approved(84000);
  await registry.markPaymentOrder(r.id);
  const x = await registry.addPayment(r.id, { amount: 50000, paidOn: TODAY });
  assert.strictEqual(x.state.status, 'partial');
  assert.strictEqual(x.state.unpaid, 34000);
  assert.strictEqual(x.paymentOrderAt, null);
  await assert.rejects(registry.addPayment(r.id, { amount: 1000, paidOn: TODAY }), { status: 409 });
  await registry.markPaymentOrder(r.id);
  const y = await registry.addPayment(r.id, { amount: 34000, paidOn: TODAY });
  assert.strictEqual(y.state.status, 'paid');
});

test('Удаление оплаты: снова «Одобрена» без отметки', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await approved(1000);
  const x = await fx.pay(r.id, { amount: 1000, paidOn: TODAY });
  await registry.removePayment(x.payments[0].id);
  const y = await registry.get(r.id);
  assert.strictEqual(y.state.status, 'approved');
  assert.strictEqual(y.paymentOrderAt, null);
});

test('Отмена с причиной: «Одобрена» / «Частично», причина — бухгалтеру', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await approved(84000);
  await registry.markPaymentOrder(r.id);
  await flush();
  sent = [];
  const x = await registry.cancelPaymentOrder(r.id, { note: 'отозвана из банка' });
  assert.strictEqual(x.state.status, 'approved');
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, 'buh-chat');
  assert.match(sent[0].text, /Платёжка по №.+ отменена/);
  assert.match(sent[0].text, /Причина: отозвана из банка/);
  await assert.rejects(registry.cancelPaymentOrder(r.id, {}), { status: 409 });
  await fx.pay(r.id, { amount: 50000, paidOn: TODAY });
  await registry.markPaymentOrder(r.id);
  assert.strictEqual((await registry.cancelPaymentOrder(r.id, {})).state.status, 'partial');
});

test('Отложили / отклонили заявку с готовой платёжкой — отметка снята', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await approved(1000);
  await registry.markPaymentOrder(r.id);
  await registry.decide(r.id, { decision: 'postponed' });
  let x = await registry.get(r.id);
  assert.strictEqual(x.state.status, 'postponed');
  assert.strictEqual(x.paymentOrderAt, null);
  await registry.decide(r.id, { decision: 'approved' });
  assert.strictEqual((await registry.get(r.id)).state.status, 'approved');
  await registry.markPaymentOrder(r.id);
  await registry.decide(r.id, { decision: 'approved', approvedAmount: 800 });
  assert.strictEqual((await registry.get(r.id)).state.status, 'ready', 'смена суммы с остатком отметку не снимает');
});

test('Три платёжки разом — одно сообщение учредителю', async (t) => {
  if (!(await requireDb(t))) return;
  const rs = [await approved(95450), await approved(140000), await approved(284550)];
  const res = await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'payment_ready' });
  assert.strictEqual(res.applied.length, 3);
  assert.deepStrictEqual(res.skipped, []);
  for (const r of rs) assert.strictEqual((await registry.get(r.id)).state.status, 'ready');
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, 'owner-chat');
  assert.match(sent[0].text, /✅ <b>Платёжки готовы — проведите оплату: 3 заявки на 520\s000 ₽/);
});

test('Смешанный выбор: «Ожидает решения» пропущена с причиной', async (t) => {
  if (!(await requireDb(t))) return;
  const a = await approved(1000);
  const p = await registry.create({ ...(await dict()), recipient: 'x', purpose: 'x', amount: 2000 });
  const res = await registry.decideMany({ ids: [a.id, p.id], decision: 'payment_ready' });
  assert.deepStrictEqual(res.applied.map((x) => x.id), [a.id]);
  assert.deepStrictEqual(res.skipped, [{ id: p.id, number: p.number, reason: 'нет решения «одобрить»' }]);
});
