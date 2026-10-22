// Сквозной браузерный сценарий исправления заказа (change order-edit,
// задача 8.1): работник по ссылке на телефоне оформляет заказ, исправляет
// объём, видит «испр.» и журнал; admin на ПК исправляет цену того же заказа;
// повторное сохранение устаревшей формы отклоняется; ширина 360 px без
// горизонтального скролла.
//
// НЕ входит в `npm test` (нужен браузер). Playwright — вне зависимостей
// проекта, ставится отдельно (см. registry.e2e.js):
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск — против сервера на ЧИСТОЙ базе (сид-данные: Завод 1, рецепт М200
// по 6 800, миксер на 7 м³):
//   createdb calc_e2e_oe
//   DATABASE_URL=postgres://localhost:5432/calc_e2e_oe PORT=3102 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules E2E_BASE=http://127.0.0.1:3102 node scripts/e2e/order-edit.e2e.js
// Telegram в e2e не подменяется (на чистой базе бот не настроен) — текст
// уведомления проверяют тесты backend/test/order-edit.test.js; здесь
// проверяется журнал, из которого уведомление строится.
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3102';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-oe-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });

const plain = (s) => (s || '').replace(/ | /g, ' ').trim();
let step = 0;
function log(msg) { console.log(String(++step).padStart(2, '0') + ' ✔ ' + msg); }

(async () => {
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});

  // ---- admin: данные ----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await desk.newPage();
  admin.on('dialog', (d) => { console.log('   dialog: ' + d.message()); d.accept(); });
  admin.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  if (process.env.E2E_DEBUG) {
    admin.on('request', (r) => { if (r.url().includes('/api/')) console.log('   ' + r.method() + ' ' + r.url()); });
    admin.on('console', (m) => console.log('   console ' + m.type() + ': ' + m.text()));
  }
  await admin.goto(BASE + '/v2/');
  await admin.fill('#login-password', ADMIN_PASSWORD);
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('#app-shell:not([hidden])');
  const api = admin.request;
  const get = async (url) => (await api.get(BASE + '/api' + url)).json();
  const plants = await get('/plants');
  const p1 = await (await api.post(BASE + '/api/plants/' + plants.find((p) => p.name === 'Завод 1').id + '/reissue-token')).json();
  const recipe = (await get('/recipes?plantId=' + p1.id)).find((r) => r.name === 'М200');
  const client = await (await api.post(BASE + '/api/clients', { data: { name: 'СтройИнвест', plantId: p1.id } })).json();
  const mixer = (await get('/mixers'))[0];
  log('Данные: Завод 1 (М200), клиент «СтройИнвест»');

  // ---- работник на телефоне: оформляет заказ ----
  const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  phone.on('dialog', (d) => d.accept());
  await phone.goto(BASE + '/v2/?token=' + p1.accessToken);
  await phone.waitForSelector('#mc-client option', { state: 'attached' });
  await phone.selectOption('#mc-recipe', recipe.id);
  await phone.fill('#mc-volume', '10');
  await phone.selectOption('#mc-client', client.id);
  await phone.selectOption('#mc-mixer', mixer.id);
  await phone.fill('#mc-dist', '12');
  await phone.fill('#mc-address', 'ул. Ленина, 5');
  const [created] = await Promise.all([
    phone.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST'),
    phone.click('#mc-place-order-btn')
  ]);
  assert.strictEqual(created.status(), 201, await created.text());
  const order = await created.json();
  log('Работник оформил заказ 10 м³ М200 «СтройИнвест», ул. Ленина, 5, 12 км');

  // ---- работник: «Исправить» из списка ----
  await phone.goto(BASE + '/v2/?token=' + p1.accessToken + '#/orders');
  await phone.waitForSelector('[data-order-id="' + order.id + '"] .o-edit-btn');
  await phone.click('[data-order-id="' + order.id + '"] .o-edit-btn');
  await phone.waitForSelector('#mc-edit-banner:not([hidden])');
  assert.match(plain(await phone.textContent('#mc-edit-title')), /^Исправление заказа · СтройИнвест · \d\d\.\d\d\.\d{4}$/);
  assert.strictEqual(plain(await phone.inputValue('#mc-volume')), '10');
  assert.strictEqual(await phone.inputValue('#mc-address'), 'ул. Ленина, 5');
  assert.strictEqual(plain(await phone.inputValue('#mc-dist')), '12');
  assert.strictEqual(await phone.inputValue('#mc-client'), client.id);
  assert.strictEqual(await phone.inputValue('#mc-recipe'), recipe.id);
  assert.strictEqual(await phone.inputValue('#mc-mixer'), mixer.id);
  assert.strictEqual(plain(await phone.textContent('#mc-place-order-btn')), 'Сохранить исправление');
  assert.ok(await phone.$eval('#mc-place-order-btn', (b) => b.disabled), 'без изменений сохранить нельзя');
  assert.ok(await phone.$eval('#mc-edit-plant', (s) => s.hidden), 'работник завод не выбирает');
  log('Форма исправления на телефоне заполнена из заказа, «Сохранить исправление» неактивна');

  await phone.fill('#mc-volume', '12');
  assert.ok(!(await phone.$eval('#mc-place-order-btn', (b) => b.disabled)), 'после правки можно сохранить');
  assert.match(plain(await phone.textContent('#mc-edit-diff')), /Выручка.*→.*Себестоимость.*→.*Прибыль.*→/);
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= 360), 'форма без горизонтального скролла на 360 px');
  await phone.screenshot({ path: OUT + '01-phone-edit-form.png', fullPage: true });
  const [put1] = await Promise.all([
    phone.waitForResponse((r) => r.url().includes('/api/orders/' + order.id) && r.request().method() === 'PUT'),
    phone.click('#mc-place-order-btn')
  ]);
  assert.strictEqual(put1.status(), 200, await put1.text());
  assert.ok(put1.url().includes('token='), 'работник шлёт токен завода');
  await phone.waitForSelector('#mc-edit-banner', { state: 'hidden' });
  assert.strictEqual(plain(await phone.textContent('#mc-place-order-btn')), 'Оформить заказ');
  assert.strictEqual(await phone.inputValue('#mc-volume'), '');
  log('Работник исправил объём 10 → 12 м³, форма вернулась к новому заказу');

  await phone.goto(BASE + '/v2/?token=' + p1.accessToken + '#/orders');
  await phone.waitForSelector('[data-order-id="' + order.id + '"] .mo-edits-chip');
  await phone.click('[data-order-id="' + order.id + '"] .mo-edits-chip');
  const journal = plain(await phone.textContent('[data-order-id="' + order.id + '"] .mo-edits'));
  assert.match(journal, /Работник · Завод 1 · Объём: 10 → 12 м³, Прибыль: .* → .* ₽/);
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= 360), 'журнал без горизонтального скролла на 360 px');
  await phone.screenshot({ path: OUT + '02-phone-journal.png', fullPage: true });
  log('В списке «испр.», журнал: «Работник · Завод 1 · Объём: 10 → 12 м³ …»');

  // ---- admin на ПК: исправляет цену того же заказа ----
  await admin.goto(BASE + '/v2/#/orders');
  await admin.reload();
  await admin.waitForSelector('.o-menu-btn');
  const row = admin.locator('.row', { hasText: 'СтройИнвест' }).first();
  await row.locator('.o-menu-btn').click();
  await admin.click('#o-shared-edit');
  await admin.waitForSelector('#m-edit-banner:not([hidden])');
  assert.strictEqual(plain(await admin.inputValue('#m-volume')), '12');
  assert.ok(await admin.$eval('#m-place-order-btn', (b) => b.disabled));
  assert.ok(!(await admin.$eval('#m-edit-plant', (s) => s.hidden)), 'admin может сменить завод');
  // Устаревшая копия заказа для проверки одновременных правок.
  const stale = (await get('/orders')).find((o) => o.id === order.id);
  await admin.fill('#m-price', '7500');
  await admin.click('#m-volume');
  assert.ok(!(await admin.$eval('#m-place-order-btn', (b) => b.disabled)));
  // Без fullPage: снимок на всю высоту меняет окно и может пересобрать
  // разметку формы посреди правки.
  await admin.screenshot({ path: OUT + '03-desktop-edit-form.png' });
  const [put2] = await Promise.all([
    admin.waitForResponse((r) => r.url().includes('/api/orders/' + order.id) && r.request().method() === 'PUT'),
    admin.click('#m-place-order-btn')
  ]);
  assert.strictEqual(put2.status(), 200, await put2.text());
  await admin.waitForSelector('#m-edit-banner', { state: 'hidden' });
  const after = (await get('/orders')).find((o) => o.id === order.id);
  assert.strictEqual(after.salePrice, 7500);
  assert.strictEqual(after.saleVolume, 12);
  assert.deepStrictEqual(after.edits.map((e) => e.actor), ['Admin', 'Работник · Завод 1']);
  assert.deepStrictEqual(after.edits[0].changes.map((c) => c.text), ['Цена: 6 800 → 7 500 ₽']);
  log('Admin на ПК исправил цену 6 800 → 7 500 ₽; в журнале две правки, последняя сверху');

  const conflict = await api.put(BASE + '/api/orders/' + order.id, { data: Object.assign({}, stale, { saleVolume: 15 }) });
  assert.strictEqual(conflict.status(), 409);
  assert.strictEqual((await conflict.json()).error, 'Заказ уже исправили — откройте заново');
  log('Сохранение по устаревшей версии отклонено: «Заказ уже исправили — откройте заново»');

  await admin.goto(BASE + '/v2/#/orders');
  await admin.waitForSelector('.o-edits-chip');
  await admin.locator('.o-edits-chip').first().click();
  assert.match(plain(await admin.textContent('#o-list')), /Admin · Цена: 6 800 → 7 500 ₽/);
  await admin.screenshot({ path: OUT + '04-desktop-journal.png', fullPage: true });
  log('Журнал раскрывается и на ПК');

  await browser.close();
  console.log('Скриншоты: ' + OUT);
})().catch((err) => { console.error(err); process.exit(1); });
