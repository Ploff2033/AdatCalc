// Адресные уведомления (change reestr-payment-order, задача 4.1; спека
// payment-registry/notify-routing). Сеть подменена через transport.post.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const calc = require('../registry-calc');
const telegram = require('../telegram');

let sent = [];
let failAll = false;
let reactions = [];
telegram.transport.post = async (botToken, chatId, text) => {
  if (failAll) throw new Error('ETIMEDOUT');
  sent.push({ chatId: String(chatId), text });
  return 1000 + sent.length; // message_id
};
telegram.transport.call = async (botToken, method, params) => {
  reactions.push({ method, messageId: params.message_id, emoji: params.reaction.length ? params.reaction[0].emoji : null });
  return true;
};
const flush = () => new Promise((r) => setTimeout(r, 60));

test.after(stop);
// Подразделение и категория — одни на тест (имена уникальны).
let dicts = null;
async function dict() {
  if (!dicts) dicts = { unitId: await fx.unit('Джага'), categoryId: await fx.category('Топливо') };
  return dicts;
}
test.beforeEach(async () => {
  sent = [];
  reactions = [];
  dicts = null;
  failAll = false;
  if (await ready()) {
    await resetRegistry();
    await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_registry_chat_id = 'owner-chat', telegram_registry_buh_chat_id = 'buh-chat' WHERE id = 1");
  }
});

async function make(amount) {
  const r = await registry.create({ ...(await dict()), recipient: 'ООО «ФОРА»', purpose: 'Топливо', amount });
  await flush();
  sent = [];
  return r;
}

test('Миграция: прежний чат и тема реестра — адресат «Учредитель», «Бухгалтер» пуст', async (t) => {
  if (!(await requireDb(t))) return;
  await db.pool.query("UPDATE config SET telegram_registry_chat_id = '-1001', telegram_registry_thread_id = '7', telegram_registry_buh_chat_id = NULL WHERE id = 1");
  const st = await registry.getSettings();
  assert.strictEqual(st.telegramRegistryChatId, '-1001');
  assert.strictEqual(st.telegramRegistryThreadId, '7');
  assert.strictEqual(st.telegramRegistryBuhChatId, '');
  assert.deepStrictEqual(st.events.map((e) => [e.key, e.on]), [
    ['new_request', true], ['approved', true], ['payment_ready', true], ['payment_cancel', true], ['rejected_postponed', false], ['paid', false]
  ]);
});

test('Упоминание: сообщения бухгалтеру начинаются с @buh_adat', async (t) => {
  if (!(await requireDb(t))) return;
  await registry.updateSettings({ telegramRegistryBuhUsername: '@buh_adat' });
  assert.strictEqual((await registry.getSettings()).telegramRegistryBuhUsername, 'buh_adat');
  const r = await make(95450);
  await registry.decide(r.id, { decision: 'approved' });
  await flush();
  assert.ok(sent[0].text.startsWith('@buh_adat\n'), sent[0].text);
});

test('Одобрение: бухгалтеру ❗️❗️❗️, получатель отдельной строкой; учредителю ничего', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await make(95450);
  await registry.decide(r.id, { decision: 'approved' }, { origin: 'https://calc.example' });
  await flush();
  assert.deepStrictEqual(sent.map((s) => s.chatId), ['buh-chat']);
  const lines = sent[0].text.split('\n');
  assert.strictEqual(lines[0], '❗️❗️❗️ <b>Можно делать платёжку: №' + r.number + '</b>');
  assert.strictEqual(lines[1], 'ООО «ФОРА»');
  assert.match(lines[2], /^К оплате: 95\s450 ₽$/);
  assert.ok(sent[0].text.includes('?owner='), 'ссылка с токеном учредителя');
});

test('Платёжка готова: учредителю ✅ с получателем и суммой', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await make(95450);
  await registry.decide(r.id, { decision: 'approved' });
  await flush();
  sent = [];
  await registry.markPaymentOrder(r.id);
  await flush();
  assert.deepStrictEqual(sent.map((s) => s.chatId), ['owner-chat']);
  assert.match(sent[0].text, new RegExp('✅ <b>Платёжка готова — проведите оплату: №' + r.number));
  assert.match(sent[0].text, /ООО «ФОРА»/);
  assert.match(sent[0].text, /95\s450 ₽/);
});

test('Событие выключено: «Оплачено» не уходит, включённое — уходит', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await make(1000);
  await registry.decide(r.id, { decision: 'approved' });
  await registry.markPaymentOrder(r.id);
  await flush();
  sent = [];
  await registry.addPayment(r.id, { amount: 400, paidOn: calc.todayMoscow() });
  await flush();
  assert.deepStrictEqual(sent, []);
  await registry.updateSettings({ events: { paid: true, approved: false } });
  await registry.markPaymentOrder(r.id);
  await flush();
  sent = [];
  await registry.addPayment(r.id, { amount: 600, paidOn: calc.todayMoscow() });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Оплачено №.+: 600 ₽/);
  const st = await registry.getSettings();
  assert.strictEqual(st.events.find((e) => e.key === 'approved').on, false);
  await assert.rejects(registry.updateSettings({ events: { nope: true } }), { status: 400 });
});

