// Сквозной сценарий автозаполнения заявки из счёта (change reestr-autofill,
// задачи 5.1–5.4 и 6.2; спека payment-registry/autofill).
//
// Нужны реальные счета вне репозитория — каталог E2E_INVOICES_DIR с тремя
// файлами, имена которых содержат: «likard» или «ЛИКАРД» (PDF с текстом и QR),
// «ip» (скан в PDF с QR), «ФОРА» или «fora» (фото без QR). Остальное
// (чужой покупатель, пустая картинка, пачка из 25) сценарий создаёт сам.
//
// Как и registry.e2e.js — НЕ часть `npm test`, Playwright вне зависимостей:
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск против сервера на ЧИСТОЙ базе:
//   createdb calc_e2e && DATABASE_URL=postgres://localhost:5432/calc_e2e PORT=3100 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules E2E_INVOICES_DIR=~/Documents/invoices-samples \
//     node scripts/e2e/registry-autofill.e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3100';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';
const DIR = process.env.E2E_INVOICES_DIR;
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-autofill-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });
if (!DIR) { console.error('Укажите E2E_INVOICES_DIR — каталог с реальными счетами (вне репозитория)'); process.exit(2); }

const real = fs.readdirSync(DIR).map((f) => path.join(DIR, f));
const pick = (re) => { const f = real.find((x) => re.test(path.basename(x))); assert(f, 'нет файла по шаблону ' + re); return f; };
const LIKARD = pick(/likard|ликард/i);
const IP = pick(/^ip|ip-/i);
const FORA = pick(/fora|фора/i);

