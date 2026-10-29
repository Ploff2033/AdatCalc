// Сквозной браузерный сценарий отбора заказов на ПК (change
// orders-filter-search, задачи 3.2, 3.3): период, клиент, поиск, итоги дня,
// пустой результат и сброс, сохранение выбора, работник по ссылке, телефон.
//
// НЕ входит в `npm test` (нужен браузер). Playwright — вне зависимостей
// проекта, ставится отдельно (см. registry.e2e.js):
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск — против сервера на ЧИСТОЙ базе (сид-данные: Завод 1, рецепт М200):
//   createdb calc_e2e_of
//   DATABASE_URL=postgres://localhost:5432/calc_e2e_of PORT=3107 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules E2E_BASE=http://127.0.0.1:3107 node scripts/e2e/orders-filter.e2e.js
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3107';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';

const plain = (s) => (s || '').replace(/[\s  ]+/g, ' ').trim();
let step = 0;
function log(msg) { console.log(String(++step).padStart(2, '0') + ' ✔ ' + msg); }

const DAY = 24 * 3600 * 1000;
function daysAgo(n, hour) { const d = new Date(Date.now() - n * DAY); d.setHours(hour || 10, 0, 0, 0); return d.toISOString(); }

// Тело заказа самовывозом (без рейсов и путевых), как fixtures.orderBody.
function orderBody(p, c, r, extra) {
  const zero = {};
  for (const f of ['ureaPricePerLiter', 'ureaCostPerTrip', 'platonCostPerTrip', 'surchargePerTrip', 'roundTripKm',
    'fuelCostPerTrip', 'amortCostPerTrip', 'deliveryCostTotal', 'deliveryRevenue', 'deliveryProfit', 'deliveryMarginPercent',
    'materialsCost', 'payrollCost', 'deprCost', 'utilitiesCost', 'costPerM3', 'mixRevenue', 'mixCost', 'mixProfit',
    'mixMarginPercent', 'totalRevenue', 'totalProfit', 'profitPerM3', 'totalMarginPercent']) zero[f] = 0;
  return Object.assign(zero, {
    createdAt: new Date().toISOString(), plantId: p.id, plantName: p.name,
    clientId: c ? c.id : null, clientName: c ? c.name : '', clientType: 'legal',
    recipeId: r.id, recipeName: r.name, mixerId: null, mixerName: 'Самовывоз', selfPickup: true,
    address: '', saleVolume: 10, distanceKm: 0, fuelPricePerLiter: 75, neighborCity: false, tripCount: 0,
    deliveryChargePerM3: 0, salePrice: r.salePrice, vatApplied: false, materials: []
  }, extra);
}

