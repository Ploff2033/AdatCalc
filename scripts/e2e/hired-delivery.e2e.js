// Сквозной браузерный сценарий режима доставки «Найм» (change
// order-hired-delivery, задачи 5.x, 6.1, 6.2, 7.3): форма на ПК и телефоне,
// маска ставки, сброс, память клиента, список, карточка, CSV, исправление.
//
// НЕ входит в `npm test` (нужен браузер). Playwright — вне зависимостей
// проекта, ставится отдельно (см. registry.e2e.js):
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск — против сервера на ЧИСТОЙ базе (сид-данные: Завод 1, рецепт М200
// по 6 800, миксер на 7 м³):
//   createdb calc_e2e_hd
//   DATABASE_URL=postgres://localhost:5432/calc_e2e_hd PORT=3103 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules E2E_BASE=http://127.0.0.1:3103 node scripts/e2e/hired-delivery.e2e.js
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3103';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-hd-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });

const plain = (s) => (s || '').replace(/[\s  ]+/g, ' ').trim();
let step = 0;
function log(msg) { console.log(String(++step).padStart(2, '0') + ' ✔ ' + msg); }

// После оформления форма сбрасывается только когда перегрузятся данные
// (State.loadAll) — ждём пустой объём, иначе сброс сотрёт следующий ввод.
async function waitReset(page, prefix) {
  await page.waitForFunction((id) => document.getElementById(id).value === '', prefix + '-volume');
}

async function modeOn(page, prefix) {
  return page.$eval('#' + prefix + '-delivery-mode button.on', (b) => b.getAttribute('data-mode'));
}

(async () => {
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});

  // ---- admin: данные ----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const admin = await desk.newPage();
  admin.on('dialog', (d) => { console.log('   dialog: ' + d.message()); d.accept(); });
  admin.on('pageerror', (e) => { console.log('   pageerror: ' + e.message); process.exitCode = 1; });
  await admin.goto(BASE + '/v2/');
  await admin.fill('#login-password', ADMIN_PASSWORD);
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('#app-shell:not([hidden])');
  const api = admin.request;
  const get = async (url) => (await api.get(BASE + '/api' + url)).json();
  const plants = await get('/plants');
  const p1 = plants.find((p) => p.name === 'Завод 1');
  const recipe = (await get('/recipes?plantId=' + p1.id)).find((r) => r.name === 'М200');
  const client = await (await api.post(BASE + '/api/clients', { data: { name: 'СтройИнвест', plantId: p1.id } })).json();
  const mixer = (await get('/mixers'))[0];
  await admin.reload();
  await admin.waitForSelector('#app-shell:not([hidden])');
  log('Данные: Завод 1 (М200), клиент «СтройИнвест», миксер «' + mixer.name + '»');

  // ---- ПК: память клиента от заказа на своём миксере ----
  await admin.goto(BASE + '/v2/#/main');
  await admin.waitForSelector('#m-delivery-mode');
  assert.strictEqual(await modeOn(admin, 'm'), 'own');
  assert.ok(await admin.$eval('#m-hire-rate-field', (f) => f.hidden), 'ставка скрыта в режиме «Своя»');
  await admin.selectOption('#m-recipe', recipe.id);
  await admin.fill('#m-volume', '20');
  await admin.selectOption('#m-client', client.id);
  await admin.selectOption('#m-mixer', mixer.id);
  await admin.fill('#m-dist', '12');
  await admin.fill('#m-address', 'ул. Ленина, 5');
  await admin.fill('#m-delivery-charge', '600');
  let [res] = await Promise.all([
    admin.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST'),
    admin.click('#m-place-order-btn')
  ]);
  assert.strictEqual(res.status(), 201, await res.text());
  const ownOrder = await res.json();
  assert.strictEqual(ownOrder.deliveryMode, 'own');
  await waitReset(admin, 'm');
  log('Заказ на своём миксере: режим «Своя», память клиента — «ул. Ленина, 5», «' + mixer.name + '»');

  // ---- ПК: включили найм ----
  await admin.selectOption('#m-recipe', recipe.id);
  await admin.fill('#m-volume', '20');
  await admin.selectOption('#m-client', client.id);
  assert.strictEqual(await modeOn(admin, 'm'), 'own');
  await admin.click('#m-delivery-mode button[data-mode=hired]');
  assert.strictEqual(await modeOn(admin, 'm'), 'hired');
  assert.ok(!(await admin.$eval('#m-hire-rate-field', (f) => f.hidden)), 'поле ставки видно');
  assert.strictEqual(await admin.inputValue('#m-hire-rate'), '', 'ставка изначально пустая');
  for (const id of ['#m-mixer', '#m-max-load', '#m-nb-city', '#m-fuel-price', '#m-urea-price']) {
    assert.ok(await admin.$eval(id, (el) => el.disabled), id + ' неактивно');
  }
  for (const id of ['#m-address', '#m-dist', '#m-delivery-charge']) {
    assert.ok(!(await admin.$eval(id, (el) => el.disabled)), id + ' активно');
  }
  assert.ok(!(await admin.$eval('#m-hire-rate-hint', (h) => h.hidden)), 'подсказка «Укажите ставку найма»');
  assert.strictEqual(plain(await admin.textContent('#m-hire-rate-hint')), 'Укажите ставку найма');
  assert.ok(await admin.$eval('#m-place-order-btn', (b) => b.disabled), 'без ставки оформить нельзя');
  log('«Найм»: пустое поле ставки, миксер/загрузка/соседний город/ГСМ неактивны, «Укажите ставку найма»');

  await admin.fill('#m-hire-rate', '1250,5');
  // Маска переформатирует поле в следующем кадре (NumericInput.attach).
  await admin.waitForFunction(() => document.getElementById('m-hire-rate').value !== '1250,5');
  assert.strictEqual(plain(await admin.inputValue('#m-hire-rate')), '1 250,5');
  log('Ставка с копейками: «1250,5» → «1 250,5»');

  await admin.fill('#m-address', 'пос. Северный');
  await admin.fill('#m-dist', '');
  await admin.fill('#m-hire-rate', '500');
  await admin.fill('#m-delivery-charge', '700');
  assert.ok(await admin.$eval('#m-hire-rate-hint', (h) => h.hidden));
  await admin.waitForFunction(() => !document.getElementById('m-place-order-btn').disabled, null, { timeout: 3000 }).catch(() => {});
  assert.ok(!(await admin.$eval('#m-place-order-btn', (b) => b.disabled)), 'найм без км можно оформить: ' + JSON.stringify(await admin.evaluate(() => ({
    rate: document.getElementById('m-hire-rate').value, addr: document.getElementById('m-address').value,
    recipe: document.getElementById('m-recipe').value, volume: document.getElementById('m-volume').value,
    cost: document.getElementById('m-delivery-cost').textContent, trips: document.getElementById('m-trip-count').textContent,
    banner: document.getElementById('m-validation-banner').textContent
  }))));
  assert.strictEqual(plain(await admin.textContent('#m-delivery-cost')), '10 000 ₽');
  assert.strictEqual(plain(await admin.textContent('#m-delivery-revenue')), '14 000 ₽');
  assert.strictEqual(plain(await admin.textContent('#m-delivery-profit')), '4 000 ₽');
  await admin.fill('#m-address', '');
  assert.ok(await admin.$eval('#m-place-order-btn', (b) => b.disabled), 'найм без адреса оформить нельзя');
  await admin.fill('#m-address', 'пос. Северный');
  await admin.fill('#m-dist', '30');
  await admin.screenshot({ path: OUT + '01-desktop-hired-form.png' });
  [res] = await Promise.all([
    admin.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST'),
    admin.click('#m-place-order-btn')
  ]);
  assert.strictEqual(res.status(), 201, await res.text());
  const hired = await res.json();
  await waitReset(admin, 'm');
  assert.strictEqual(hired.deliveryMode, 'hired');
  assert.strictEqual(hired.hireRatePerM3, 500);
  assert.strictEqual(hired.tripCount, 0);
  assert.strictEqual(hired.deliveryCostTotal, 10000);
  assert.strictEqual(hired.mixerName, 'Найм');
  log('Оформлен найм 20 м³ × 500 ₽/м³: расход 10 000, выручка 14 000, прибыль 4 000, рейсов 0');

  assert.strictEqual(await modeOn(admin, 'm'), 'own');
  assert.ok(await admin.$eval('#m-hire-rate-field', (f) => f.hidden));
  assert.strictEqual(await admin.inputValue('#m-hire-rate'), '');
  log('После оформления форма в режиме «Своя», ставка пустая');

  // ---- память: следующий заказ и выбор клиента в режиме найма ----
  await admin.selectOption('#m-client', client.id);
  assert.strictEqual(await modeOn(admin, 'm'), 'own');
  assert.strictEqual(await admin.inputValue('#m-address'), 'пос. Северный');
  assert.strictEqual(plain(await admin.inputValue('#m-dist')), '30');
  assert.strictEqual(await admin.inputValue('#m-mixer'), mixer.id);
  log('Следующий заказ клиента: «Своя», «' + mixer.name + '», «пос. Северный», 30 км');

  await admin.selectOption('#m-client', '');
  await admin.fill('#m-address', '');
  await admin.click('#m-delivery-mode button[data-mode=hired]');
  await admin.fill('#m-hire-rate', '500');
  await admin.selectOption('#m-client', client.id);
  assert.strictEqual(await modeOn(admin, 'm'), 'hired');
  assert.strictEqual(plain(await admin.inputValue('#m-hire-rate')), '500');
  assert.strictEqual(await admin.inputValue('#m-address'), 'пос. Северный');
  log('Найм, затем клиент: режим и ставка остались, адрес подставлен');
  await admin.click('#m-reset-btn');

  // ---- список и карточка на ПК ----
  await admin.goto(BASE + '/v2/#/orders');
  await admin.waitForSelector('#o-list .row');
  const rowTexts = await admin.$$eval('#o-list .row', (rows) => rows.map((r) => r.textContent));
  assert.ok(rowTexts.some((t) => t.includes('Найм')), 'в списке есть заказ с пометкой «Найм»');
  const hiredRow = admin.locator('#o-list .row', { hasText: 'пос. Северный' }).first();
  await hiredRow.click();
  const listText = plain(await admin.textContent('#o-list'));
  assert.match(listText, /Найм\s*500,00 ₽\/м³ × 20 м³ = 10 000,00 ₽/);
  await admin.screenshot({ path: OUT + '02-desktop-card.png', fullPage: true });
  log('Список: пометка «Найм»; карточка: «Найм 500,00 ₽/м³ × 20 м³ = 10 000,00 ₽»');

  const [download] = await Promise.all([admin.waitForEvent('download'), admin.click('#o-export-btn')]);
  const csv = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '').split('\r\n').map((l) => l.split(';'));
  const header = csv[0];
  assert.deepStrictEqual(header.slice(-2), ['Доставка', 'Ставка найма, ₽/м³']);
  assert.strictEqual(header[5], 'Миксер');
  const hiredCsv = csv.find((r) => r.includes('пос. Северный') && r[5] === 'Найм');
  const ownCsv = csv.find((r) => r.includes('ул. Ленина, 5'));
  assert.deepStrictEqual(hiredCsv.slice(-2), ['Найм', '500']);
  assert.deepStrictEqual(ownCsv.slice(-2), ['Своя', '']);
  log('CSV: колонки «Доставка» и «Ставка найма» в конце; «Найм»/500 и «Своя»/пусто');

  // ---- исправление: перевести «Своя» → «Найм» ----
  await admin.goto(BASE + '/v2/#/orders');
  await admin.waitForSelector('.o-menu-btn');
  await admin.locator('#o-list .row', { hasText: 'ул. Ленина, 5' }).first().locator('.o-menu-btn').click();
  await admin.click('#o-shared-edit');
  await admin.waitForSelector('#m-edit-banner:not([hidden])');
  assert.strictEqual(await modeOn(admin, 'm'), 'own');
  await admin.click('#m-delivery-mode button[data-mode=hired]');
  await admin.fill('#m-hire-rate', '500');
  [res] = await Promise.all([
    admin.waitForResponse((r) => r.url().includes('/api/orders/' + ownOrder.id) && r.request().method() === 'PUT'),
    admin.click('#m-place-order-btn')
  ]);
  assert.strictEqual(res.status(), 200, await res.text());
  const edited = (await get('/orders')).find((o) => o.id === ownOrder.id);
  assert.strictEqual(edited.deliveryMode, 'hired');
  assert.strictEqual(edited.tripCount, 0);
  const lines = edited.edits[0].changes.map((c) => c.text);
  assert.ok(lines.includes('Доставка: Своя → Найм'), lines.join(' | '));
  assert.ok(lines.includes('Ставка найма: — → 500 ₽/м³'), lines.join(' | '));
  log('Исправление «Своя» → «Найм»: 0 рейсов, журнал «Доставка: Своя → Найм», «Ставка найма: — → 500 ₽/м³»');

  // Форма исправления наёмного заказа заполняется режимом и ставкой.
  await admin.goto(BASE + '/v2/#/orders');
  await admin.waitForSelector('.o-menu-btn');
  await admin.locator('#o-list .row', { hasText: 'ул. Ленина, 5' }).first().locator('.o-menu-btn').click();
  await admin.click('#o-shared-edit');
  await admin.waitForSelector('#m-edit-banner:not([hidden])');
  assert.strictEqual(await modeOn(admin, 'm'), 'hired');
  assert.strictEqual(plain(await admin.inputValue('#m-hire-rate')), '500');
  assert.ok(await admin.$eval('#m-place-order-btn', (b) => b.disabled), 'без правок сохранить нельзя');
  await admin.click('#m-edit-cancel');
  log('Исправление наёмного заказа: форма в «Найм» со ставкой 500, без правок кнопка неактивна');

  // ---- телефон (admin, 360 px): найм в минус ----
  const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, storageState: await desk.storageState() });
  const phone = await phoneCtx.newPage();
  phone.on('dialog', (d) => d.accept());
  phone.on('pageerror', (e) => { console.log('   pageerror (phone): ' + e.message); process.exitCode = 1; });
  await phone.goto(BASE + '/v2/#/main');
  await phone.waitForSelector('#mc-delivery-mode');
  await phone.selectOption('#mc-recipe', recipe.id);
  await phone.fill('#mc-volume', '20');
  await phone.selectOption('#mc-client', client.id);
  await phone.click('#mc-delivery-mode button[data-mode=hired]');
  assert.ok(!(await phone.$eval('#mc-hire-rate-hint', (h) => h.hidden)), 'подсказка ставки на телефоне');
  assert.ok(await phone.$eval('#mc-mixer', (el) => el.disabled));
  await phone.fill('#mc-hire-rate', '750');
  await phone.fill('#mc-delivery-charge', '700');
  await phone.fill('#mc-dist', '30');
  assert.strictEqual(plain(await phone.textContent('#mc-delivery-summary-label')), 'Доставка · Найм · 750 ₽/м³ · 30 км');
  assert.strictEqual(plain(await phone.textContent('#mc-delivery-hint')), 'Доставка в минус. Безубыточно от 750 ₽/м³');
  assert.strictEqual(plain(await phone.textContent('#mc-delivery-cost')), '15 000 ₽');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= 360), 'форма без горизонтального скролла на 360 px');
  await phone.screenshot({ path: OUT + '03-phone-hired-form.png', fullPage: true });
  log('Телефон: сводка «Доставка · Найм · 750 ₽/м³ · 30 км», «Доставка в минус. Безубыточно от 750 ₽/м³»');

  [res] = await Promise.all([
    phone.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST'),
    phone.click('#mc-place-order-btn')
  ]);
  assert.strictEqual(res.status(), 201, await res.text());
  const phoneOrder = await res.json();
  await waitReset(phone, 'mc');
  assert.strictEqual(phoneOrder.deliveryProfit, -1000);
  assert.strictEqual(await modeOn(phone, 'mc'), 'own');
  log('Телефон: найм оформлен (прибыль доставки −1 000), форма вернулась в «Своя»');

  await phone.goto(BASE + '/v2/#/orders');
  await phone.waitForSelector('[data-order-id="' + phoneOrder.id + '"]');
  const card = plain(await phone.textContent('[data-order-id="' + phoneOrder.id + '"]'));
  assert.match(card, /Найм/);
  assert.ok(!/Самовывоз/.test(card), card);
  assert.match(card, /найм 750 ₽\/м³/);
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= 360), 'список без горизонтального скролла на 360 px');
  await phone.screenshot({ path: OUT + '04-phone-list.png', fullPage: true });
  log('Телефон, список: статус «Найм», не «Самовывоз»');

  await browser.close();
  console.log('Скриншоты: ' + OUT);
})().catch((err) => { console.error(err); process.exit(1); });
