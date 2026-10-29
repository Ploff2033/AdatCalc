// Пакетное решение (change reestr-bulk, задачи 1.1–1.2; спека
// payment-registry/bulk-decision).
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const calc = require('../registry-calc');
const telegram = require('../telegram');

let sent = [];
telegram.transport.post = async (botToken, chatId, text) => { sent.push(text); };
const flush = () => new Promise((r) => setTimeout(r, 60));

test.after(stop);
test.beforeEach(async () => {
  sent = [];
  if (await ready()) {
    await resetRegistry();
    await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_registry_chat_id = 'registry-chat', telegram_registry_buh_chat_id = 'registry-chat' WHERE id = 1");
    await db.pool.query("UPDATE config SET telegram_registry_events = '{\"rejected_postponed\":true}' WHERE id = 1");
  }
});

async function base() {
  return { unitId: await fx.unit('Джага'), categoryId: await fx.category('Топливо') };
}

async function make(d, amount, extra) {
  const r = await registry.create(Object.assign({ unitId: d.unitId, categoryId: d.categoryId, recipient: 'ООО «Поставщик ' + amount + '»', purpose: 'x', amount }, extra));
  await flush();
  return r;
}

test('Одобрение трёх заявок: каждая на полную сумму, своя дата решения', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const rs = [await make(d, 95450), await make(d, 140000), await make(d, 284550)];
  sent = [];
  const res = await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'approved' });
  assert.strictEqual(res.applied.length, 3);
  assert.deepStrictEqual(res.skipped, []);
  for (const r of rs) {
    const x = await registry.get(r.id);
    assert.strictEqual(x.state.status, 'approved');
    assert.strictEqual(x.approvedAmount, r.amount);
    assert.ok(x.decidedAt);
  }
});

test('Ранее отложенная одобряется на полную сумму; комментарий решения не меняется', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await make(d, 52000);
  await registry.decide(r.id, { decision: 'postponed', comment: 'После 20-го' });
  const res = await registry.decideMany({ ids: [r.id], decision: 'approved' });
  assert.strictEqual(res.applied.length, 1);
  const x = await registry.get(r.id);
  assert.strictEqual(x.state.status, 'approved');
  assert.strictEqual(x.approvedAmount, 52000);
  assert.strictEqual(x.decisionComment, 'После 20-го');
});

test('Отложить две; уже отложенная — не ошибка и без уведомления о ней', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const a = await make(d, 1000);
  const b = await make(d, 2000);
  const c = await make(d, 3000);
  await registry.decide(c.id, { decision: 'postponed' });
  await flush();
  sent = [];
  const res = await registry.decideMany({ ids: [a.id, b.id, c.id], decision: 'postponed' });
  assert.strictEqual(res.applied.length, 3);
  assert.deepStrictEqual(res.skipped, []);
  assert.strictEqual((await registry.get(a.id)).state.status, 'postponed');
  assert.strictEqual((await registry.get(b.id)).state.status, 'postponed');
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], /Отложено пачкой: 2 заявки/);
});

test('Одна заявка изменилась (уже одобрена с ПК) — пропуск, остальные применены', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const rs = [await make(d, 1000), await make(d, 2000), await make(d, 3000), await make(d, 4000)];
  await registry.decide(rs[1].id, { decision: 'approved' });
  const res = await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'approved' });
  assert.strictEqual(res.applied.length, 3);
  assert.deepStrictEqual(res.skipped, [{ id: rs[1].id, number: rs[1].number, reason: 'уже одобрена' }]);
});

test('Оплаченная и отклонённая — пропуск с причиной', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const paid = await make(d, 1000);
  await registry.decide(paid.id, { decision: 'approved' });
  await fx.pay(paid.id, { amount: 1000, paidOn: calc.todayMoscow() });
  const rej = await make(d, 2000);
  await registry.decide(rej.id, { decision: 'rejected' });
  const res = await registry.decideMany({ ids: [paid.id, rej.id], decision: 'postponed' });
  assert.deepStrictEqual(res.skipped.map((s) => s.reason), ['уже оплачена', 'уже отклонена']);
});