let r;
async function rows(page) {
  return page.$$eval('#o-list > div > .row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
}
async function days(page) {
  return page.$$eval('#o-list .o-day', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
}
async function kpi(page) {
  // textContent, а не innerText: подписи плиток в CSS набраны капителью.
  return page.$$eval('#o-kpi .card', (els) => els.map((e) => [...e.children].map((c) => c.textContent.trim()).join(' ').replace(/[\s\u00a0\u202f]+/g, ' ')));
}

(async () => {
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});

  // ---- данные ----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const admin = await desk.newPage();
  admin.on('dialog', (d) => d.accept());
  admin.on('pageerror', (e) => { console.log('   pageerror: ' + e.message); process.exitCode = 1; });
  await admin.goto(BASE + '/v2/');
  await admin.fill('#login-password', ADMIN_PASSWORD);
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('#app-shell:not([hidden])');
  const api = admin.request;
  const get = async (url) => (await api.get(BASE + '/api' + url)).json();
  const post = async (url, data) => {
    const res = await api.post(BASE + '/api' + url, { data });
    assert.ok(res.ok(), url + ': ' + res.status() + ' ' + (await res.text()));
    return res.json();
  };
  const p1 = (await get('/plants')).find((p) => p.name === 'Завод 1');
  const recipe = (await get('/recipes?plantId=' + p1.id)).find((r) => r.name === 'М200');
  const stroy = await post('/clients', { name: 'СтройИнвест', plantId: p1.id });
  const granit = await post('/clients', { name: 'Гранит', plantId: p1.id });
  const monolit = await post('/clients', { name: 'Монолитстрой', plantId: p1.id });
  const o = {};
  o.s12 = await post('/orders', orderBody(p1, stroy, recipe, { saleVolume: 12, totalRevenue: 79200, address: 'ул. Ленина, 5', createdAt: daysAgo(3, 9) }));
  o.s8 = await post('/orders', orderBody(p1, stroy, recipe, { saleVolume: 8, totalRevenue: 52800, address: 'ул. Ленина, 5', createdAt: daysAgo(0, 9) }));
  o.g12 = await post('/orders', orderBody(p1, granit, recipe, { saleVolume: 12, totalRevenue: 80000, address: 'пр. Мира, 7', createdAt: daysAgo(3, 11) }));
  o.m4 = await post('/orders', orderBody(p1, monolit, recipe, { saleVolume: 4, totalRevenue: 25200, address: 'ул. Мира, 12', createdAt: daysAgo(0, 8) }));
  // Клиента удаляют из справочника: у заказа пропадает ссылка, остаётся имя.
  const romashka = await post('/clients', { name: 'Ромашка', plantId: p1.id });
  o.romashka = await post('/orders', orderBody(p1, romashka, recipe, { saleVolume: 5, totalRevenue: 30000, address: 'ул. Кирова, 3', createdAt: daysAgo(1, 10) }));
  assert.ok((await api.delete(BASE + '/api/clients/' + romashka.id)).ok());
  o.old = await post('/orders', orderBody(p1, granit, recipe, { saleVolume: 20, totalRevenue: 132000, address: 'ул. Садовая, 40', createdAt: daysAgo(45, 10) }));
  log('Данные: 3 клиента, 6 заказов (один — 45 дней назад, клиент одного удалён)');

  // ---- Менеджер/admin: строка фильтров и умолчания ----
  await admin.goto(BASE + '/v2/#/orders');
  await admin.reload(); // данные созданы через API после загрузки страницы
  await admin.waitForSelector('#o-list .row');
  assert.strictEqual(await admin.$eval('#o-period', (s) => s.value), 'all');
  assert.ok(await admin.isVisible('#o-client'));
  assert.ok(await admin.isVisible('#o-search'));
  assert.ok(await admin.$eval('#o-dates', (e) => e.hidden));
  assert.strictEqual((await rows(admin)).length, 6, 'по умолчанию — вся история');
  const today = (await days(admin))[0];
  assert.match(today, /^Сегодня 2 заказа · 12 м³ · к оплате 78 000 ₽$/, today);
  log('Менеджер: «Всё время», вся история, итоги дня «Сегодня 2 заказа · 12 м³ · к оплате 78 000 ₽»');

  // ---- Клиент: ввод сужает список, выбор ----
  await admin.click('#o-client');
  await admin.fill('#o-client', 'строй');
  const options = await admin.$$eval('#o-client-list .o-dd-item', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), html: e.querySelector('span').innerHTML })));
  assert.deepStrictEqual(options.map((x) => x.text), ['Все клиенты', 'Без клиента 0', 'Монолитстрой 1', 'СтройИнвест 2']);
  assert.strictEqual(options[2].html, 'Монолит<b>строй</b>');
  assert.strictEqual(options[3].html, '<b>Строй</b>Инвест');
  await admin.keyboard.press('ArrowDown');
  await admin.keyboard.press('Enter');
  assert.strictEqual(await admin.$eval('#o-client', (i) => i.value), 'СтройИнвест');
  assert.ok(await admin.isVisible('#o-client-clear'));
  assert.strictEqual((await rows(admin)).length, 2);
  log('Клиент: «строй» → Монолит<b>строй</b>, <b>Строй</b>Инвест; выбор стрелкой и Enter');

  // ---- Удалённый клиент — пункт по сохранённому имени ----
  await admin.click('#o-client-clear');
  await admin.click('#o-client');
  await admin.fill('#o-client', 'ромаш');
  assert.deepStrictEqual(await admin.$$eval('#o-client-list .o-dd-item', (els) => els.slice(2).map((e) => e.innerText.replace(/\s+/g, ' ').trim())), ['Ромашка 1']);
  await admin.keyboard.press('Enter');
  r = await rows(admin);
  assert.strictEqual(r.length, 1);
  assert.match(r[0], /Ромашка · 5,0 м³/);
  await admin.click('#o-client');
  await admin.fill('#o-client', 'стройинв');
  await admin.keyboard.press('Enter');
  log('Клиента «Ромашка» удалили — пункт «Ромашка 1» по сохранённому имени');

  // ---- Поиск «12» + клиент ----
  await admin.fill('#o-search', '12');
  r = await rows(admin);
  assert.strictEqual(r.length, 1, r.join('\n'));
  assert.match(r[0], /СтройИнвест · 12,0 м³/);
  assert.deepStrictEqual((await kpi(admin)).slice(0, 3), ['Заказов 1', 'Объём 12,0 м³', 'К оплате 79 200 ₽']);
  assert.match((await days(admin))[0], /1 заказ · 12 м³ · к оплате 79 200 ₽$/);
  assert.strictEqual(await admin.evaluate(() => document.activeElement.id), 'o-search', 'фокус остаётся в поиске');
  log('Клиент + «12»: один заказ, плитки и итоги дня по отбору, фокус в поле');

  // ---- Число в адресе без клиента ----
  await admin.click('#o-client-clear');
  r = await rows(admin);
  assert.strictEqual(r.length, 3, r.join('\n')); // 12 м³ ×2 и «ул. Мира, 12»
  log('«12» без клиента: заказы на 12 м³ и адрес «ул. Мира, 12»');

  // ---- Период ----
  await admin.fill('#o-search', '');
  await admin.selectOption('#o-period', '30d');
  assert.strictEqual((await rows(admin)).length, 5, '30 дней: без заказа 45-дневной давности');
  await admin.selectOption('#o-period', 'custom');
  assert.ok(!(await admin.$eval('#o-dates', (e) => e.hidden)));
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  assert.strictEqual(await admin.$eval('#o-from', (i) => i.value), ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  assert.strictEqual(await admin.$eval('#o-to', (i) => i.value), ymd(now));
  log('Период: «30 дней» скрывает старый заказ; «Выбрать даты…» — с 1-го числа по сегодня');

  // ---- Пропавший клиент сбрасывается ----
  await admin.selectOption('#o-period', 'all');
  await admin.click('#o-client');
  await admin.fill('#o-client', 'гранит');
  await admin.keyboard.press('Enter');
  assert.strictEqual((await rows(admin)).length, 2);
  await admin.selectOption('#o-period', 'custom');
  await admin.fill('#o-from', ymd(new Date(Date.now() - 1 * DAY)));
  await admin.fill('#o-to', ymd(now));
  await admin.$eval('#o-to', (i) => i.dispatchEvent(new Event('change')));
  assert.strictEqual(await admin.$eval('#o-client', (i) => i.value), '', 'Гранит пропал из списка — «Все клиенты»');
  log('Выбранный клиент без заказов в периоде сбрасывается на «Все клиенты»');

  // ---- Пустой результат и сброс ----
  await admin.selectOption('#o-period', 'all');
  await admin.fill('#o-search', 'гагарина');
  assert.ok(await admin.isVisible('#o-nothing'));
  assert.ok(!(await admin.isVisible('#o-empty')));
  assert.strictEqual(plain(await admin.textContent('#o-nothing span')), 'Нет заказов по выбранным условиям');
  assert.deepStrictEqual((await kpi(admin)).slice(0, 2), ['Заказов 0', 'Объём 0,0 м³']);
  await admin.click('#o-reset');
  assert.strictEqual(await admin.$eval('#o-search', (i) => i.value), '');
  assert.strictEqual(await admin.$eval('#o-period', (s) => s.value), 'all');
  assert.strictEqual((await rows(admin)).length, 6);
  log('«гагарина» → «Нет заказов по выбранным условиям»; «Сбросить фильтры» → вид как при открытии');

  // ---- CSV по отбору ----
  await admin.selectOption('#o-period', 'month');
  await admin.fill('#o-search', 'ленина');
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('#o-export-btn')]);
  assert.strictEqual(dl.suggestedFilename(), 'zakazy-' + ymd(new Date(now.getFullYear(), now.getMonth(), 1)) + '_' + ymd(now) + '.csv');
  const csv = require('fs').readFileSync(await dl.path(), 'utf8').trim().split('\r\n');
  const expected = [o.s12, o.s8].filter((x) => new Date(x.createdAt) >= new Date(now.getFullYear(), now.getMonth(), 1)).length;
  assert.strictEqual(csv.length - 1, expected, 'в CSV только отобранные заказы');
  log('CSV: имя с периодом, строки только отобранных заказов');

  // ---- Переход между экранами и отмена заказа ----
  await admin.fill('#o-search', '');
  await admin.selectOption('#o-period', 'all');
  await admin.click('#o-client');
  await admin.fill('#o-client', 'стройинв');
  await admin.keyboard.press('Enter');
  await admin.goto(BASE + '/v2/#/clients');
  await admin.waitForSelector('#page-clients:not([hidden])');
  await admin.goto(BASE + '/v2/#/orders');
  await admin.waitForSelector('#o-client');
  assert.strictEqual(await admin.$eval('#o-client', (i) => i.value), 'СтройИнвест');
  assert.strictEqual((await rows(admin)).length, 2);
  const row = admin.locator('#o-list .row', { hasText: '8,0 м³' });
  await row.locator('.o-menu-btn').click();
  await Promise.all([admin.waitForResponse((x) => x.url().includes('/cancel')), admin.click('#o-shared-cancel')]);
  await admin.waitForFunction(() => /Отменён/.test(document.getElementById('o-list').innerText));
  assert.strictEqual(await admin.$eval('#o-client', (i) => i.value), 'СтройИнвест', 'выбор пережил State.loadAll');
  r = await rows(admin);
  assert.strictEqual(r.length, 2);
  assert.ok(r.some((x) => /Отменён/.test(x)), 'отменённый заказ остаётся в отборе');
  log('Выбор клиента держится при переходе на «Клиенты» и после отмены заказа; отменённый — в отборе');

  await admin.reload();
  await admin.waitForSelector('#o-client');
  assert.strictEqual(await admin.$eval('#o-client', (i) => i.value), '');
  assert.strictEqual(await admin.$eval('#o-period', (s) => s.value), 'all');
  log('Перезагрузка: фильтры по умолчанию');

  // ---- Работник по ссылке ----
  const token = (await post('/plants/' + p1.id + '/reissue-token', {})).accessToken;
  const worker = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  worker.on('pageerror', (e) => { console.log('   pageerror: ' + e.message); process.exitCode = 1; });
  await worker.goto(BASE + '/v2/?token=' + token + '#/orders');
  await worker.waitForSelector('#o-period');
  assert.ok(!(await worker.isVisible('#o-plant-filter')), 'у работника нет выбора завода');
  assert.strictEqual((await rows(worker)).length, 5, 'работник видит только 7 дней даже при «Всё время»');
  log('Работник по ссылке: фильтры есть, выбора завода нет, «Всё время» = свои 7 дней');

  // ---- Телефон ----
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto(BASE + '/v2/');
  await phone.fill('#login-password', ADMIN_PASSWORD);
  await phone.click('#login-form button[type=submit]');
  await phone.waitForSelector('#app-shell:not([hidden])');
  await phone.goto(BASE + '/v2/#/orders');
  await phone.waitForSelector('#mo-list');
  assert.deepStrictEqual(await phone.$$eval('.seg[aria-label="Фильтр"] button', (b) => b.map((x) => x.textContent)), ['7 дней', 'Ждут рейсов', 'Сегодня']);
  assert.strictEqual(await phone.$('#o-search'), null);
  assert.strictEqual(await phone.$('#o-client'), null);
  log('Телефон: сегменты как раньше, поиска и поля «Клиент» нет');

  await browser.close();
  console.log('Готово.');
})().catch((e) => { console.error(e); process.exit(1); });
