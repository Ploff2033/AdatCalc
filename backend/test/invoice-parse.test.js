// Разбор счёта для автозаполнения (change reestr-autofill, задачи 2.1–2.2).
// Сценарии — из specs/payment-registry/autofill/spec.md. Фикстуры — тексты
// реальных счетов, обезличенные (ФИО ИП, банковские счета, телефоны заменены).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../../frontend-v2/js/invoice-parse');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'invoices', name + '.txt'), 'utf8');

// ---------- QR ----------

test('Сумма из QR: Sum=350000000 → 3 500 000,00', () => {
  const q = P.parseQr('ST00012|Name=ИП Иванов Иван Иванович|PersonalAcc=40802810000000000005|PayeeINN=260612345678|Sum=350000000|Purpose=Оплата по счету № 21 от 21.10.2026');
  assert.strictEqual(q.amountKop, 350000000);
  assert.strictEqual(q.recipientInn, '260612345678');
  assert.strictEqual(P.merge({ qr: q }).fields.amount, 3500000);
});

test('QR: ключи без учёта регистра и свой разделитель', () => {
  const q = P.parseQr('ST00012#NAME=ООО "ФОРА"#PAYEEINN=0916011226#SUM=9545000');
  assert.strictEqual(q.recipient, 'ООО «ФОРА»');
  assert.strictEqual(q.recipientInn, '0916011226');
  assert.strictEqual(q.amountKop, 9545000);
});

test('QR: кодировки ST00011 (cp1251), ST00012 (UTF-8), ST00013 (КОИ8-Р)', () => {
  const text = 'Name=ООО «ФОРА»|PayeeINN=0916011226|Sum=100';
  const cp1251 = Buffer.concat([Buffer.from('ST00011|'), encode(text, 'cp1251')]);
  const koi8 = Buffer.concat([Buffer.from('ST00013|'), encode(text, 'koi8')]);
  const utf8 = Buffer.from('ST00012|' + text, 'utf8');
  for (const bytes of [cp1251, utf8, koi8]) {
    const q = P.parseQr(P.decodeQrBytes(new Uint8Array(bytes)));
    assert.strictEqual(q.recipient, 'ООО «ФОРА»', bytes.slice(0, 7).toString());
    assert.strictEqual(q.amountKop, 100);
  }
});

test('QR не по ГОСТ — null', () => {
  assert.strictEqual(P.parseQr('https://example.ru/pay?id=1'), null);
  assert.strictEqual(P.parseQr(''), null);
});

// Однобайтовые кодировки для теста — таблицы только для нужных символов.
function encode(str, kind) {
  const ru = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';
  const koi = [225, 226, 247, 231, 228, 229, 246, 250, 233, 234, 235, 236, 237, 238, 239, 240, 242, 243, 244, 245, 230, 232, 227, 254, 251, 253, 255, 249, 248, 252, 224, 241,
    193, 194, 215, 199, 196, 197, 214, 218, 201, 202, 203, 204, 205, 206, 207, 208, 210, 211, 212, 213, 198, 200, 195, 222, 219, 221, 223, 217, 216, 220, 192, 209];
  return Buffer.from([...str].map((ch) => {
    const i = ru.indexOf(ch);
    if (i === -1) {
      if (ch === '«') return kind === 'cp1251' ? 0xab : 0x22;
      if (ch === '»') return kind === 'cp1251' ? 0xbb : 0x22;
      return ch.charCodeAt(0);
    }
    return kind === 'cp1251' ? 0xc0 + i : koi[i];
  }));
}

// ---------- текст ----------

test('Счёт ФОРА: все поля по таблице интервью', () => {
  const r = P.merge({ ocr: P.parseText(fixture('fora')) });
  assert.deepStrictEqual(r.fields, {
    recipient: 'ООО «ФОРА»',
    recipientInn: '0916011226',
    amount: 95450,
    invoiceNumber: '531',
    basis: 'Счёт № 531 от 22.10.2026; договор поставки нефтепродуктов № 53 от 16.10.2025',
    purpose: 'ТКСО ДС (топливный компонент селективной очистки), 1 150 л',
    dueDate: '2026-10-27'
  });
  assert.strictEqual(r.notOurBuyer, false);
});

