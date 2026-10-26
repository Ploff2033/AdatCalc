// Сервер для автозаполнения (change reestr-autofill, задачи 3.1–3.2):
// ИНН и № счёта в заявке, подстановка по ИНН, поиск дубля.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, ready } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const dict = require('../handlers/registry-dictionaries');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(stop);
test.beforeEach(async () => { if (await ready()) await resetRegistry(); });

async function base() {
  return { unitId: await fx.unit('Джага'), categoryId: await fx.category('Топливо') };
}

function body(d, extra) {
  return Object.assign({ unitId: d.unitId, categoryId: d.categoryId, recipient: 'ООО «ФОРА»', purpose: 'ТКСО ДС', amount: 95450 }, extra);
}

test('Сохранение при создании: ИНН, № счёта извлекается из основания', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await registry.create(body(await base(), { recipientInn: '0916011226', basis: 'Счёт № 531 от 22.10.2026; договор поставки нефтепродуктов № 53 от 16.10.2025' }));
  assert.strictEqual(r.recipientInn, '0916011226');
  assert.strictEqual(r.invoiceNumber, '531');
  const listed = (await registry.list({})).items[0];
  assert.strictEqual(listed.recipientInn, '0916011226');
});

test('ИНН 12 цифр (ИП) и с пробелами принимается', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await registry.create(body(await base(), { recipientInn: '2606 1234 5678' }));
  assert.strictEqual(r.recipientInn, '260612345678');
});

test('Неверный ИНН — 400 с текстом про 10 или 12 цифр', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  await assert.rejects(registry.create(body(d, { recipientInn: '09160112' })), (e) => e.status === 400 && /10 или 12 цифр/.test(e.message));
  const r = await registry.create(body(d));
  await assert.rejects(registry.update(r.id, { recipientInn: '12345678901' }), { status: 400 });
});

test('Без ИНН и номера — как раньше, поля пустые', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await registry.create(body(await base()));
  assert.strictEqual(r.recipientInn, null);
  assert.strictEqual(r.invoiceNumber, null);
});

test('Правка основания в карточке пересчитывает № счёта; отдельное поле номера игнорируется', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await registry.create(body(await base()));
  const x = await registry.update(r.id, { recipientInn: '0916011226', basis: 'Счет на оплату № 531 от 22.10.2026' });
  assert.strictEqual(x.recipientInn, '0916011226');
  assert.strictEqual(x.invoiceNumber, '531');
  const y = await registry.update(r.id, { basis: 'договор № 53 от 16.10.2025', invoiceNumber: '999' });
  assert.strictEqual(y.invoiceNumber, null);
  assert.strictEqual(y.recipientInn, '0916011226');
});

test('Номер из основания: «Счёт №RU…», без пробела и с точкой в конце', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  assert.strictEqual((await registry.create(body(d, { basis: 'СЧЕТ №RU203023711-1792739333 от 23.10.2026' }))).invoiceNumber, 'RU203023711-1792739333');
  assert.strictEqual((await registry.create(body(d, { basis: 'Счёт № 21.' }))).invoiceNumber, '21');
});

test('Постоянный поставщик: подстановка из последней заявки этого ИНН', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const other = await fx.unit('Теберда');
  await registry.create(body(d, { unitId: other, recipientInn: '3444197347', applicant: 'Старый' }));
  const last = await registry.create(body(d, { recipientInn: '3444197347', applicant: 'Руслан' }));
  const res = await registry.lookup({ inn: '3444197347' });
  assert.deepStrictEqual(res.defaults, { unitId: d.unitId, categoryId: d.categoryId, applicant: 'Руслан', fromNumber: last.number });
});

test('Новый поставщик: подстановки нет', async (t) => {
  if (!(await requireDb(t))) return;
  await registry.create(body(await base(), { recipientInn: '3444197347' }));
  assert.deepStrictEqual(await registry.lookup({ inn: '0916011226' }), { defaults: null, duplicates: [] });
});

test('Категория прошлой заявки скрыта — не подставляется, остальное подставляется', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  await registry.create(body(d, { recipientInn: '3444197347', applicant: 'Руслан' }));
  await dict.update('categories', d.categoryId, { hidden: true });
  const res = await registry.lookup({ inn: '3444197347' });
  assert.strictEqual(res.defaults.categoryId, null);
  assert.strictEqual(res.defaults.unitId, d.unitId);
  assert.strictEqual(res.defaults.applicant, 'Руслан');
});

test('Повторный счёт: тот же ИНН и № (без учёта пробелов и регистра) — дубль', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  const first = await registry.create(body(d, { recipientInn: '3444197347', basis: 'Счёт № RU203023711-1792739333 от 23.10.2026' }));
  const res = await registry.lookup({ inn: '3444197347', invoiceNumber: ' ru203023711-1792739333 ' });
  assert.deepStrictEqual(res.duplicates, [{ id: first.id, number: first.number }]);
});

test('Тот же номер у другого поставщика — не дубль', async (t) => {
  if (!(await requireDb(t))) return;
  const d = await base();
  await registry.create(body(d, { recipientInn: '0916011226', basis: 'Счёт № 21 от 01.10.2026' }));
  const res = await registry.lookup({ inn: '260612345678', invoiceNumber: '21' });
  assert.deepStrictEqual(res.duplicates, []);
});

test('lookup: только admin', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const manager = await cookieFor('manager');
  const owner = await registry.getOwnerToken();
  assert.strictEqual((await call('GET', '/api/registry/lookup?inn=0916011226', { cookie: admin })).status, 200);
  assert.strictEqual((await call('GET', '/api/registry/lookup?inn=0916011226', { cookie: manager })).status, 403);
  assert.strictEqual((await call('GET', '/api/registry/lookup?inn=0916011226', { owner })).status, 403);
});

test('Миграция повторно — без ошибок, у старых заявок поля NULL', async (t) => {
  if (!(await requireDb(t))) return;
  const u = await fx.unit('Офис');
  const c = await fx.category('Прочее');
  const raw = await fx.rawRequest(u, c);
  await db.migrate();
  await db.migrate();
  const r = await registry.get(raw);
  assert.strictEqual(r.recipientInn, null);
  assert.strictEqual(r.invoiceNumber, null);
});
