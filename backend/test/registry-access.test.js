// Сценарии спеки payment-registry/owner-access и "Доступ к реестру" из requests.
const test = require('node:test');
const assert = require('node:assert');
const { requireDb, resetRegistry, ready, db } = require('./helpers/db');
const { call, cookieFor, stop } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');

test.after(stop);
test.beforeEach(async () => { if (await ready()) await resetRegistry(); });

async function ownerToken() {
  return registry.getOwnerToken();
}

test('Ссылка учредителя есть сразу после миграции', async (t) => {
  if (!(await requireDb(t))) return;
  assert.ok((await ownerToken()).length >= 32);
});

test('Вход по ссылке: валидный токен проходит check и видит реестр', async (t) => {
  if (!(await requireDb(t))) return;
  const owner = await ownerToken();
  assert.strictEqual((await call('GET', '/api/registry/owner/check', { owner })).status, 200);
  const list = await call('GET', '/api/registry/requests', { owner });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.data.items));
});

test('Неверный токен: «Ссылка недействительна», реестр не открывается', async (t) => {
  if (!(await requireDb(t))) return;
  const r = await call('GET', '/api/registry/owner/check', { owner: 'deadbeef' });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.data.error, 'Ссылка недействительна');
  assert.strictEqual((await call('GET', '/api/registry/requests', { owner: 'deadbeef' })).status, 403);
  assert.strictEqual((await call('GET', '/api/registry/requests')).status, 403);
});

test('Перевыпуск: старая ссылка перестаёт работать, новая работает', async (t) => {
  if (!(await requireDb(t))) return;
  const old = await ownerToken();
  const admin = await cookieFor('admin');
  const r = await call('POST', '/api/registry/owner/reissue', { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.notStrictEqual(r.data.ownerToken, old);
  assert.strictEqual((await call('GET', '/api/registry/owner/check', { owner: old })).status, 401);
  assert.strictEqual((await call('GET', '/api/registry/owner/check', { owner: r.data.ownerToken })).status, 200);
});

test('Перевыпуск доступен только admin', async (t) => {
  if (!(await requireDb(t))) return;
  const owner = await ownerToken();
  assert.strictEqual((await call('POST', '/api/registry/owner/reissue', { owner })).status, 403);
});

test('Manager: реестр и его API закрыты', async (t) => {
  if (!(await requireDb(t))) return;
  const manager = await cookieFor('manager');
  assert.strictEqual((await call('GET', '/api/registry/requests', { cookie: manager })).status, 403);
  assert.strictEqual((await call('GET', '/api/registry/categories', { cookie: manager })).status, 403);
  assert.strictEqual((await call('POST', '/api/registry/requests', { cookie: manager, json: {} })).status, 403);
});

test('Работник по ссылке завода: отказ', async (t) => {
  if (!(await requireDb(t))) return;
  const { rows } = await db.pool.query('SELECT access_token FROM plants WHERE access_token IS NOT NULL LIMIT 1');
  const token = rows[0].access_token;
  assert.strictEqual((await call('GET', '/api/registry/requests?token=' + token)).status, 403);
  assert.strictEqual((await call('GET', '/api/registry/requests', { owner: token })).status, 403);
});

test('Токен учредителя на чужом API — как аноним', async (t) => {
  if (!(await requireDb(t))) return;
  const owner = await ownerToken();
  // manager-only маршрут
  assert.strictEqual((await call('GET', '/api/stock-movements', { owner })).status, 403);
  // ДДС для анонима без токена завода — отказ, данных нет
  assert.strictEqual((await call('GET', '/api/cash-entries', { owner })).status, 400);
  // настройки реестра — только admin
  assert.strictEqual((await call('GET', '/api/registry/settings', { owner })).status, 403);
});

// Равные права (change reestr-payment-order, спека access-equal): по полному
// списку маршрутов — у admin и учредителя одинаково, кроме Настроек.
const SETTINGS_ONLY = [
  'POST /^\\/api\\/registry\\/(categories|units)$/',
  'PUT /^\\/api\\/registry\\/(categories|units)\\/([^/]+)$/',
  'DELETE /^\\/api\\/registry\\/(categories|units)\\/([^/]+)$/',
  'POST /^\\/api\\/registry\\/owner\\/reissue$/',
  'GET /^\\/api\\/registry\\/settings$/',
  'PUT /^\\/api\\/registry\\/settings$/',
  'POST /^\\/api\\/registry\\/telegram-test$/'
];

test('Маршруты реестра: всё admin + учредитель, Настройки — только admin', () => {
  const routes = require('../registry-routes')({ readBody: async () => ({}), sendJson: () => {} });
  const seen = [];
  for (const r of routes) {
    const key = r.method + ' ' + r.pattern;
    if (!r.registryRoles) { assert.strictEqual(key, 'GET /^\\/api\\/registry\\/owner\\/check$/'); continue; }
    seen.push(key);
    const want = SETTINGS_ONLY.includes(key) ? ['admin'] : ['admin', 'owner'];
    assert.deepStrictEqual(r.registryRoles, want, key);
  }
  for (const k of SETTINGS_ONLY) assert.ok(seen.includes(k), 'нет маршрута ' + k);
});

test('По ссылке учредителя: заявка, правка, платёжка, оплата, удаление оплаты; Настройки — 403', async (t) => {
  if (!(await requireDb(t))) return;
  const owner = await ownerToken();
  const u = await fx.unit('Джага');
  const c = await fx.category('Запчасти');
  const created = await call('POST', '/api/registry/requests', { owner, json: { unitId: u, categoryId: c, recipient: 'ООО «Ромашка»', purpose: 'Запчасти', amount: 27352 } });
  assert.strictEqual(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  assert.strictEqual((await call('PUT', '/api/registry/requests/' + id, { owner, json: { purpose: 'Фильтры' } })).status, 200);
  assert.strictEqual((await call('POST', '/api/registry/requests/' + id + '/decision', { owner, json: { decision: 'approved' } })).status, 200);
  assert.strictEqual((await call('POST', '/api/registry/requests/' + id + '/payment-order', { owner })).data.state.status, 'ready');
  const paid = await call('POST', '/api/registry/requests/' + id + '/payments', { owner, json: { amount: 27352, paidOn: '2026-10-01' } });
  assert.strictEqual(paid.status, 201, JSON.stringify(paid.data));
  assert.strictEqual(paid.data.state.status, 'paid');
  assert.strictEqual((await call('DELETE', '/api/registry/payments/' + paid.data.payments[0].id, { owner })).status, 200);
  const before = await ownerToken();
  assert.strictEqual((await call('POST', '/api/registry/owner/reissue', { owner })).status, 403);
  assert.strictEqual(await ownerToken(), before);
  assert.strictEqual((await call('PUT', '/api/registry/settings', { owner, json: { telegramRegistryChatId: 'x' } })).status, 403);
  assert.strictEqual((await call('POST', '/api/registry/categories', { owner, json: { name: 'Новая' } })).status, 403);
  assert.strictEqual((await call('GET', '/api/registry/categories', { owner })).status, 200);
  const del = await call('DELETE', '/api/registry/requests/' + id, { owner });
  assert.ok(del.status === 200 || del.status === 204, String(del.status));
});