test('Счёт ЛИКАРД (текст PDF): поля и без срока оплаты', () => {
  const r = P.merge({ pdf: P.parseText(fixture('likard')) });
  assert.strictEqual(r.fields.recipient, 'ООО «ЛУКОЙЛ-Интер-Кард»');
  assert.strictEqual(r.fields.recipientInn, '3444197347');
  assert.strictEqual(r.fields.amount, 140000);
  assert.strictEqual(r.fields.basis, 'Счёт № RU203023711-1792739333 от 23.10.2026; договор № RU203023711 от 22.10.2025');
  assert.strictEqual(r.fields.purpose, 'Нефтепродукты');
  assert.strictEqual(r.fields.dueDate, null);
  assert.strictEqual(r.flags.dueDate.kind, 'absent');
});

test('Счёт ИП (скан): продолжение наименования и сумма из «Итого»', () => {
  const r = P.merge({ ocr: P.parseText(fixture('ip')) });
  assert.strictEqual(r.fields.recipient, 'Иванов Иван Иванович, ИП');
  assert.strictEqual(r.fields.recipientInn, '260612345678');
  assert.strictEqual(r.fields.amount, 3500000);
  assert.strictEqual(r.fields.basis, 'Счёт № 21 от 21.10.2026; договор № 1785 от 09.02.2026');
  assert.strictEqual(r.fields.purpose, 'Аванс по договору 1785 от 09.02.2026');
});

test('Дата словами «22 октября 2026 г.» → 22.10.2026', () => {
  assert.strictEqual(P.parseDate('22 октября 2026 г.'), '2026-10-22');
  assert.match(P.merge({ pdf: P.parseText(fixture('fora')) }).fields.basis, /от 22\.10\.2026;/);
});

test('Латинская C в «Cчет» не мешает найти номер', () => {
  const t = P.parseText('Cчет на оплату № 77 от 01.10.2026\nПоставщик ООО "Тест", ИНН 7700000001\nВсего к оплате: 1 000,00');
  assert.strictEqual(t.invoiceNumber, '77');
  assert.strictEqual(t.amountKop, 100000);
});

test('Сумма в QR и в тексте расходится — побеждает QR, поле подсвечено', () => {
  const ocr = P.parseText(fixture('fora').replace('Всего к оплате: 95 450,00', 'Всего к оплате: 95 450,80'));
  const qr = P.parseQr('ST00012|Name=ООО "ФОРА"|PayeeINN=0916011226|Sum=9545000');
  const r = P.merge({ qr, ocr });
  assert.strictEqual(r.fields.amount, 95450);
  assert.deepStrictEqual(r.flags.amountKop, { kind: 'conflict', qr: '95 450,00', text: '95 450,80' });
});

test('Чужой покупатель — предупреждение', () => {
  const text = fixture('fora').replace('Покупатель ООО "АДАТ ГРУПП", ИНН 2628063503', 'Покупатель ООО "Ромашка", ИНН 7700000000');
  const r = P.merge({ pdf: P.parseText(text) });
  assert.strictEqual(r.notOurBuyer, true);
  assert.strictEqual(r.buyer.inn, '7700000000');
  assert.strictEqual(r.fields.recipientInn, '0916011226');
});

test('Сумма только из распознавания изображения — «проверьте по счёту»', () => {
  const r = P.merge({ ocr: P.parseText(fixture('fora')) });
  assert.strictEqual(r.flags.amountKop.kind, 'ocr_only');
  const withQr = P.merge({ qr: P.parseQr('ST00012|PayeeINN=0916011226|Sum=9545000'), ocr: P.parseText(fixture('fora')) });
  assert.strictEqual(withQr.flags.amountKop, undefined);
});

test('Текст PDF — без подсветки «только распознавание»', () => {
  const r = P.merge({ pdf: P.parseText(fixture('likard')) });
  assert.strictEqual(r.flags.amountKop, undefined);
  assert.strictEqual(r.flags.recipient, undefined);
});

test('Ничего не распознано — empty и все поля «не найдено»', () => {
  const r = P.merge({ qr: null, pdf: P.parseText('   '), ocr: P.parseText('@@ ## ..') });
  assert.strictEqual(r.empty, true);
  assert.strictEqual(r.flags.amountKop.kind, 'missing');
  assert.strictEqual(r.flags.recipient.kind, 'missing');
  assert.strictEqual(r.fields.basis, null);
});

test('Порог текстового слоя: скан без текста < 80 значимых символов', () => {
  assert.ok(P.meaningfulChars('\n \n 1 ') < 80);
  assert.ok(P.meaningfulChars(fixture('likard')) >= 80);
});

