// Сквозной сценарий «Платёжка готова» (change reestr-payment-order, задачи
// 3.2, 5.1, 5.2 и 6.2; спеки payment-registry/payment-order и access-equal).
// Admin на ПК, учредитель по ссылке на ПК и на телефоне.
//
// Как и остальные e2e — НЕ часть `npm test`, Playwright вне зависимостей:
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск против сервера на ЧИСТОЙ базе:
//   createdb calc_e2e && DATABASE_URL=postgres://localhost:5432/calc_e2e PORT=3100 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules node scripts/e2e/registry-payment-order.e2e.js
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3100';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-po-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });

let step = 0;
const ok = (msg) => console.log(String(++step).padStart(2) + '. ✓ ' + msg);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, who) => {
    p.on('pageerror', (e) => errors.push(who + ' pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(who + ' console: ' + m.text()); });
  };

  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await adminCtx.newPage();
  watch(desk, 'desk');
  await desk.goto(BASE + '/v2/');
  await desk.fill('#login-password', ADMIN_PASSWORD);
  await desk.click('#login-form button[type=submit]');
  await desk.waitForSelector('#app-shell:not([hidden])');
  const api = (method, url, body) => desk.evaluate(async ([m, u, b]) => {
    const r = await fetch('/api/registry' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return r.status === 204 ? null : r.json();
  }, [method, url, body]);

  const unit = await api('POST', '/units', { name: 'Джага' });
  const cat = await api('POST', '/categories', { name: 'Топливо' });
  const mk = (recipient, amount) => api('POST', '/requests', { unitId: unit.id, categoryId: cat.id, recipient, purpose: 'Топливо', amount });
  const approve = async (r) => api('POST', '/requests/' + r.id + '/decision', { decision: 'approved' });
  const get = (r) => api('GET', '/requests/' + r.id);
  const owner = (await api('GET', '/settings')).ownerToken;

  // ---------- admin на ПК: путь одной заявки ----------
  const r = await mk('ООО «ФОРА»', 84000);
  await approve(r);
  await mk('ООО «Ожидающая»', 1000);
  await desk.goto(BASE + '/v2/#/registry/' + r.number);
  await desk.waitForSelector('#rg-drawer:not([hidden]) #rg-po-mark');
  assert.strictEqual(await desk.locator('#rg-pay-form').count(), 0);
  ok('карточка одобренной: на месте формы оплаты — «Платёжка готова», формы нет');

  await desk.click('#rg-po-mark');
  await desk.waitForSelector('#rg-pay-form');
  assert.strictEqual(await desk.locator('#rg-po-mark').count(), 0);
  assert.ok(await desk.locator('#rg-po-cancel').count());
  assert.strictEqual((await get(r)).state.status, 'ready');
  await desk.waitForFunction(() => /Платёжка готова/.test(document.querySelector('.rg-group') && document.querySelector('.rg-group').textContent));
  const row = desk.locator('.rg-row[data-id="' + r.id + '"]');
  assert.ok(await row.locator('.chip.ready').count(), 'фиолетовый статус в строке');
  assert.match(await row.locator('.rg-ready-age').textContent(), /^готова сегодня \d\d:\d\d$/);
  await desk.screenshot({ path: OUT + 'desk-ready.png' });
  ok('«Платёжка готова»: форма «+ Оплата» и «Отменить платёжку»; группа первая, фиолетовая, «готова сегодня ЧЧ:ММ»');

  await desk.fill('#rg-pay-amount', '50000');
  await desk.click('#rg-pay-form button[type=submit]');
  await desk.waitForSelector('#rg-po-mark');
  let x = await get(r);
  assert.strictEqual(x.state.status, 'partial');
  assert.strictEqual(x.state.unpaid, 34000);
  ok('оплата 50 000 → «Частично оплачена», остаток 34 000, снова кнопка «Платёжка готова»');

  await desk.click('#rg-po-mark');
  await desk.waitForSelector('#rg-po-cancel');
  desk.once('dialog', (d) => d.accept('отозвана из банка'));
  await desk.click('#rg-po-cancel');
  await desk.waitForSelector('#rg-po-mark');
  x = await get(r);
  assert.strictEqual(x.state.status, 'partial');
  assert.match(await desk.textContent('#rg-drawer'), /Платёжка отменена: отозвана из банка/);
  ok('«Отменить платёжку» с причиной → снова «Частично оплачена», причина видна в карточке');

  await desk.click('#rg-po-mark');
  await desk.waitForSelector('#rg-pay-form');
  await desk.click('#rg-pay-form button[type=submit]');
  await desk.waitForFunction(() => !document.querySelector('#rg-pay-form') && !document.querySelector('#rg-po-mark'));
  assert.strictEqual((await get(r)).state.status, 'paid');
  ok('снова «Платёжка готова» → оплата остатка → «Оплачена»');
  await desk.click('#rg-close');

  // ---------- пачка «Платёжка готова» ----------
  const b = [await mk('ООО «Пачка-1»', 95450), await mk('ООО «Пачка-2»', 140000), await mk('ООО «Пачка-3»', 284550)];
  for (const it of b) await approve(it);
  await desk.goto(BASE + '/v2/#/registry');
  await desk.waitForSelector('.rg-row[data-id="' + b[0].id + '"]');
  const apprGroup = desk.locator('.rg-group', { hasText: 'Одобрена / Частично' });
  await apprGroup.locator('[data-bulk-enter]').click();
  await desk.locator('.rg-group [data-bulk-group="2"]').click();
  assert.match(norm(await desk.textContent('.rg-bulkbar-info')), /Выбрано 3 · 520 000,00 ₽/);
  assert.strictEqual(await desk.locator('[data-bulk="approved"]').count(), 0);
  await desk.click('[data-bulk="payment_ready"]');
  assert.match(norm(await desk.textContent('.rg-modal h2')), /«Платёжка готова» для 3 заявок на 520 000,00 ₽\?/);
  await desk.click('.rg-modal [data-m="yes"]');
  await desk.waitForSelector('#rg-bulk-result');
  assert.match(await desk.textContent('#rg-bulk-result'), /Отмечено 3 из 3/);
  for (const it of b) assert.strictEqual((await get(it)).state.status, 'ready');
  await desk.screenshot({ path: OUT + 'desk-bulk.png' });
  ok('пачка: «Выбрать все» в «Одобрена / Частично» → «Платёжка готова» → «Отмечено 3 из 3»');

  // ---------- учредитель по ссылке на ПК ----------
  const ownerDeskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const od = await ownerDeskCtx.newPage();
  watch(od, 'owner-desk');
  await od.goto(BASE + '/v2/?owner=' + owner);
  await od.waitForSelector('.rg-row');
  assert.ok(await od.locator('#rg-add-btn').isVisible(), '«Новая заявка»');
  assert.ok(await od.locator('#rg-autodrop').isVisible(), '«Перетащите счета»');
  assert.ok(!(await od.locator('.sidebar').isVisible()), 'без сайдбара');
  await od.screenshot({ path: OUT + 'owner-desk.png' });
  ok('ссылка учредителя на ПК: таблица, «Новая заявка», «Перетащите счета», без сайдбара');

  await od.click('#rg-add-btn');
  await od.waitForSelector('#rg-new-form');
  await od.selectOption('#rg-new-form select[id$="-unit"]', unit.id);
  await od.selectOption('#rg-new-form select[id$="-category"]', cat.id);
  await od.fill('#rg-new-form [id$="-recipient"]', 'ООО «От учредителя»');
  await od.fill('#rg-new-form [id$="-purpose"]', 'Проверка');
  await od.fill('#rg-new-form [id$="-amount"]', '1500');
  await od.click('#rg-new-form button[type=submit]');
  await od.waitForFunction(() => document.querySelector('#rg-rows') && /От учредителя/.test(document.querySelector('#rg-rows').textContent));
  ok('учредитель на ПК создал заявку');
  if (await od.locator('#rg-close').count()) await od.click('#rg-close');
  await od.waitForSelector('#rg-drawer', { state: 'hidden' });

  await od.click('.rg-row[data-id="' + b[0].id + '"]');
  await od.waitForSelector('#rg-pay-form');
  await od.click('#rg-pay-form button[type=submit]');
  await od.waitForFunction(() => !document.querySelector('#rg-pay-form'));
  assert.strictEqual((await get(b[0])).state.status, 'paid');
  ok('учредитель на ПК внёс оплату по «Платёжке готова»');

  // ---------- учредитель на телефоне ----------
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const o = await phone.newPage();
  watch(o, 'owner-phone');
  await o.goto(BASE + '/v2/?owner=' + owner + '#/registry/' + b[1].number);
  await o.waitForSelector('#rgm-pay-form');
  assert.ok(await o.locator('#rgm-po-cancel').count());
  await o.screenshot({ path: OUT + 'owner-phone-card.png' });
  ok('ссылка на телефоне: в карточке «Платёжки готова» — форма «+ Оплата» и «Отменить платёжку»');
  o.once('dialog', (d) => d.accept(''));
  await o.click('#rgm-po-cancel');
  await o.waitForSelector('#rgm-po-mark');
  assert.strictEqual((await get(b[1])).state.status, 'approved');
  ok('отмена на телефоне без причины → «Одобрена», снова кнопка «Платёжка готова»');
  await o.click('#rgm-back');
  await o.waitForSelector('.rgm-card');
  assert.match(await o.textContent('.rgm-sep'), /Платёжка готова/);
  assert.match(await o.locator('.rgm-card[data-id="' + b[2].id + '"] .rg-ready-age').textContent(), /Платёжка готова сегодня/);
  await o.screenshot({ path: OUT + 'owner-phone-list.png' });
  ok('список на телефоне: группа «Платёжка готова» первая, на карточке «готова сегодня …»');

  const unexpected = errors.filter((e) => !/status of (400|409)/.test(e));
  console.log('Скриншоты: ' + OUT);
  console.log('Неожиданные ошибки:', unexpected.length ? unexpected.join('\n') : 'нет');
  await browser.close();
  if (unexpected.length) process.exitCode = 1;
})().catch((e) => { console.error('FAILED на шаге ' + (step + 1) + ':', e.message); process.exit(1); });
