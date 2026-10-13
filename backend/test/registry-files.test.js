// Сценарии спеки payment-registry/attachments (через HTTP, сырое тело).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { requireDb, resetRegistry, ready } = require('./helpers/db');
const { call, cookieFor, stop, uploadsDir } = require('./helpers/http');
const fx = require('./helpers/fixtures');
const registry = require('../handlers/registry');
const calc = require('../registry-calc');
const telegram = require('../telegram');

telegram.transport.post = async () => {};

test.after(stop);
test.beforeEach(async () => { if (await ready()) await resetRegistry(); });

const PDF = (size) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(Math.max(0, size - 9), 0x20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);
const DOCX = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]);

async function newRequest() {
  const r = await registry.create({ unitId: await fx.unit('Стройка'), categoryId: await fx.category('Материалы'), recipient: 'ООО', purpose: 'x', amount: 1000 });
  return r.id;
}

async function upload(admin, id, buf, query) {
  return call('POST', '/api/registry/requests/' + id + '/files?' + new URLSearchParams(query || {}), { cookie: admin, raw: buf });
}

function onDisk(url) {
  return path.join(uploadsDir, url.replace(/^\/uploads\//, ''));
}

test('PDF-счёт: сохраняется с именем, размером и типом; открывается без входа', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  const r = await upload(admin, id, PDF(198 * 1024), { kind: 'invoice', name: 'Счёт №3341 от 11.10.pdf' });
  assert.strictEqual(r.status, 201);
  const f = r.data.files[0];
  assert.strictEqual(f.name, 'Счёт №3341 от 11.10.pdf');
  assert.strictEqual(f.size, 198 * 1024);
  assert.strictEqual(f.kindLabel, 'Счёт');
  assert.match(f.url, /^\/uploads\/registry\/[0-9a-f]{32}\.pdf$/);
  const got = await call('GET', f.url);
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.headers.get('content-type'), 'application/pdf');
});

test('Фото JPEG/PNG/WEBP принимаются, тип по содержимому', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  for (const [buf, mime] of [[JPG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp']]) {
    const r = await upload(admin, id, buf, { name: 'фото' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.data.files[r.data.files.length - 1].mime, mime);
  }
});

test('Одиннадцатый файл — отказ с лимитом 10', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  for (let i = 0; i < 10; i++) assert.strictEqual((await upload(admin, id, JPG)).status, 201);
  const r = await upload(admin, id, JPG);
  assert.strictEqual(r.status, 409);
  assert.match(r.data.error, /10 файлов/);
});

test('Недопустимый тип (.docx/.zip, текст) — 415', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  const r = await upload(admin, id, DOCX, { name: 'договор.docx' });
  assert.strictEqual(r.status, 415);
  assert.match(r.data.error, /PDF/);
  assert.strictEqual((await upload(admin, id, Buffer.from('hello'))).status, 415);
});

test('Большой PDF 12 МБ — 413, PDF 9 МБ — принимается', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  const big = await upload(admin, id, PDF(12 * 1024 * 1024));
  assert.strictEqual(big.status, 413);
  assert.match(big.data.error, /10 МБ/);
  assert.strictEqual((await upload(admin, id, PDF(9 * 1024 * 1024))).status, 201);
});

test('Оплата с платёжкой; новая платёжка заменяет старую; не входит в лимит заявки', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  await registry.decide(id, { decision: 'approved' });
  const withPay = await registry.addPayment(id, { amount: 500, paidOn: calc.todayMoscow() });
  const payId = withPay.payments[0].id;
  const r1 = await call('POST', '/api/registry/payments/' + payId + '/file?name=pp1.pdf', { cookie: admin, raw: PDF(1000) });
  assert.strictEqual(r1.status, 201);
  const first = r1.data.payments[0].file;
  assert.strictEqual(first.name, 'pp1.pdf');
  assert.strictEqual(r1.data.files.length, 0);
  const r2 = await call('POST', '/api/registry/payments/' + payId + '/file?name=pp2.pdf', { cookie: admin, raw: PDF(1000) });
  assert.strictEqual(r2.data.payments[0].file.name, 'pp2.pdf');
  assert.strictEqual(fs.existsSync(onDisk(first.url)), false);
});

test('Удаление файла: пропадает из заявки, ссылка → 404', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  const f = (await upload(admin, id, JPG)).data.files[0];
  const r = await call('DELETE', '/api/registry/files/' + f.id, { cookie: admin });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.files.length, 0);
  assert.strictEqual((await call('GET', f.url)).status, 404);
});

test('Удаление заявки без оплат удаляет и её файлы', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  await upload(admin, id, JPG);
  const files = (await upload(admin, id, PDF(500))).data.files;
  assert.strictEqual((await call('DELETE', '/api/registry/requests/' + id, { cookie: admin })).status, 204);
  for (const f of files) assert.strictEqual((await call('GET', f.url)).status, 404);
});

test('Удаление оплаты удаляет и её платёжку', async (t) => {
  if (!(await requireDb(t))) return;
  const admin = await cookieFor('admin');
  const id = await newRequest();
  await registry.decide(id, { decision: 'approved' });
  const payId = (await registry.addPayment(id, { amount: 500, paidOn: calc.todayMoscow() })).payments[0].id;
  const file = (await call('POST', '/api/registry/payments/' + payId + '/file', { cookie: admin, raw: JPG })).data.payments[0].file;
  await call('DELETE', '/api/registry/payments/' + payId, { cookie: admin });
  assert.strictEqual((await call('GET', file.url)).status, 404);
});

test('Подбор ссылки: произвольное имя → 404', async (t) => {
  if (!(await requireDb(t))) return;
  assert.strictEqual((await call('GET', '/uploads/registry/00000000000000000000000000000000.pdf')).status, 404);
  assert.strictEqual((await call('GET', '/uploads/registry/')).status, 404);
});

test('Учредитель не может загружать и удалять файлы', async (t) => {
  if (!(await requireDb(t))) return;
  const owner = await registry.getOwnerToken();
  const id = await newRequest();
  assert.strictEqual((await call('POST', '/api/registry/requests/' + id + '/files', { owner, raw: JPG })).status, 403);
});

test('Чек ДДС: прежние правила — фото больше 3 МБ отклоняется', async () => {
  const uploads = require('../uploads');
  const big = 'data:image/jpeg;base64,' + Buffer.alloc(3.5 * 1024 * 1024).toString('base64');
  await assert.rejects(uploads.saveReceiptPhoto(big, 'cash_test'), { status: 413 });
  await assert.rejects(uploads.saveReceiptPhoto('data:application/pdf;base64,JVBERg==', 'cash_test'), { status: 400 });
});