test('Пачка одобрений: бухгалтеру одно сообщение с тремя строками', async (t) => {
  if (!(await requireDb(t))) return;
  const rs = [await make(95450), await make(140000), await make(284550)];
  await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'approved' });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, 'buh-chat');
  assert.match(sent[0].text, /❗️❗️❗️ <b>Можно делать платёжки: 3 заявки на 520\s000 ₽/);
  assert.strictEqual((sent[0].text.match(/^№/gm) || []).length, 3);
});

test('Telegram недоступен: статус сохранён, сообщение в очереди', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await make(1000);
  await registry.decide(r.id, { decision: 'approved' });
  await flush();
  await db.pool.query('TRUNCATE telegram_outbox');
  failAll = true;
  const origError = console.error;
  console.error = () => {};
  try {
    assert.strictEqual((await registry.markPaymentOrder(r.id)).state.status, 'ready');
    await new Promise((res) => setTimeout(res, 300));
  } finally {
    console.error = origError;
  }
  const { rows } = await db.pool.query('SELECT text FROM telegram_outbox');
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].text, /Платёжка готова/);
});

test('Тестовое сообщение каждому адресату через API', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const r = await call('POST', '/api/registry/telegram-test', { cookie: admin, json: { to: 'buh', telegramRegistryBuhChatId: '-200', telegramRegistryBuhUsername: 'buh' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(sent[0].chatId, '-200');
  assert.ok(sent[0].text.startsWith('@buh\n'));
  assert.match(sent[0].text, /«Бухгалтер»/);
  const o = await call('POST', '/api/registry/telegram-test', { cookie: admin, json: {} });
  assert.strictEqual(o.status, 200);
  assert.strictEqual(sent[1].chatId, 'owner-chat');
});

// ---------- реакция ✍ «сделано» ----------

async function approvedMsg(amounts) {
  const rs = [];
  for (const a of amounts) rs.push(await make(a));
  if (rs.length === 1) await registry.decide(rs[0].id, { decision: 'approved' });
  else await registry.decideMany({ ids: rs.map((r) => r.id), decision: 'approved' });
  await flush();
  assert.strictEqual(sent.length, 1);
  return { rs, messageId: 1001 };
}

test('Реакция: «Платёжка готова» → ✍ на «Можно делать платёжку»; отмена — снята', async (t) => {
  if (!(await requireDb(t))) return;
  const { rs, messageId } = await approvedMsg([95450]);
  assert.deepStrictEqual(reactions, []);
  await registry.markPaymentOrder(rs[0].id);
  await flush();
  assert.deepStrictEqual(reactions, [{ method: 'setMessageReaction', messageId, emoji: '✍' }]);
  await registry.cancelPaymentOrder(rs[0].id, {});
  await flush();
  assert.deepStrictEqual(reactions[1], { method: 'setMessageReaction', messageId, emoji: null });
});

test('Реакция на сводное — только когда готовы все заявки', async (t) => {
  if (!(await requireDb(t))) return;
  const { rs, messageId } = await approvedMsg([1000, 2000, 3000]);
  await registry.markPaymentOrder(rs[0].id);
  await registry.markPaymentOrder(rs[1].id);
  await flush();
  assert.deepStrictEqual(reactions.filter((x) => x.messageId === messageId), []);
  await registry.decideMany({ ids: [rs[2].id], decision: 'payment_ready' });
  await flush();
  assert.deepStrictEqual(reactions.filter((x) => x.messageId === messageId), [{ method: 'setMessageReaction', messageId, emoji: '✍' }]);
});

test('Реакция на «Платёжка готова» — после оплаты; оплата частью сохраняет ✍ на одобрении', async (t) => {
  if (!(await requireDb(t))) return;
  const { rs } = await approvedMsg([84000]);
  await registry.markPaymentOrder(rs[0].id);
  await flush();
  const readyMsgId = 1000 + sent.length;
  assert.match(sent[sent.length - 1].text, /Платёжка готова/);
  reactions = [];
  await registry.addPayment(rs[0].id, { amount: 50000, paidOn: calc.todayMoscow() });
  await flush();
  assert.deepStrictEqual(reactions, [{ method: 'setMessageReaction', messageId: readyMsgId, emoji: '✍' }]);
});

test('Сбой реакции — операция не падает, повтор при следующем действии', async (t) => {
  if (!(await requireDb(t))) return;
  const { rs, messageId } = await approvedMsg([1000]);
  const realCall = telegram.transport.call;
  const origError = console.error;
  console.error = () => {};
  telegram.transport.call = async () => { const e = new Error('HTTP 400: REACTION_INVALID'); e.telegramStatus = 400; throw e; };
  try {
    assert.strictEqual((await registry.markPaymentOrder(rs[0].id)).state.status, 'ready');
    await flush();
  } finally {
    telegram.transport.call = realCall;
    console.error = origError;
  }
  const { rows } = await db.pool.query('SELECT reacted FROM pay_notify_messages WHERE message_id = $1', [messageId]);
  assert.strictEqual(rows[0].reacted, false);
});