// ---------- реальный шум OCR (задача 2.3 / 4.2) ----------

const ocrFixture = (name) => fixture(name).split('\n').filter((l) => !l.startsWith('# ')).join('\n');

test('Фото без QR-кода (реальный OCR ФОРЫ): поля как в таблице интервью', () => {
  const r = P.merge({ ocr: P.parseText(ocrFixture('fora-ocr')) });
  assert.strictEqual(r.fields.recipient, 'ООО «ФОРА»');
  assert.strictEqual(r.fields.recipientInn, '0916011226');
  assert.strictEqual(r.fields.amount, 95450);
  assert.strictEqual(r.fields.basis, 'Счёт № 531 от 22.10.2026; договор поставки нефтепродуктов № 53 от 16.10.2025');
  assert.match(r.fields.purpose, /ДС \(топливный компонент селективной очистки\)$/);
  assert.strictEqual(r.fields.dueDate, '2026-10-27');
  assert.strictEqual(r.notOurBuyer, false);
  assert.strictEqual(r.flags.amountKop.kind, 'ocr_only');
});

test('Скан с искажённой шапкой таблицы (реальный OCR): наименование всё равно найдено', () => {
  const r = P.merge({ ocr: P.parseText(ocrFixture('ip-scan-ocr')) });
  assert.strictEqual(r.fields.purpose, 'Аванс по договору 1785 от 09.02.2026');
  assert.strictEqual(r.fields.amount, 3500000);
  assert.strictEqual(r.fields.basis, 'Счёт № 21 от 21.10.2026; договор № 1785 от 09.02.2026');
});

// ---------- чистка типичных ошибок OCR (не трогая остальную латиницу) ----------

test('Форма организации из латиницы и цифр перед кавычками → ООО/АО', () => {
  for (const form of ['OOO', 'O0О', 'О00', '0OO']) {
    const t = P.parseText('Поставщик ' + form + ' "ФОРА", ИНН 0916011226\nВсего к оплате: 95 450,00');
    assert.strictEqual(t.recipient, 'ООО «ФОРА»', form);
  }
  assert.strictEqual(P.parseText('Поставщик AO "Альфа", ИНН 7700000002\nИтого: 1 000,00').recipient, 'АО «Альфа»');
  assert.strictEqual(P.parseText('Поставщик ПAO "МегаФон", ИНН 7812014560\nИтого: 1 000,00').recipient, 'ПАО «МегаФон»');
});

test('Латиница в названии и номерах не трогается', () => {
  const t = P.parseText('Получатель ООО "FORA LOGISTICS", ИНН 0916011226\nСчет на оплату № RU203023711-OOO7 от 01.10.2026\nИтого: 1 000,00');
  assert.strictEqual(t.recipient, 'ООО «FORA LOGISTICS»');
  assert.strictEqual(t.invoiceNumber, 'RU203023711-OOO7');
  assert.strictEqual(P.normalize('OOO и AO без кавычек'), 'OOO и AO без кавычек');
});

test('«MHH» перед цифрами → ИНН; «ИНН!» с пунктуацией', () => {
  assert.strictEqual(P.parseText('Поставщик ООО "ФОРА", MHH 0916011226\nИтого: 1 000,00').recipientInn, '0916011226');
  assert.strictEqual(P.parseText('Исполнитель ИП Иванов И. И. ИНН! 260612345678\nИтого: 1 000,00').recipientInn, '260612345678');
  assert.strictEqual(P.normalize('MHH компания'), 'MHH компания');
});

test('Получатель-гражданин (акт с самозанятым): ФИО на следующей строке', () => {
  const t = P.parseText('ЗАКАЗЧИК ИСПОЛНИТЕЛЬ\nООО "АДАТ ГРУПП" Гражданин Российской Федерации\nИНН: 2628063503 Иванов Иван Иванович,\nИНН: 091600000017\nИтого: 1 000,00');
  assert.strictEqual(t.recipient, 'Гражданин Иванов Иван Иванович');
  assert.strictEqual(t.recipientInn, '091600000017');
});

test('Мусор перед «Итого» не мешает найти сумму', () => {
  assert.strictEqual(P.parseText('Поставщик ООО "Промхим", ИНН 2635000000\n§ Итого: 67 040,00').amountKop, 6704000);
});