test('Заявку удалили — «заявка не найдена», остальные применены', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const a = await make(d, 1000);
  const b = await make(d, 2000);
  await registry.remove(b.id);
  const res = await registry.decideMany({ ids: [a.id, b.id], decision: 'approved' });
  assert.strictEqual(res.applied.length, 1);
  assert.deepStrictEqual(res.skipped, [{ id: b.id, number: null, reason: 'заявка не найдена' }]);
});

test('101 заявка — 400, ничего не изменилось; повторы id считаются один раз', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await make(d, 1000);
  const ids = Array.from({ length: 100 }, (_, i) => 'preq_x' + i).concat([r.id]);
  await assert.rejects(registry.decideMany({ ids, decision: 'approved' }), (e) => e.status === 400 && /не больше 100/.test(e.message));
  assert.strictEqual((await registry.get(r.id)).state.status, 'pending');
  const dup = await registry.decideMany({ ids: [r.id, r.id], decision: 'approved' });
  assert.strictEqual(dup.applied.length, 1);
});

test('Отклонение пачкой и пустой список — 400', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await make(d, 1000);
  await assert.rejects(registry.decideMany({ ids: [r.id], decision: 'rejected' }), { status: 400 });
  await assert.rejects(registry.decideMany({ ids: [], decision: 'approved' }), { status: 400 });
  assert.strictEqual((await registry.get(r.id)).state.status, 'pending');
});

test('Доступ: учредитель и admin — да, manager — 403', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const a = await make(d, 1000);
  const b = await make(d, 2000);
  const owner = await registry.getOwnerToken();
  const admin = await cookieFor('admin');
  const manager = await cookieFor('manager');
  assert.strictEqual((await call('POST', '/api/registry/decisions', { cookie: manager, json: { ids: [a.id], decision: 'approved' } })).status, 403);
  const o = await call('POST', '/api/registry/decisions', { owner, json: { ids: [a.id], decision: 'approved' } });
  assert.strictEqual(o.status, 200);
  assert.strictEqual(o.data.applied.length, 1);
  const ad = await call('POST', '/api/registry/decisions', { cookie: admin, json: { ids: [b.id], decision: 'postponed' } });
  assert.strictEqual(ad.status, 200);
});

// ---------- уведомление ----------

test('Пачка из трёх — одно сообщение с суммой и тремя строками', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const rs = [await make(d, 95450), await make(d, 140000), await make(d, 284550)];
  sent = [];
  await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'approved' });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], /Можно делать платёжки: 3 заявки на 520\s000 ₽/);
  for (const r of rs) assert.ok(sent[0].includes('№' + r.number), r.number);
  assert.match(sent[0], /#\/registry"/);
  assert.ok(!/Решение по №/.test(sent.join('\n')));
});

test('Двадцать заявок — 15 строк и «…и ещё 5»', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const rs = [];
  for (let i = 1; i <= 20; i++) rs.push(await make(d, i * 100));
  sent = [];
  await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'approved' });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual((sent[0].match(/^№/gm) || []).length, 15);
  assert.match(sent[0], /…и ещё 5/);
  assert.match(sent[0], /20 заявок/);
});

test('Ничего не применилось — сообщения нет', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await make(d, 1000);
  await registry.decide(r.id, { decision: 'approved' });
  await flush();
  sent = [];
  const res = await registry.decideMany({ ids: [r.id], decision: 'approved' });
  await flush();
  assert.strictEqual(res.applied.length, 0);
  assert.deepStrictEqual(sent, []);
});

test('Одиночное одобрение — своё «Можно делать платёжку: №…»', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const r = await make(d, 1000);
  sent = [];
  await registry.decide(r.id, { decision: 'approved' });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], new RegExp('Можно делать платёжку: №' + r.number));
});
