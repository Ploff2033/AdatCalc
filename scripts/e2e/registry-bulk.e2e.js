// Сквозной сценарий пакетного решения (change reestr-bulk, задачи 3.1–3.2 и
// 4.2; спека payment-registry/bulk-decision). Учредитель на телефоне,
// admin на телефоне и на ПК.
//
// Как и остальные e2e — НЕ часть `npm test`, Playwright вне зависимостей:
//   npm i --prefix ~/.cache/calc-e2e playwright@1
//   npx --prefix ~/.cache/calc-e2e playwright install chromium
// Запуск против сервера на ЧИСТОЙ базе:
//   createdb calc_e2e && DATABASE_URL=postgres://localhost:5432/calc_e2e PORT=3100 node server.js
//   NODE_PATH=~/.cache/calc-e2e/node_modules node scripts/e2e/registry-bulk.e2e.js
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3100';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'AdatBetonAdmin';
const OUT = (process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'calc-e2e-bulk-'))) + '/';
fs.mkdirSync(OUT, { recursive: true });

let step = 0;
const ok = (msg) => console.log(String(++step).padStart(2) + '. ✓ ' + msg);

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
  const r1 = await mk('ООО «ФОРА»', 95450);
  const r2 = await mk('ООО «ЛУКОЙЛ-Интер-Кард»', 140000);
  const r3 = await mk('ООО «ЮгСнаб»', 284550);
  const r4 = await mk('ИП Иванов И. И.', 10000);
  const r5 = await mk('ООО «Ромашка»', 7000);
  const post = await mk('ООО «ТехноСвет»', 52000);
  await api('POST', '/requests/' + post.id + '/decision', { decision: 'postponed' });
  const appr = await mk('ООО «Одобренный»', 1000);
  await api('POST', '/requests/' + appr.id + '/decision', { decision: 'approved' });
  const owner = (await api('GET', '/settings')).ownerToken;
  const status = async (r) => (await api('GET', '/requests/' + r.id)).state.status;

  // ---------- учредитель на телефоне ----------
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const o = await phone.newPage();
  watch(o, 'owner');
  await o.goto(BASE + '/v2/?owner=' + owner);
  await o.waitForSelector('.rgm-card');
  assert.strictEqual(await o.locator('.rgm-sep [data-bulk-enter]').count(), 3, '«Выбрать» в «Ожидает решения», «Одобрена / Частично» и «Отложена»');
  assert.strictEqual(await o.locator('.rgm-bulkbar-wrap .rg-bulkbar').count(), 0);
  ok('вне режима: кнопки «Выбрать» в трёх группах, панели нет, одиночные кнопки на карточках есть');

  await o.locator('.rgm-sep [data-bulk-enter]').first().click();
  await o.waitForSelector('.rg-bulkbar');
  assert.strictEqual(await o.locator('.rgm-card [data-act]').count(), 0, 'кнопки одиночного решения скрыты');
  assert.strictEqual(await o.locator('.rgm-card.pickable').count(), 7, '5 ожидающих + 1 отложенная + 1 одобренная');
  assert.ok(await o.locator('[data-bulk="approved"]').isDisabled());
  ok('режим выбора: 7 заявок с отметками, кнопки решения скрыты, «Одобрить» недоступна при 0 выбранных');

  const card = (r) => o.locator('.rgm-card[data-id="' + r.id + '"]');
  // Одобренная выбирается под «Платёжка готова» (change reestr-payment-order);
  // выбор из другой группы сбрасывает прежние отметки.
  await card(appr).click();
  assert.strictEqual(await o.locator('[data-bulk="payment_ready"]').count(), 1);
  assert.strictEqual(await o.locator('[data-bulk="approved"]').count(), 0);
  await card(r1).click();
  assert.strictEqual(await card(appr).locator('.rgm-check.on').count(), 0, 'отметка одобренной сброшена');
  assert.strictEqual(await o.locator('[data-bulk="approved"]').count(), 1);
  ok('одобренная — на панели «Платёжка готова»; выбор ожидающей сбрасывает её отметку');

  for (const r of [r2, r3]) await card(r).click();
  const info = await o.textContent('.rg-bulkbar-info');
  assert.match(info.replace(/\s/g, ' '), /Выбрано 3 · 520 000,00 ₽/);
  ok('выбраны 3 → на панели «' + info.replace(/\s+/g, ' ').trim() + '»');

  // последняя карточка не перекрыта панелью
  await o.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const lastBox = await o.locator('.rgm-card').last().boundingBox();
  const barBox = await o.locator('.rg-bulkbar').boundingBox();
  assert.ok(lastBox.y + lastBox.height <= barBox.y + 1, 'последняя карточка над панелью');
  await o.screenshot({ path: OUT + 'owner-select.png' });
  ok('последняя карточка списка не перекрыта панелью');

  await o.click('[data-bulk="approved"]');
  await o.waitForSelector('.rg-modal');
  assert.match((await o.textContent('.rg-modal h2')).replace(/\s/g, ' '), /Одобрить 3 заявки на 520 000,00 ₽\?/);
  assert.strictEqual(await o.locator('.rg-modal-list li').count(), 3);
  await o.screenshot({ path: OUT + 'owner-confirm.png' });
  await o.click('.rg-modal [data-m="no"]');
  assert.strictEqual(await status(r1), 'pending');
  assert.ok(await o.locator('.rg-bulkbar').count());
  ok('подтверждение «Одобрить 3 заявки на 520 000,00 ₽?» со списком; «Отмена» ничего не меняет, выбор сохранён');

  // пока учредитель думает, admin одобряет r2 с ПК — пачка применится частично
  await card(r4).click();
  await api('POST', '/requests/' + r2.id + '/decision', { decision: 'approved' });
  await o.click('[data-bulk="approved"]');
  await o.click('.rg-modal [data-m="yes"]');
  await o.waitForSelector('#rg-bulk-result');
  const res = await o.textContent('#rg-bulk-result');
  assert.match(res, /Одобрено 3 из 4/);
  assert.match(res, new RegExp(r2.number + ' — уже одобрена'));
  for (const r of [r1, r3, r4]) assert.strictEqual(await status(r), 'approved');
  assert.strictEqual(await o.locator('.rg-bulkbar').count(), 0);
  await o.screenshot({ path: OUT + 'owner-result.png' });
  ok('«Одобрено 3 из 4. Не удалось: ' + r2.number + ' — уже одобрена»; режим выключен, список обновлён');

  // фильтр сбрасывает режим
  await o.locator('.rgm-sep [data-bulk-enter]').first().click();
  await card(r5).click();
  await o.selectOption('#rgm-f-category', cat.id);
  await o.waitForTimeout(500);
  assert.strictEqual(await o.locator('.rg-bulkbar').count(), 0);
  ok('смена фильтра выключает режим выбора и сбрасывает отметки');

  // «Выбрать все» в группе «Ожидает решения» и «Отложить»
  await o.locator('.rgm-sep [data-bulk-enter]').first().click();
  await o.locator('.rgm-sep [data-bulk-group="1"]').click();
  assert.match(await o.textContent('.rg-bulkbar-info'), /Выбрано 1/);
  assert.strictEqual(await card(post).locator('.rgm-check.on').count(), 0, 'отложенная не отмечается из чужой группы');
  await o.click('[data-bulk="postponed"]');
  assert.match(await o.textContent('.rg-modal h2'), /Отложить 1 заявку\?/);
  await o.click('.rg-modal [data-m="yes"]');
  await o.waitForSelector('#rg-bulk-result');
  assert.strictEqual(await status(r5), 'postponed');
  ok('«Выбрать все» отмечает только свою группу; «Отложить 1 заявку?» → отложена');

  // одиночное решение вне режима — как раньше
  const r6 = await mk('ООО «Одиночка»', 500);
  await o.reload();
  await o.waitForSelector('.rgm-card');
  await card(r6).locator('[data-act="approved"]').click();
  await o.waitForFunction((id) => !document.querySelector('.rgm-card[data-id="' + id + '"] [data-act]'), r6.id);
  assert.strictEqual(await status(r6), 'approved');
  ok('одиночное «Одобрить» вне режима работает как раньше');

  // долгое нажатие включает режим и отмечает карточку; короткий тап — открывает
  const rLP = await mk('ООО «Зажатие»', 4200);
  await o.reload();
  await o.waitForSelector('.rgm-card[data-id="' + rLP.id + '"]');
  const lpBox = await card(rLP).locator('.rgm-title').boundingBox();
  await o.mouse.move(lpBox.x + 20, lpBox.y + lpBox.height / 2);
  await o.mouse.down();
  await o.waitForTimeout(700);
  await o.mouse.up();
  await o.waitForSelector('.rg-bulkbar');
  assert.match((await o.textContent('.rg-bulkbar-info')).replace(/\s/g, ' '), /Выбрано 1 · 4 200,00 ₽/);
  assert.strictEqual(await card(rLP).locator('.rgm-check.on').count(), 1);
  assert.strictEqual(await o.locator('#rgm-dec-amount').count(), 0, 'карточка не открылась');
  ok('долгое нажатие: режим выбора включён, заявка отмечена, карточка не открылась');
  await o.click('[data-bulk="cancel"]');
  await card(rLP).locator('.rgm-title').click();
  await o.waitForSelector('#rgm-dec-amount');
  ok('короткий тап вне режима открывает карточку, как раньше');
  await o.goBack();
  await o.waitForSelector('.rgm-card');

  // ---------- admin на телефоне: панель над нижним меню ----------
  await phone.addCookies(await adminCtx.cookies());
  const ap = await phone.newPage();
  watch(ap, 'admin-phone');
  const r7 = await mk('ООО «Для admin»', 3000);
  await ap.goto(BASE + '/v2/#/registry');
  await ap.waitForSelector('.rgm-card');
  await ap.locator('.rgm-sep [data-bulk-enter]').first().click();
  await ap.locator('.rgm-card[data-id="' + r7.id + '"]').click();
  const nav = await ap.locator('.bottom-nav').boundingBox();
  const bar = await ap.locator('.rg-bulkbar').boundingBox();
  assert.ok(bar.y + bar.height <= nav.y + 1, 'панель над нижним меню');
  await ap.screenshot({ path: OUT + 'admin-phone.png' });
  ok('admin на телефоне: панель над нижним меню, не перекрывает его');
  await ap.click('[data-bulk="cancel"]');

  // ---------- admin на ПК ----------
  const r8 = await mk('ООО «ПК-1»', 1100);
  const r9 = await mk('ООО «ПК-2»', 2200);
  await desk.goto(BASE + '/v2/#/registry');
  await desk.waitForSelector('.rg-row');
  await desk.locator('.rg-group [data-bulk-enter]').first().click();
  await desk.waitForSelector('.rg-cb');
  await desk.click('.rg-row[data-id="' + r8.id + '"]');
  await desk.click('.rg-row[data-id="' + r9.id + '"]');
  assert.match((await desk.textContent('.rg-bulkbar-info')).replace(/\s/g, ' '), /Выбрано 2 · 3 300,00 ₽/);
  assert.strictEqual(await desk.locator('#rg-drawer:not([hidden])').count(), 0, 'клик в режиме не открывает карточку');
  await desk.screenshot({ path: OUT + 'desk-select.png' });
  await desk.click('[data-bulk="approved"]');
  await desk.click('.rg-modal [data-m="yes"]');
  await desk.waitForSelector('#rg-bulk-result');
  assert.strictEqual(await status(r8), 'approved');
  assert.strictEqual(await status(r9), 'approved');
  ok('admin на ПК: галочки, «Выбрано 2 · 3 300,00 ₽», одобрение пачкой');
  await desk.click('.rg-row');
  await desk.waitForSelector('#rg-drawer:not([hidden])');
  ok('вне режима клик по строке открывает карточку, как раньше');

  const unexpected = errors.filter((e) => !/status of (400|409)/.test(e));
  console.log('Скриншоты: ' + OUT);
  console.log('Неожиданные ошибки:', unexpected.length ? unexpected.join('\n') : 'нет');
  await browser.close();
  if (unexpected.length) process.exitCode = 1;
})().catch((e) => { console.error('FAILED на шаге ' + (step + 1) + ':', e.message); process.exit(1); });
