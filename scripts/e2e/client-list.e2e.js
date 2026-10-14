// Сквозной браузерный сценарий памяти клиента (change client-list, задача 7.4):
// manager/admin заводит клиента и цену по КП в CRM → работник на телефоне
// оформляет заказ за рецепт/объём/клиента (всё остальное подставилось) →
// перебивает цену → самовывоз → ограничение загрузки (4 × 5 м³) → ПК-форма →
// регресс (отчёт, отмена, «Без завода», удаление завода).
//
// НЕ входит в `npm test` (нужен браузер). Playwright — вне зависимостей
// проекта, ставится отдельно (см. registry.e2e.js):
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск — против сервера на ЧИСТОЙ базе (используются сид-данные: Завод 1,
// рецепт М200 по 6 800, миксер на 7 м³):
//   createdb calc_e2e_cl
//   DATABASE_URL=postgres://localhost:5432/calc_e2e_cl PORT=3101 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules E2E_BASE=http://127.0.0.1:3101 node scripts/e2e/client-list.e2e.js
// Если версия пакета playwright не совпадает со скачанным браузером — путь к
// уже установленному Chrome for Testing можно передать в E2E_CHROME.
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3101';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-cl-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });

const plain = (s) => (s || '').replace(/ | /g, ' ').trim();
let step = 0;
function log(msg) { console.log(String(++step).padStart(2, '0') + ' ✔ ' + msg); }

(async () => {
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});

  // ---- admin на ПК ----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await desk.newPage();
  await admin.goto(BASE + '/v2/');
  await admin.fill('#login-password', ADMIN_PASSWORD);
  await admin.click('#login-form button[type=submit]');
  await admin.waitForSelector('#app-shell:not([hidden])');
  const api = admin.request;
  const get = async (url) => (await api.get(BASE + '/api' + url)).json();

  const plants = await get('/plants');
  // У сид-завода на свежей базе токена ещё нет (seedIfEmpty идёт после
  // backfillAccessTokens) — выпускаем ссылку работника явно.
  const p1 = await (await api.post(BASE + '/api/plants/' + plants.find((p) => p.name === 'Завод 1').id + '/reissue-token')).json();
  assert.ok(p1.accessToken);
  const p2 = await (await api.post(BASE + '/api/plants', { data: { name: 'Теберда' } })).json();
  const recipe = (await get('/recipes')).find((r) => r.name === 'М200');
  const mixer = (await get('/mixers'))[0];
  assert.strictEqual(mixer.capacity, 7);
  // «Старый» клиент без завода — как после выкатки.
  const ivanov = await (await api.post(BASE + '/api/clients', { data: { name: 'Иванов И.' } })).json();
  assert.strictEqual(ivanov.plantId, null);
  log('Данные: Завод 1 (М200 6 800, миксер 7 м³), Теберда, Иванов И. без завода');

  // ---- CRM: новый клиент и цена по КП ----
  // Завод и клиент заведены через API после загрузки приложения — перечитываем.
  await admin.goto(BASE + '/v2/#/clients');
  await admin.reload();
  await admin.waitForSelector('#cl-plant-seg button');
  const segText = plain(await admin.textContent('#cl-plant-seg'));
  for (const part of ['Все · 1', 'Завод 1 · 0', 'Теберда · 0']) assert.ok(segText.includes(part), segText);
  assert.match(plain(await admin.textContent('#cl-groups')), /Без завода · 1.*разобрать.*Иванов И\..*Выбрать завод/);
  await admin.screenshot({ path: OUT + '01-clients-list-before.png' });
  await admin.click('#cl-add-btn');
  await admin.fill('#cl-f-name', 'ООО «СтройИнвест»');
  await admin.click('#cl-f-type-seg [data-type=legal]');
  await admin.click('#cl-f-plant-seg [data-plant="' + p1.id + '"]');
  await admin.click('#cl-f-vat-seg [data-vat="1"]');
  await admin.fill('#cl-f-address', 'пос. Северный');
  await admin.fill('#cl-f-dist', '30');
  await admin.fill('#cl-f-delivery', '700');
  await admin.fill('#cl-f-max-load', '5');
  await admin.click('#cl-f-nb-city');
  await admin.click('#cl-save-btn');
  await admin.waitForSelector('#cl-drawer-title:has-text("ООО «СтройИнвест»")');
  await admin.click('#cl-price-add-btn');
  await admin.fill('#cl-price-input', '6500');
  assert.strictEqual(plain(await admin.inputValue('#cl-price-gross')), '7 930');
  await admin.click('#cl-price-ok');
  await admin.waitForSelector('#cl-prices .cl-pr:has-text("М200")');
  const priceRowText = plain(await admin.textContent('#cl-prices'));
  assert.match(priceRowText, /М200\s*6 500,00\s*7 930,00/);
  assert.match(priceRowText, /CRM · admin/);
  await admin.screenshot({ path: OUT + '02-crm-card-price.png' });
  // Правка в обе стороны: знаем только цену с НДС — вводим её.
  await admin.click('#cl-prices [data-price-edit]');
  await admin.fill('#cl-price-gross', '10000');
  assert.strictEqual(plain(await admin.inputValue('#cl-price-input')), '8 196,72');
  await admin.click('#cl-price-ok');
  await admin.waitForSelector('#cl-prices .cl-pr:has-text("10 000,00")');
  assert.match(plain(await admin.textContent('#cl-prices')), /М200\s*8 196,72\s*10 000,00/);
  // Вернули 6 500 без НДС — дальше сценарий считает от неё.
  await admin.click('#cl-prices [data-price-edit]');
  await admin.fill('#cl-price-input', '6500');
  assert.strictEqual(plain(await admin.inputValue('#cl-price-gross')), '7 930');
  await admin.click('#cl-price-ok');
  await admin.waitForSelector('#cl-prices .cl-pr:has-text("7 930,00")');
  let si = (await get('/clients')).find((c) => c.name === 'ООО «СтройИнвест»');
  assert.strictEqual(si.plantId, p1.id);
  assert.strictEqual(si.vatGross, true);
  assert.strictEqual(si.maxLoadM3, 5);
  assert.strictEqual(si.siteNeighborCity, true);
  log('CRM: клиент Завода 1 с объектом, НДС, загрузкой 5 м³; цена М200 правится в обе стороны (10 000 с НДС → 8 196,72), итог 6 500 / 7 930');

  // ---- работник на телефоне ----
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(BASE + '/v2/?token=' + p1.accessToken);
  await phone.waitForSelector('#mc-client option', { state: 'attached' });

  async function fillBase(volume) {
    await phone.selectOption('#mc-recipe', recipe.id);
    await phone.fill('#mc-volume', String(volume));
  }
  async function pickClient(label) {
    await phone.selectOption('#mc-client', { label });
  }
  async function placeOrder() {
    const [resp] = await Promise.all([
      phone.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST'),
      phone.click('#mc-place-order-btn')
    ]);
    assert.strictEqual(resp.status(), 201, await resp.text());
    await phone.waitForFunction(() => document.getElementById('mc-client').value === '');
    return resp.json();
  }

  const clientOptions = await phone.$$eval('#mc-client option', (os) => os.map((o) => o.textContent));
  assert.ok(clientOptions.includes('ООО «СтройИнвест» (юрлицо)'));
  assert.ok(clientOptions.includes('Иванов И.'), 'клиент без завода виден');

  await fillBase(20);
  await pickClient('ООО «СтройИнвест» (юрлицо)');
  assert.ok(await phone.$eval('#mc-vat-on', (b) => b.classList.contains('on')), 'режим «с НДС»');
  assert.strictEqual(plain(await phone.inputValue('#mc-price')), '7 930');
  assert.strictEqual(await phone.inputValue('#mc-address'), 'пос. Северный');
  assert.strictEqual(plain(await phone.inputValue('#mc-dist')), '30');
  assert.strictEqual(plain(await phone.inputValue('#mc-delivery-charge')), '700');
  assert.strictEqual(plain(await phone.inputValue('#mc-max-load')), '5');
  assert.ok(await phone.isChecked('#mc-nb-city'));
  assert.match(plain(await phone.textContent('#mc-price-hint')), /^Цена клиента 7 930 ₽ от \d\d\.\d\d · прайс 8 296 ₽$/);
  // Миксер у клиента ещё не запомнен — выбирает оператор.
  await phone.selectOption('#mc-mixer', mixer.id);
  assert.strictEqual(plain(await phone.textContent('#mc-max-load-hint')), 'рейсов: 4 вместо 3');
  assert.strictEqual(plain(await phone.textContent('#mc-delivery-summary-label')), 'Доставка · 4 × 5 м³ · 30 км');
  await phone.screenshot({ path: OUT + '03-phone-prefilled.png', fullPage: true });
  const o1 = await placeOrder();
  assert.strictEqual(o1.tripCount, 4);
  assert.strictEqual(o1.maxLoadM3, 5);
  assert.strictEqual(Math.round(o1.salePrice), 6500);
  si = (await get('/clients')).find((c) => c.id === si.id);
  assert.strictEqual(si.mixerId, mixer.id);
  assert.strictEqual(si.prices[0].source, 'order');
  log('Телефон: рецепт + объём + клиент → цена 7 930, объект, 30 км, 700 ₽/м³, «4 × 5 м³»; заказ 4 рейса, загрузка 5');

  // Оператор перебивает цену — новое значение в памяти.
  await fillBase(10);
  await pickClient('ООО «СтройИнвест» (юрлицо)');
  assert.strictEqual(await phone.inputValue('#mc-mixer'), mixer.id, 'миксер подставился из памяти');
  await phone.fill('#mc-price', '7320');
  await placeOrder();
  si = (await get('/clients')).find((c) => c.id === si.id);
  assert.strictEqual(Math.round(si.prices[0].priceNet), 6000);
  assert.strictEqual(si.prices[0].sourceLabel, 'Заказ · Завод 1');
  log('Перебили цену 7 320 с НДС → в памяти 6 000 без НДС, источник «Заказ · Завод 1»');

  // Ввод без оформления память не меняет.
  await fillBase(10);
  await pickClient('ООО «СтройИнвест» (юрлицо)');
  assert.strictEqual(plain(await phone.inputValue('#mc-price')), '7 320');
  await phone.fill('#mc-price', '1000');
  await phone.reload();
  await phone.waitForSelector('#mc-client option', { state: 'attached' });
  si = (await get('/clients')).find((c) => c.id === si.id);
  assert.strictEqual(Math.round(si.prices[0].priceNet), 6000);
  log('Ввели 1 000 и ушли без оформления — в памяти по-прежнему 6 000');

  // Разовый самовывоз — объект и загрузка остаются.
  await fillBase(8);
  await pickClient('ООО «СтройИнвест» (юрлицо)');
  await phone.click('#mc-self-pickup');
  await placeOrder();
  si = (await get('/clients')).find((c) => c.id === si.id);
  assert.strictEqual(si.selfPickup, true);
  assert.strictEqual(si.siteAddress, 'пос. Северный');
  assert.strictEqual(si.maxLoadM3, 5);
  await fillBase(8);
  await pickClient('ООО «СтройИнвест» (юрлицо)');
  assert.ok(await phone.$eval('#mc-self-pickup', (b) => b.classList.contains('on')), 'самовывоз подставился');
  log('Самовывоз: в памяти включён, объект «пос. Северный» и загрузка 5 м³ на месте');

  // Снова доставка, загрузку вернули к вместимости — ограничение снимается.
  await phone.click('#mc-self-pickup');
  await phone.fill('#mc-address', 'пос. Северный');
  await phone.fill('#mc-dist', '30');
  await phone.fill('#mc-max-load', '7');
  assert.strictEqual(plain(await phone.textContent('#mc-max-load-hint')), 'вместимость миксера 7 м³');
  const o4 = await placeOrder();
  assert.strictEqual(o4.maxLoadM3, null);
  assert.strictEqual(o4.tripCount, 2);
  si = (await get('/clients')).find((c) => c.id === si.id);
  assert.strictEqual(si.maxLoadM3, null);
  assert.strictEqual(si.selfPickup, false);
  log('Загрузку вернули к вместимости (7) → 2 рейса, ограничение у клиента снято');

  // Новый клиент из формы получает завод из ссылки.
  await fillBase(5);
  await phone.selectOption('#mc-client', '__new__');
  await phone.fill('#mc-client-new-name', 'Петров П.');
  await phone.selectOption('#mc-mixer', mixer.id);
  await phone.fill('#mc-address', 'ул. Ленина, 5');
  await phone.fill('#mc-dist', '12');
  await placeOrder();
  const petrov = (await get('/clients')).find((c) => c.name === 'Петров П.');
  assert.strictEqual(petrov.plantId, p1.id);
  log('Новый клиент из формы «Петров П.» — завод из ссылки (Завод 1), память записана заказом');

  // Разовые покупатели: «Физлицо» на обоих заводах, без памяти.
  const fiz = await (await api.post(BASE + '/api/clients', { data: { name: 'Физлицо' } })).json();
  await api.put(BASE + '/api/clients/' + fiz.id, { data: { name: 'Физлицо', type: 'individual', walkIn: true } });
  await phone.reload();
  await phone.waitForSelector('#mc-client option', { state: 'attached' });
  await fillBase(6);
  await phone.selectOption('#mc-client', { label: 'Физлицо' });
  assert.match(plain(await phone.textContent('#mc-price-hint')), /^По прайсу рецепта/);
  await phone.selectOption('#mc-mixer', mixer.id);
  await phone.fill('#mc-address', 'ул. Мира, 1');
  await phone.fill('#mc-dist', '8');
  await placeOrder();
  const fizAfter = (await get('/clients')).find((c) => c.id === fiz.id);
  assert.strictEqual(fizAfter.plantId, null);
  assert.deepStrictEqual(fizAfter.prices, []);
  assert.strictEqual(fizAfter.siteAddress, '');
  log('Разовые покупатели «Физлицо»: заказ не привязал завод и не записал память');

  // ---- ПК-форма admin ----
  await admin.goto(BASE + '/v2/#/main');
  await admin.reload(); // заказы с телефона пришли после загрузки этой вкладки
  await admin.waitForSelector('#m-client option', { state: 'attached' });
  await admin.selectOption('#m-recipe', recipe.id);
  await admin.fill('#m-volume', '20');
  await admin.selectOption('#m-client', { label: 'ООО «СтройИнвест» (юрлицо)' });
  assert.match(plain(await admin.textContent('#m-client-price-hint')), /^Цена клиента 7 320 ₽ от \d\d\.\d\d\.\d{4} · прайс 8 296 ₽$/);
  assert.strictEqual(plain(await admin.inputValue('#m-price')), '7 320');
  assert.strictEqual(plain(await admin.inputValue('#m-max-load')), '7');
  await admin.fill('#m-max-load', '5');
  assert.strictEqual(plain(await admin.textContent('#m-trip-count')), '4 × 5 м³');
  await admin.screenshot({ path: OUT + '04-desktop-form.png' });
  log('ПК: подсказка «Цена клиента 7 320 ₽ от …», загрузка 5 → «Рейсов: 4 × 5 м³»');

  // ---- регресс ----
  await api.post(BASE + '/api/orders/' + o1.id + '/cancel');
  si = (await get('/clients')).find((c) => c.id === si.id);
  assert.strictEqual(Math.round(si.prices[0].priceNet), 6000);
  log('Отмена заказа память не откатывает');

  await admin.goto(BASE + '/v2/#/clients');
  await admin.reload(); // отмена прошла через API — перечитываем заказы
  await admin.waitForSelector('#cl-groups [data-client-id]');
  const list = plain(await admin.textContent('#cl-groups'));
  assert.match(list, /Разовые покупатели · 1.*Физлицо\s*без памяти, на всех заводах/);
  assert.match(list, /Завод 1 · 2/);
  assert.match(list, /ООО «СтройИнвест»\s*пос\. Северный · 30 км/);
  // Отменённый заказ не считается: 4 оформленных − 1 отменён = 3.
  const siRow = plain(await admin.textContent('#cl-groups [data-client-id="' + si.id + '"]'));
  assert.match(siRow, /Юрлицо\s*3\s*/);
  await admin.click('[data-pick-plant="' + ivanov.id + '"]');
  await admin.click('#cl-f-plant-seg [data-plant="' + p2.id + '"]');
  await admin.click('#cl-save-btn');
  await admin.waitForFunction(() => !document.querySelector('[data-pick-plant]'));
  assert.match(plain(await admin.textContent('#cl-plant-seg')), /Теберда · 1/);
  await admin.screenshot({ path: OUT + '05-clients-list-after.png' });
  const del = await api.delete(BASE + '/api/plants/' + p2.id);
  assert.strictEqual(del.status(), 409);
  log('Отчёт: группы по заводам, объект в строке, «Выбрать завод» → Теберда; завод с клиентом не удаляется (409)');

  // Работник Завода 1 больше не видит Иванова (он на Теберде).
  await phone.reload();
  await phone.waitForSelector('#mc-client option', { state: 'attached' });
  const after = await phone.$$eval('#mc-client option', (os) => os.map((o) => o.textContent));
  assert.ok(!after.includes('Иванов И.'));
  log('Форма Завода 1 больше не показывает клиента Теберды');

  await browser.close();
  console.log('\nВсё прошло. Скриншоты: ' + OUT);
})().catch((err) => { console.error(err); process.exit(1); });
