// Сценарии спеки payment-registry/notifications. Сеть подменена:
// telegram.transport.post записывает, что и в какой чат ушло.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const calc = require('../registry-calc');
const telegram = require('../telegram');

let sent = [];
let failNext = false;
telegram.transport.post = async (botToken, chatId, text) => {
  if (failNext) { failNext = false; throw new Error('ETIMEDOUT'); }
  sent.push({ chatId: String(chatId), text });
};

test.after(stop);
test.beforeEach(async () => {
  sent = [];
  failNext = false;
  if (await ready()) {
    await resetRegistry();
    await db.pool.query("UPDATE config SET telegram_bot_token = 'bot-test', telegram_chat_id = 'orders-chat' WHERE id = 1");
  }
});

// Уведомления уходят без await — даём событийному циклу их доставить.
const flush = () => new Promise((r) => setTimeout(r, 50));

async function setRegistryChat(id) {
  await db.pool.query('UPDATE config SET telegram_registry_chat_id = $1 WHERE id = 1', [id]);
}

// flush() внутри — уведомление о создании должно уйти ДО того, как тест
// поменяет чат, иначе оно прочитает уже новый ID.
async function create(amount) {
  const r = await registry.create(
    { unitId: await fx.unit('Стройка'), categoryId: await fx.category('Материалы'), recipient: 'ООО "ПРОМХИМ"', purpose: 'Фанера', amount: amount || 63800, dueDate: '2026-10-20' },
    { origin: 'https://calc.example' }
  );
  await flush();
  return r;
}

test('Чат не задан: заявка создаётся, сообщение не отправляется', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await create();
  await flush();
  assert.strictEqual(r.state.status, 'pending');
  assert.deepStrictEqual(sent, []);
});

test('Новая заявка: номер, получатель, сумма, подразделение, ссылка с токеном', async (t) => {
  if (!(await requireDb(t))) return;
  await setRegistryChat('registry-chat');
  const r = await create();
  await flush();
  assert.strictEqual(sent.length, 1);
  const msg = sent[0];
  assert.strictEqual(msg.chatId, 'registry-chat');
  assert.match(msg.text, new RegExp('Новая заявка №' + r.number + ' · ООО "ПРОМХИМ"'));
  assert.match(msg.text, /63\s800 ₽/);
  assert.match(msg.text, /Стройка/);
  assert.match(msg.text, /до 20\.10\.2026/);
  const token = await registry.getOwnerToken();
  assert.ok(msg.text.includes('https://calc.example/v2/?owner=' + token + '#/registry/' + r.number), msg.text);
});

test('PUBLIC_BASE_URL важнее заголовков запроса', async (t) => {
  if (!(await requireDb(t))) return;
  await setRegistryChat('registry-chat');
  process.env.PUBLIC_BASE_URL = 'https://calc.adat.ru/';
  try {
    await create();
    await flush();
    assert.ok(sent[0].text.includes('https://calc.adat.ru/v2/?owner='));
  } finally {
    delete process.env.PUBLIC_BASE_URL;
  }
});

async function setBuhChat(id) {
  await db.pool.query('UPDATE config SET telegram_registry_buh_chat_id = $1 WHERE id = 1', [id]);
}

test('Одобрение части уходит бухгалтеру: «Можно делать платёжку», получатель отдельной строкой', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await create();
  await setRegistryChat('registry-chat');
  await setBuhChat('buh-chat');
  await registry.decide(r.id, { decision: 'approved', approvedAmount: 50000 }, { origin: 'https://calc.example' });
  await flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, 'buh-chat');
  assert.match(sent[0].text, new RegExp('❗️❗️❗️ <b>Можно делать платёжку: №' + r.number + '</b>\\nООО "ПРОМХИМ"\\n'));
  assert.match(sent[0].text, /К оплате: 50\s000 ₽ \(из 63\s800 ₽\)/);
});

test('Отклонение с комментарием попадает в сообщение (событие включено)', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await create();
  await setBuhChat('buh-chat');
  await db.pool.query(`UPDATE config SET telegram_registry_events = '{"rejected_postponed":true}' WHERE id = 1`);
  await registry.decide(r.id, { decision: 'rejected', comment: 'Есть <на> складе' });
  await flush();
  assert.match(sent[0].text, /отклонено/);
  assert.match(sent[0].text, /Есть &lt;на&gt; складе/);
});

test('Оплаты (событие выключено по умолчанию) и правки не уведомляют', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await create();
  await registry.decide(r.id, { decision: 'approved' });
  await registry.markPaymentOrder(r.id);
  await flush();
  await setRegistryChat('registry-chat');
  await setBuhChat('buh-chat');
  await registry.addPayment(r.id, { amount: 1000, paidOn: calc.todayMoscow() });
  await registry.update(r.id, { purpose: 'другое' });
  const pay = (await registry.get(r.id)).payments[0];
  await registry.removePayment(pay.id);
  await flush();
  assert.deepStrictEqual(sent, []);
});

test('Telegram недоступен: решение сохраняется', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await create();
  await setRegistryChat('registry-chat');
  failNext = true;
  const origError = console.error;
  console.error = () => {};
  try {
    const x = await registry.decide(r.id, { decision: 'approved' });
    await flush();
    assert.strictEqual(x.state.status, 'approved');
    assert.strictEqual((await registry.get(r.id)).state.status, 'approved');
  } finally {
    console.error = origError;
  }
});

test('Разные чаты: заявка уходит только в чат реестра', async (t) => {
  if (!(await requireDb(t))) return;
  await setRegistryChat('registry-chat');
  await create();
  await flush();
  assert.deepStrictEqual(sent.map((s) => s.chatId), ['registry-chat']);
});

test('Настройки и «Отправить тестовое» через API', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const empty = await call('POST', '/api/registry/telegram-test', { cookie: admin, json: {} });
  assert.strictEqual(empty.status, 502);
  assert.match(empty.data.error, /ID чата адресата «Учредитель»/);
  const ok = await call('POST', '/api/registry/telegram-test', { cookie: admin, json: { telegramRegistryChatId: '-100123' } });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(sent.map((s) => s.chatId), ['-100123']);
  const settings = await call('GET', '/api/registry/settings', { cookie: admin });
  assert.strictEqual(settings.data.telegramRegistryChatId, '-100123');
});