let step = 0;
const ok = (msg) => console.log(String(++step).padStart(2) + '. ✓ ' + msg);

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // --- синтетические файлы ---
  const gen = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await gen.setContent('<style>body{font:14px Arial;margin:40px}</style><h2>Счет на оплату № 777 от 20.10.2026</h2>' +
    '<p>Поставщик: ООО "Тест-Снаб", ИНН 7700000001</p><p>Покупатель: ООО "Ромашка", ИНН 7700000000</p>' +
    '<p>№ Наименование Кол-во Цена Сумма</p><p>1 Цемент М500 10 т 5 000,00 50 000,00</p><p>Итого: 50 000,00</p><p>Всего к оплате: 50 000,00</p>');
  const OTHER = OUT + 'other-buyer.pdf';
  await gen.pdf({ path: OTHER, format: 'A4' });
  await gen.setContent('<body style="margin:0;background:#fff;width:600px;height:800px"></body>');
  const BLANK = OUT + 'blank.png';
  await gen.screenshot({ path: BLANK, clip: { x: 0, y: 0, width: 600, height: 800 } });
  const NOTES = OUT + 'notes.txt';
  fs.writeFileSync(NOTES, 'не счёт');
  await gen.close();

  // --- учредитель и телефон: зоны нет (спека «Учредитель и телефон») ---
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await admin.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.goto(BASE + '/v2/');
  await p.fill('#login-password', ADMIN_PASSWORD);
  await p.click('#login-form button[type=submit]');
  await p.waitForSelector('#app-shell:not([hidden])');
  const api = (method, url, body) => p.evaluate(async ([m, u, b]) => {
    const r = await fetch('/api/registry' + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [method, url, body]);

  const jag = await api('POST', '/units', { name: 'Джага' });
  const teb = await api('POST', '/units', { name: 'Теберда' });
  const fuel = await api('POST', '/categories', { name: 'Топливо' });
  const raw = await api('POST', '/categories', { name: 'Сырьё' });
  // История: ЛИКАРД → Джага/Топливо/Руслан; ФОРА № 531 уже заведён (дубль).
  await api('POST', '/requests', { unitId: jag.id, categoryId: fuel.id, recipient: 'ООО «ЛУКОЙЛ-Интер-Кард»', recipientInn: '3444197347', applicant: 'Руслан', purpose: 'Топливо', amount: 1000 });
  const dup = await api('POST', '/requests', { unitId: teb.id, categoryId: raw.id, recipient: 'ООО «ФОРА»', recipientInn: '0916011226', basis: 'Счёт № 531 от 22.10.2026', purpose: 'ТКСО', amount: 95450 });
  const owner = (await api('GET', '/settings')).ownerToken;

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const op = await phone.newPage();
  await op.goto(BASE + '/v2/?owner=' + owner);
  await op.waitForSelector('.rgm-card');
  assert.strictEqual(await op.locator('#rg-autodrop').count(), 0);
  await phone.addCookies(await admin.cookies());
  const ap = await phone.newPage();
  await ap.goto(BASE + '/v2/#/registry');
  await ap.waitForSelector('.rgm-card');
  assert.strictEqual(await ap.locator('#rg-autodrop:visible').count(), 0);
  ok('у учредителя и у admin на телефоне зоны «Перетащите счета» нет');

  // --- ленивые библиотеки ---
  const vendor = [];
  p.on('response', (r) => { if (r.url().includes('/vendor/')) vendor.push({ url: r.url(), status: r.status(), cached: r.fromServiceWorker() }); });
  const posts = [];
  p.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/')) posts.push(r.url().replace(BASE, '')); });
  await p.goto(BASE + '/v2/#/registry');
  await p.waitForSelector('#rg-autodrop');
  assert.strictEqual(vendor.length, 0, 'vendor/ не должен грузиться при открытии реестра');
  ok('при открытии реестра к vendor/ нет ни одного запроса');

  // --- пачка ---
  const t0 = Date.now();
  await p.setInputFiles('#rg-autodrop-input', [LIKARD, IP, FORA, OTHER, BLANK, NOTES]);
  await p.waitForSelector('#ra-overlay');
  await p.waitForSelector('#ra-form-el', { timeout: 120000 });
  ok('первый готовый счёт открылся на экране проверки через ' + Math.round((Date.now() - t0) / 1000) + ' с');
  await p.waitForFunction(() => RegistryAutofill.debugState().every((x) => x.status === 'ready' || x.status === 'error'), null, { timeout: 240000 });
  assert.ok(vendor.length > 0);
  const st = Object.fromEntries((await p.evaluate(() => RegistryAutofill.debugState())).map((x) => [x.name, x]));
  const name = (f) => path.basename(f);
  assert.strictEqual(st['notes.txt'].status, 'error');
  assert.match(st['notes.txt'].error, /не PDF и не фото/);
  ok('файл .txt — статус «ошибка · не PDF и не фото», остальные распознаны');
  assert.strictEqual(posts.length, 0, 'до «Создать» не должно быть запросов, меняющих данные: ' + posts.join(', '));
  ok('до «Создать» на сервер не ушло ни одного POST/PUT — содержимое файлов не передавалось');

  const L = st[name(LIKARD)];
  assert.ok(L.debug.qr && L.debug.pdfText && !L.debug.ocr, 'ЛИКАРД: QR + текст PDF, без OCR');
  assert.strictEqual(L.fields.amount, 140000);
  assert.strictEqual(L.fields.recipientInn, '3444197347');
  const I = st[name(IP)];
  assert.ok(I.debug.qr && I.debug.ocr, 'ИП: QR найден и запущен OCR');
  assert.strictEqual(I.fields.amount, 3500000);
  const F = st[name(FORA)];
  assert.ok(!F.debug.qr && F.debug.ocr, 'ФОРА: без QR, из OCR');
  assert.strictEqual(F.fields.amount, 95450);
  assert.strictEqual(F.fields.dueDate, '2026-10-27');
  assert.strictEqual(F.fields.invoiceNumber, '531');
  ok('источники: ЛИКАРД — QR+текст без OCR, ИП — QR+OCR, ФОРА — OCR; суммы и срок верны');

  const open = async (f) => {
    await p.click('.ra-tile[data-id] .ra-tile-main:has-text("' + name(f) + '")');
    await p.waitForFunction((n) => document.querySelector('.ra-tile.on') && document.querySelector('.ra-tile.on').textContent.includes(n), name(f));
  };

  // ЛИКАРД: подстановка по истории
  await open(LIKARD);
  assert.strictEqual(await p.inputValue('#ra-unit'), jag.id);
  assert.strictEqual(await p.inputValue('#ra-category'), fuel.id);
  assert.strictEqual(await p.inputValue('#ra-applicant'), 'Руслан');
  assert.strictEqual(await p.locator('[data-field="unit"] .ra-note:has-text("как в прошлой заявке")').count(), 1);
  await p.screenshot({ path: OUT + 'review-likard.png' });
  ok('постоянный поставщик: подставлены Джага / Топливо / Руслан с пометкой «как в прошлой заявке»');

  // ФОРА: дубль и подсветка OCR
  await open(FORA);
  assert.match(await p.textContent('#ra-form'), new RegExp('Этот счёт уже заведён: ' + dup.number));
  assert.strictEqual(await p.locator('[data-field="amount"].rg-flag').count(), 1);
  await p.screenshot({ path: OUT + 'review-fora.png' });
  ok('ФОРА: предупреждение «Этот счёт уже заведён: ' + dup.number + '», сумма из OCR подсвечена');

  // Чужой покупатель
  await open(OTHER);
  assert.match(await p.textContent('#ra-form'), /Счёт выставлен не на АДАТ ГРУПП/);
  ok('чужой покупатель: предупреждение «Счёт выставлен не на АДАТ ГРУПП»');

  // Ошибка создания: новый поставщик без категории
  assert.strictEqual(await p.inputValue('#ra-category'), '');
  await p.selectOption('#ra-unit', teb.id);
  await p.fill('#ra-applicant', 'Тест');
  await p.click('[data-act="create"]');
  await p.waitForSelector('#ra-error:not([hidden])');
  assert.match(await p.textContent('#ra-error'), /Категория/);
  assert.strictEqual(await p.inputValue('#ra-applicant'), 'Тест');
  ok('ошибка создания (нет категории): текст ошибки у формы, введённое не потерялось');
  await p.selectOption('#ra-category', raw.id);
  await p.click('[data-act="create"]');
  await p.waitForFunction(() => RegistryAutofill.debugState().some((x) => x.name === 'other-buyer.pdf' && x.status === 'created'));
  ok('«Создать и дальше» после исправления — заявка создана, открыт следующий готовый');

  // Пустая картинка — «Не удалось распознать», убрать
  await open(BLANK);
  assert.match(await p.textContent('#ra-form'), /Не удалось распознать — заполните по счёту/);
  await p.click('[data-act="remove"]');
  assert.ok(!(await p.evaluate(() => RegistryAutofill.debugState().some((x) => x.name === 'blank.png'))));
  ok('пустая картинка: «Не удалось распознать — заполните по счёту», «Убрать» исключает файл');

  // Закрыть посреди пачки — подтверждение (отказ — остаёмся)
  let dialogs = 0;
  p.once('dialog', async (d) => { dialogs++; await d.dismiss(); });
  await p.click('#ra-close');
  assert.strictEqual(dialogs, 1);
  assert.ok(await p.locator('#ra-overlay').count());
  ok('закрытие с несозданными файлами — просит подтверждение, отказ оставляет экран');

  // Создать оставшиеся: ЛИКАРД, ИП, ФОРА (ИП — категории нет в истории)
  for (const f of [LIKARD, IP, FORA]) {
    await open(f);
    if (!(await p.inputValue('#ra-unit'))) await p.selectOption('#ra-unit', jag.id);
    if (!(await p.inputValue('#ra-category'))) await p.selectOption('#ra-category', fuel.id);
    await p.click('[data-act="create"]');
    await p.waitForFunction((n) => RegistryAutofill.debugState().some((x) => x.name === n && x.status === 'created'), name(f), { timeout: 30000 });
  }
  // осталась ошибка .txt — ✕ в полоске, после этого экран закрывается сам
  await p.click('.ra-tile.error [data-act="drop"]');
  await p.waitForSelector('#ra-overlay', { state: 'detached', timeout: 10000 });
  ok('конец пачки: после последнего файла экран закрылся сам');
  // Регресс бага «JPEG не прикрепился»: экран закрывался и перерисовывал
  // список раньше, чем догружался файл последнего счёта (фото ФОРЫ).
  const foraRow = p.locator('.rg-row', { hasText: 'ФОРА' }).first();
  await foraRow.waitFor();
  assert.strictEqual(await foraRow.locator('.rg-filecount').textContent(), '1', 'у последнего созданного (JPEG) в списке сразу должен быть файл');
  ok('файл последнего счёта пачки (JPEG) виден в списке сразу после закрытия экрана');

  const list = await api('GET', '/requests?closed=all');
  const byInn = (inn) => list.items.filter((x) => x.recipientInn === inn).sort((a, b) => b.seq - a.seq)[0];
  const likard = byInn('3444197347');
  assert.strictEqual(likard.invoiceNumber, 'RU203023711-1792739333');
  assert.strictEqual(likard.amount, 140000);
  assert.strictEqual(likard.files.length, 1);
  assert.strictEqual(likard.files[0].kind, 'invoice');
  assert.match(likard.number, /^\d{6}-\d+$/);
  const fora = byInn('0916011226');
  assert.strictEqual(fora.invoiceNumber, '531');
  assert.strictEqual(fora.dueDate, '2026-10-27');
  assert.strictEqual(byInn('260612345678').amount, 3500000);
  ok('в реестре 4 новые заявки с ИНН, № счёта, суммой и файлом «Счёт», номер вида DDMMYY-N');

  // Больше 20 файлов
  const many = Array.from({ length: 25 }, (_, i) => { const f = OUT + 'copy-' + i + '.png'; fs.copyFileSync(BLANK, f); return f; });
  await p.setInputFiles('#rg-autodrop-input', many);
  await p.waitForSelector('#ra-flash:not([hidden])');
  assert.match(await p.textContent('#ra-flash'), /не больше 20 файлов/);
  assert.strictEqual(await p.locator('.ra-tile').count(), 20);
  ok('25 файлов — в очередь встали 20, показано сообщение о лимите');
  p.once('dialog', (d) => d.accept());
  await p.click('#ra-close');
  await p.waitForSelector('#ra-overlay', { state: 'detached' });

  // Кэш библиотек после перезагрузки — в постоянном профиле, как у обычного
  // Chrome. Меряем байты, реально полученные по сети (CDP encodedDataLength):
  // статус в протоколе после перепроверки кэша бывает 200 и ничего не
  // говорит. Ожидание: первый раз — мегабайты, второй — только заголовки 304.
  const profile = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-profile-')), { viewport: { width: 1440, height: 900 } });
  const pp = profile.pages()[0] || await profile.newPage();
  pp.on('dialog', (d) => d.accept());
  const cdp = await profile.newCDPSession(pp);
  await cdp.send('Network.enable');
  const vendorIds = new Set();
  let netBytes = 0;
  cdp.on('Network.responseReceived', (e) => { if (e.response.url.includes('/vendor/')) vendorIds.add(e.requestId); });
  cdp.on('Network.loadingFinished', (e) => { if (vendorIds.has(e.requestId)) netBytes += e.encodedDataLength; });
  await pp.goto(BASE + '/v2/');
  await pp.fill('#login-password', ADMIN_PASSWORD);
  await pp.click('#login-form button[type=submit]');
  await pp.waitForSelector('#app-shell:not([hidden])');
  const throwOnce = async () => {
    await pp.waitForSelector('#rg-autodrop');
    await pp.setInputFiles('#rg-autodrop-input', [BLANK]);
    await pp.waitForSelector('#ra-form-el', { timeout: 60000 });
    await pp.waitForTimeout(800);
  };
  await pp.goto(BASE + '/v2/#/registry');
  await throwOnce();
  const firstKb = Math.round(netBytes / 1024);
  netBytes = 0;
  await pp.reload();
  await throwOnce();
  const secondKb = Math.round(netBytes / 1024);
  assert.ok(firstKb > 100, 'первый бросок должен загрузить библиотеки страницы');
  assert.ok(secondKb < 20, 'повторно по сети ушло ' + secondKb + ' КБ');
  ok('библиотеки кэшируются: первый бросок — ' + firstKb + ' КБ по сети, после перезагрузки — ' + secondKb + ' КБ');
  await profile.close();

  const unexpected = errors.filter((e) => !/status of (400|409)/.test(e));
  console.log('Скриншоты: ' + OUT);
  console.log('Неожиданные ошибки:', unexpected.length ? unexpected.join('\n') : 'нет');
  await browser.close();
  if (unexpected.length) process.exitCode = 1;
})().catch((e) => { console.error('FAILED на шаге ' + (step + 1) + ':', e.message); process.exit(1); });
