// Сквозной браузерный сценарий реестра оплат (change reestr-oplat, задача 12.2):
// admin заводит справочники и заявки с файлами, решение, оплаты, переплату,
// экспорт; учредитель по ссылке на телефоне — список, фото, решение из списка,
// карточка по номеру, неверная ссылка; admin на телефоне.
//
// НЕ входит в `npm test` (нужен браузер). Playwright — вне зависимостей
// проекта (проект без сборки и dev-зависимостей), ставится отдельно:
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск — против сервера на ЧИСТОЙ базе (сценарий создаёт справочники):
//   createdb calc_e2e
//   DATABASE_URL=postgres://localhost:5432/calc_e2e PORT=3100 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules E2E_BASE=http://127.0.0.1:3100 node scripts/e2e/registry.e2e.js
// Скриншоты и выгруженный Excel — в E2E_OUT (по умолчанию временный каталог).
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3100';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin'; // пароль из seedIfEmpty()
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });

// Тестовые файлы: минимальный PDF и PNG 400×300.
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9c)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PDF_FILE = OUT + 'invoice.pdf';
const PNG_FILE = OUT + 'scan.png';
fs.writeFileSync(PDF_FILE, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
fs.writeFileSync(PNG_FILE, png(400, 300));
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', async (d) => { console.log('dialog:', d.message().slice(0, 80)); await d.accept(d.type() === 'prompt' ? 'Тест причина' : undefined); });

  await page.goto(BASE + '/v2/');
  await page.fill('#login-password', ADMIN_PASSWORD);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#app-shell:not([hidden])');

  // Настройки → справочники
  await page.goto(BASE + '/v2/#/settings');
  await page.waitForSelector('#s-rg-owner-link');
  await page.waitForFunction(() => document.getElementById('s-rg-owner-link').value.includes('owner='));
  const ownerLink = await page.inputValue('#s-rg-owner-link');
  for (const [kind, names] of [['categories', ['Материалы', 'Запчасти']], ['units', ['Стройка', 'Джага']]]) {
    for (const n of names) {
      await page.fill(`[data-dict="${kind}"] .s-rg-add input`, n);
      await page.click(`[data-dict="${kind}"] .s-rg-add button`);
      await page.waitForSelector(`[data-dict="${kind}"] .s-rg-item:has-text("${n}")`);
    }
  }
  await page.locator('#s-registry').screenshot({ path: OUT + '1-settings.png' });

  // Реестр → новая заявка
  await page.goto(BASE + '/v2/#/registry');
  await page.waitForSelector('#rg-add-btn');
  await page.click('#rg-add-btn');
  await page.selectOption('#rg-i-unit', { label: 'Стройка' });
  await page.selectOption('#rg-i-category', { label: 'Материалы' });
  await page.fill('#rg-i-applicant', 'Руслан');
  await page.fill('#rg-i-recipient', 'ООО "ПРОМХИМ"');
  await page.fill('#rg-i-basis', 'Счёт № 14893 от 12.10.2026');
  await page.fill('#rg-i-amount', '63800');
  await page.fill('#rg-i-purpose', 'Фанера 18мм 2440x1220 F/F');
  await page.setInputFiles('#rg-file-input', [PDF_FILE, PNG_FILE]);
  await page.screenshot({ path: OUT + '2-new.png' });
  await page.click('#rg-create-btn');
  await page.waitForSelector('#rg-dec-save', { timeout: 15000 });
  await page.screenshot({ path: OUT + '3-card.png' });
  const fileCount = await page.locator('.rg-file').count();
  console.log('files in card:', fileCount);

  // одобрить часть
  await page.fill('#rg-dec-amount', '50000');
  await page.click('#rg-dec-save');
  // оплата — только после «Платёжка готова» (change reestr-payment-order)
  await page.click('#rg-po-mark');
  await page.waitForSelector('#rg-pay-form');
  await page.fill('#rg-pay-amount', '20000');
  await page.click('#rg-pay-form button[type=submit]');
  await page.waitForSelector('.rg-pay');
  await page.click('#rg-po-mark');
  await page.waitForSelector('#rg-pay-form');
  // переплата
  await page.fill('#rg-pay-amount', '40000');
  await page.click('#rg-pay-form button[type=submit]');
  await page.waitForSelector('#rg-pay-error:not([hidden])');
  console.log('overpay error:', await page.textContent('#rg-pay-error'));
  await page.screenshot({ path: OUT + '4-card-paid.png' });
  await page.click('#rg-close');

  // вторая заявка — для учредителя
  await page.click('#rg-add-btn');
  await page.selectOption('#rg-i-unit', { label: 'Джага' });
  await page.selectOption('#rg-i-category', { label: 'Запчасти' });
  await page.fill('#rg-i-recipient', 'ООО «АвтоДеталь»');
  await page.fill('#rg-i-amount', '38600');
  await page.fill('#rg-i-purpose', 'Фильтры и масло');
  await page.fill('#rg-i-due', '2026-10-10');
  await page.setInputFiles('#rg-file-input', [PNG_FILE]);
  await page.click('#rg-create-btn');
  await page.waitForSelector('#rg-dec-save', { timeout: 15000 });
  await page.click('#rg-close');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '5-list.png' });
  const tiles = await page.locator('#rg-tiles').innerText();
  console.log('tiles:', tiles.replace(/\n/g, ' | '));

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rg-export-btn')]);
  await dl.saveAs(OUT + 'export.xlsx');
  console.log('export:', dl.suggestedFilename());

  // учредитель на телефоне
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const op = await phone.newPage();
  op.on('pageerror', (e) => errors.push('owner pageerror: ' + e.message));
  op.on('console', (m) => { if (m.type() === 'error') errors.push('owner console: ' + m.text()); });
  op.on('dialog', async (d) => { await d.accept(d.type() === 'prompt' ? '' : undefined); });
  await op.goto(ownerLink);
  await op.waitForSelector('.rgm-card');
  await op.screenshot({ path: OUT + '6-owner-list.png', fullPage: true });
  console.log('sidebar visible for owner:', await op.locator('.sidebar').isVisible());
  // фото на весь экран
  await op.locator('.rgm-card .rg-thumb[data-photo]').first().click();
  await op.waitForSelector('#rg-photo:not([hidden])');
  await op.screenshot({ path: OUT + '7-owner-photo.png' });
  await op.click('.rg-photo-close');
  // одобрить из списка
  await op.locator('.rgm-card [data-act="approved"]').first().click();
  await op.waitForTimeout(500);
  console.log('owner after approve, pending buttons left:', await op.locator('[data-act="approved"]').count());
  // карточка по номеру
  const num = await op.locator('.rgm-card').first().getAttribute('data-number');
  await op.goto(ownerLink + '#/registry/' + num);
  await op.waitForSelector('#rgm-dec-amount');
  await op.screenshot({ path: OUT + '8-owner-card.png', fullPage: true });
  console.log('owner sees pay form:', await op.locator('#rgm-pay-form').count());
  // неверная ссылка
  await op.goto(BASE + '/v2/?owner=bad');
  await op.waitForSelector('#load-error:not([hidden])');
  console.log('bad link:', await op.textContent('#load-error'));

  // admin на телефоне
  const ap = await phone.newPage();
  await phone.addCookies(await ctx.cookies());
  await ap.goto(BASE + '/v2/#/registry');
  await ap.waitForSelector('.rgm-card');
  await ap.screenshot({ path: OUT + '9-admin-phone.png' });

  // 409 (переплата) и 401 (неверная ссылка) — ожидаемые ответы сценария.
  const unexpected = errors.filter((e) => !/status of (409|401)/.test(e));
  console.log('Скриншоты и Excel: ' + OUT);
  console.log('Неожиданные ошибки:', unexpected.length ? unexpected.join('\n') : 'нет');
  if (unexpected.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
