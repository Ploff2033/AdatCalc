(function (root, factory) {
  // UMD: в браузере — window.InvoiceParse (registry-autofill.js), в Node —
  // module.exports (backend/test/invoice-parse.test.js). Без DOM и без
  // зависимостей — чистые функции «строка → поля».
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvoiceParse = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Разбор счёта на оплату для автозаполнения заявки реестра оплат (change
  // reestr-autofill, design §3). Источники: QR-код оплаты по ГОСТ Р 56042,
  // текстовый слой PDF, текст распознанного изображения (OCR). Правила
  // рассчитаны на типовые российские счета (1С и аналоги): «Счёт № … от …»,
  // «Поставщик/Получатель», «ИНН», «Итого/Всего к оплате».

  // ИНН своих юрлиц — покупатель в счёте должен быть одним из них, иначе
  // предупреждение «Счёт выставлен не на АДАТ ГРУПП». Второе юрлицо —
  // добавить строкой.
  var OUR_INNS = ['2628063503'];

  var MONTHS = {
    января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
    июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12
  };

  function pad2(n) { return String(n).padStart(2, '0'); }

  // ---------- нормализация ----------

  // Латинские буквы-двойники кириллицы, которые OCR и некоторые PDF
  // подставляют в русские слова («Cчёт» с латинской C в счёте ЛИКАРД).
  var LAT_TO_CYR = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у' };

  function fixMixedWord(word) {
    // Только слова, где уже есть кириллица: латинские названия и номера
    // счетов (RU203023711) не трогаем.
    if (!/[а-яё]/i.test(word) || !/[A-Za-z]/.test(word)) return word;
    return word.replace(/[A-Za-z]/g, function (ch) { return LAT_TO_CYR[ch] || ch; });
  }

  function normalize(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[   \t]/g, ' ')
      .replace(/ё/g, 'е').replace(/Ё/g, 'Е')
      .replace(/(?:\bN[°º]|\bNo\.?(?=\s*\d)|№)\s*/g, '№ ')
      .split('\n')
      .map(function (line) {
        // Рамки таблиц, которые OCR читает как «|», «[», «]».
        line = line.replace(/[|\[\]¦]/g, ' ');
        return line.split(' ').map(fixMixedWord).join(' ').replace(/ {2,}/g, ' ').trim();
      })
      .join('\n');
  }

  // Буквы и цифры — по ним отличаем настоящий текстовый слой PDF от
  // «пустого» у сканов (design §2: порог 80).
  function meaningfulChars(text) {
    var m = String(text || '').match(/[0-9A-Za-zА-Яа-яЁё]/g);
    return m ? m.length : 0;
  }

  // ---------- даты и суммы ----------

  var DATE_SRC = '(\\d{1,2}[.\\/]\\d{1,2}[.\\/]\\d{2,4}|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\\s+\\d{4})';

  // '22 октября 2026' | '22.10.2026' | '22.10.26' → '2026-10-22' | null
  function parseDate(s) {
    if (!s) return null;
    var m = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/.exec(s);
    var d, mo, y;
    if (m) {
      d = +m[1]; mo = +m[2]; y = +m[3];
      if (y < 100) y += 2000;
    } else {
      m = /(\d{1,2})\s+([а-я]+)\s+(\d{4})/i.exec(s);
      if (!m || !MONTHS[m[2].toLowerCase()]) return null;
      d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3];
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }

  function ruDate(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  // Денежные числа в строке: '95 450,00', '140 000.00', '3 500 000.00'.
  // Возвращает копейки. Требуем ровно 2 знака после разделителя — так
  // количество («1 150 л») и проценты не принимаются за суммы.
  function moneyInLine(line) {
    var out = [];
    // Даты («09.02.2026») похожи на «09.02» — убираем их до поиска сумм.
    line = String(line).replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ');
    var re = /(\d{1,3}(?: \d{3})+|\d+)[.,](\d{2})(?!\d)/g;
    var m;
    while ((m = re.exec(line))) out.push(Number(m[1].replace(/ /g, '')) * 100 + Number(m[2]));
    return out;
  }

  // ---------- QR-код оплаты (ГОСТ Р 56042-2014) ----------

  // Кодировка строки QR по версии формата: ST00011 — windows-1251,
  // ST00012 — UTF-8, ST00013 — КОИ8-Р. bytes — Uint8Array (jsQR binaryData).
  function decodeQrBytes(bytes) {
    var head = '';
    for (var i = 0; i < Math.min(8, bytes.length); i++) head += String.fromCharCode(bytes[i]);
    var m = /^ST0001([123])/.exec(head);
    var label = m ? { 1: 'windows-1251', 2: 'utf-8', 3: 'koi8-r' }[m[1]] : 'utf-8';
    return new TextDecoder(label).decode(bytes);
  }

  // 'ST00012|Name=…|PayeeINN=…|Sum=…|Purpose=…' → поля или null (не ГОСТ).
  // Разделитель — 8-й символ (обычно «|»), ключи — без учёта регистра.
  function parseQr(payload) {
    var s = String(payload || '');
    var m = /^ST0001([123])(.)/.exec(s);
    if (!m) return null;
    var map = {};
    s.slice(8).split(m[2]).forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i > 0) map[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
    });
    var sumKop = map.sum && /^\d+$/.test(map.sum) ? Number(map.sum) : null;
    var inn = map.payeeinn && /^(\d{10}|\d{12})$/.test(map.payeeinn) ? map.payeeinn : null;
    return {
      recipient: map.name ? orgName(map.name) : null,
      recipientInn: inn,
      amountKop: sumKop,
      qrPurpose: map.purpose || null
    };
  }

  // ---------- наименования организаций ----------

  var FORMS = [
    [/общество\s+с\s+ограниченной\s+ответственностью/i, 'ООО'],
    [/публичное\s+акционерное\s+общество/i, 'ПАО'],
    [/непубличное\s+акционерное\s+общество/i, 'АО'],
    [/закрытое\s+акционерное\s+общество/i, 'ЗАО'],
    [/открытое\s+акционерное\s+общество/i, 'ОАО'],
    [/акционерное\s+общество/i, 'АО'],
    [/индивидуальный\s+предприниматель/i, 'ИП']
  ];

  // Полная форма → сокращённая, кавычки → «ёлочки»: 'Общество с ограниченной
  // ответственностью "ФОРА"' → 'ООО «ФОРА»'.
  function orgName(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim();
    FORMS.forEach(function (f) { s = s.replace(f[0], f[1]); });
    s = s.replace(/^(ООО|АО|ПАО|ЗАО|ОАО)\s+(?:["„“”«]+)\s*([^"„“”«»]+?)\s*(?:["„“”»]+)/, '$1 «$2»');
    s = s.replace(/["„“”]+([^"„“”«»]+?)["„“”]+/g, '«$1»');
    return s.replace(/[,;:\s]+$/, '');
  }

  var ORG_RE = /((?:ООО|АО|ПАО|ЗАО|ОАО|Общество с ограниченной ответственностью|Акционерное общество|Публичное акционерное общество)\s*["«„“][^"»“”\n]{1,80}["»“”]|[А-Я][а-я]+ [А-Я][а-я]+ [А-Я][а-я]+,? ИП|ИП [А-Я][а-я]+ [А-Я]\.\s?[А-Я]\.|ИП [А-Я][а-я]+ [А-Я][а-я]+ [А-Я][а-я]+)/i;

  // ---------- разбор текста ----------

  var INN_RE = /ИНН(?:\s*\/\s*КПП)?\s*:?\s*(\d{12}|\d{10})(?!\d)/gi;
  var BUYER_RE = /(покупатель|плательщик|заказчик|организация)\s*(?:\([^)]*\))?\s*:?/i;
  var SELLER_RE = /(поставщик|исполнитель|получатель|продавец)/i;

  function innsInLine(line) {
    var out = [];
    var m;
    INN_RE.lastIndex = 0;
    while ((m = INN_RE.exec(line))) out.push(m[1]);
    return out;
  }

  // Строки окна [i, i+n] одной строкой — реквизиты в счетах часто переносятся.
  function windowText(lines, i, n) {
    return lines.slice(i, Math.min(lines.length, i + n + 1)).join('\n');
  }

  function findBuyer(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (!BUYER_RE.test(lines[i])) continue;
      var w = windowText(lines, i, 2);
      var inns = innsInLine(w);
      var name = ORG_RE.exec(w);
      if (inns.length || name) return { inn: inns[0] || null, name: name ? orgName(name[1]) : null, line: i };
    }
    return null;
  }

  function findRecipient(lines, buyer) {
    var buyerInn = buyer && buyer.inn;
    var candidates = [];
    lines.forEach(function (line, i) {
      innsInLine(line).forEach(function (inn) {
        if (inn === buyerInn || OUR_INNS.indexOf(inn) !== -1) return;
        // Близость к «Поставщик/Получатель» — выше приоритет.
        var near = windowText(lines, Math.max(0, i - 2), 4);
        candidates.push({ inn: inn, line: i, score: SELLER_RE.test(near) ? 2 : 1 });
      });
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.score - a.score || a.line - b.line; });
    var best = candidates[0];
    // Название — ближайшее к строке ИНН, не покупатель и не наше юрлицо.
    var name = null;
    for (var d = 0; d <= 3 && !name; d++) {
      [best.line - d, best.line + d].forEach(function (j) {
        if (name || j < 0 || j >= lines.length) return;
        var m = ORG_RE.exec(lines[j]);
        if (m && !/адат\s+групп/i.test(m[1])) name = orgName(m[1]);
      });
    }
    return { inn: best.inn, name: name };
  }

  function findInvoice(text) {
    var re = new RegExp('сч[её]т(?:\\s+на\\s+оплату)?\\s*№\\s*([^\\s]+)\\s+от\\s+' + DATE_SRC, 'i');
    var m = re.exec(text);
    if (!m) return null;
    return { number: m[1].replace(/[,;.]+$/, ''), date: parseDate(m[2]) };
  }

  function findContract(text) {
    var re = new RegExp('(договор[а-я]*)((?:\\s+[а-я]+){0,4}?)\\s*:?\\s*№\\s*([^\\s,;]+)\\s+от\\s+' + DATE_SRC, 'i');
    var m = re.exec(text);
    if (!m) return null;
    var kind = m[2].trim().toLowerCase();
    var date = parseDate(m[4]);
    return 'договор' + (kind ? ' ' + kind : '') + ' № ' + m[3] + (date ? ' от ' + ruDate(date) : '');
  }

  // Сумма к оплате: «к оплате» с числом → иначе максимум по строкам «Итого»
  // (без строк НДС) → иначе «на сумму … руб.».
  function findAmount(lines) {
    var i, sums;
    for (i = 0; i < lines.length; i++) {
      if (/к\s+оплате/i.test(lines[i]) && !/ндс/i.test(lines[i])) {
        sums = moneyInLine(lines[i]);
        if (sums.length) return sums[sums.length - 1];
      }
    }
    var best = null;
    for (i = 0; i < lines.length; i++) {
      if (/^\s*итого/i.test(lines[i]) && !/ндс/i.test(lines[i])) {
        sums = moneyInLine(lines[i]);
        if (sums.length) best = Math.max(best || 0, sums[sums.length - 1]);
      }
    }
    if (best) return best;
    for (i = 0; i < lines.length; i++) {
      var m = /на\s+сумму\s+([\d ]+[.,]\d{2})/i.exec(lines[i]);
      if (m) return moneyInLine(m[1])[0];
    }
    return null;
  }

  var UNIT_RE = /\s+(\d{1,3}(?: \d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s+(л|шт|т|кг|м3|м³|м2|м²|м|ед|компл|упак|усл)\.?(?=\s|$)/i;

  // Строки таблицы товаров между шапкой и «Итого». Строка товара начинается
  // с номера 1–3 цифр и слова; следующая строка без номера — продолжение
  // наименования («Аванс по договору» / «1785 от 09.02.2026»).
  function findItems(lines) {
    var start = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/наименование|товары\s*\(работы/i.test(lines[i])) { start = i + 1; break; }
    }
    // Шапку таблицы OCR исказил — ищем первую строку товара «1 Слово … сумма»
    // перед «Итого».
    if (start === -1) {
      for (var k = 0; k < lines.length; k++) {
        if (/^\s*итого/i.test(lines[k])) break;
        if (/^1[.)]?\s+[А-Яа-яA-Za-z«"]/.test(lines[k]) && moneyInLine(lines[k]).length) { start = k; break; }
      }
    }
    if (start === -1) return [];
    var items = [];
    for (var j = start; j < lines.length; j++) {
      var line = lines[j];
      if (/^\s*(итого|всего|в\s+том\s+числе)/i.test(line)) break;
      var row = /^(\d{1,3})[.)]?\s+(.+)$/.exec(line);
      if (row && /^[А-ЯA-Zа-яa-z«"(]/.test(row[2])) {
        items.push(cleanItem(row[2]));
      } else if (items.length && !moneyInLine(line).length && /[А-Яа-я]/.test(line)) {
        items[items.length - 1] += ' ' + line.trim();
      }
    }
    return items.filter(Boolean);
  }

  function cleanItem(cell) {
    var qty = '';
    var u = UNIT_RE.exec(cell);
    var name = cell;
    if (u) {
      qty = u[1] + ' ' + u[2];
      name = cell.slice(0, u.index);
    }
    // Хвост из колонок: «— —», «- -», числа, проценты.
    name = name.replace(/(\s+([-—–]+|\d[\d ]*(?:[.,]\d+)?%?))+\s*$/, '').replace(/[.\s]+$/, '').trim();
    // OCR-мусор из колонок («11501 #300» вместо «1 150 л 83,00»): хвостовые
    // токены без двух букв подряд отрезаем.
    var tokens = name.split(' ');
    var junk = function (tok) { return !/[А-Яа-яA-Za-z]{2}/.test(tok) && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(tok); };
    while (tokens.length > 1 && junk(tokens[tokens.length - 1])) tokens.pop();
    name = tokens.join(' ').replace(/[.,;\s]+$/, '');
    return name + (qty ? ', ' + qty : '');
  }

  function findDue(text) {
    var re = new RegExp('(?:оплатить\\s+не\\s+позднее|сч[её]т\\s+действителен\\s+до|срок\\s+оплаты\\s*:?)\\s*' + DATE_SRC, 'i');
    var m = re.exec(text);
    return m ? parseDate(m[1]) : null;
  }

  // Текст (PDF или OCR) → поля. Отсутствующее — null.
  function parseText(rawText) {
    var text = normalize(rawText);
    if (meaningfulChars(text) < 20) return null;
    var lines = text.split('\n').filter(function (l) { return l.length; });
    var buyer = findBuyer(lines);
    var recipient = findRecipient(lines, buyer);
    var invoice = findInvoice(text);
    var items = findItems(lines);
    return {
      recipient: recipient && recipient.name,
      recipientInn: recipient && recipient.inn,
      amountKop: findAmount(lines),
      invoiceNumber: invoice && invoice.number,
      invoiceDate: invoice && invoice.date,
      contract: findContract(text),
      purpose: items.length ? items.join('; ') : null,
      dueDate: findDue(text),
      buyerInn: buyer && buyer.inn,
      buyerName: buyer && buyer.name
    };
  }

  // ---------- слияние источников ----------

  var FIELDS = ['recipient', 'recipientInn', 'amountKop', 'invoiceNumber', 'invoiceDate', 'contract', 'purpose', 'dueDate', 'buyerInn', 'buyerName'];
  // Поля, которые сверяем между QR и текстом (design §3: conflict).
  var CHECKED = ['amountKop', 'recipientInn'];

  function money(kop) {
    return (kop / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ');
  }

  // parts: { qr, pdf, ocr } — результаты parseQr / parseText (или null).
  // Приоритет QR > текст PDF > OCR. Возвращает поля формы заявки, флаги
  // подсветки и предупреждения.
  function merge(parts) {
    var order = ['qr', 'pdf', 'ocr'];
    var raw = {};
    var src = {};
    FIELDS.forEach(function (f) {
      for (var i = 0; i < order.length; i++) {
        var p = parts[order[i]];
        if (p && p[f] !== null && p[f] !== undefined && p[f] !== '') { raw[f] = p[f]; src[f] = order[i]; return; }
      }
      raw[f] = null;
    });
    // Цель из QR («Оплата по счёту …») — только если в таблице товаров ничего нет.
    if (!raw.purpose && parts.qr && parts.qr.qrPurpose) { raw.purpose = parts.qr.qrPurpose; src.purpose = 'qr'; }

    var flags = {};
    CHECKED.forEach(function (f) {
      var q = parts.qr && parts.qr[f];
      var t = (parts.pdf && parts.pdf[f]) || (parts.ocr && parts.ocr[f]);
      if (q && t && q !== t) {
        flags[f] = { kind: 'conflict', qr: f === 'amountKop' ? money(q) : q, text: f === 'amountKop' ? money(t) : t };
      }
    });
    var formFields = { recipient: 'recipient', recipientInn: 'recipientInn', amountKop: 'amountKop', invoiceNumber: 'invoiceNumber', purpose: 'purpose', dueDate: 'dueDate' };
    Object.keys(formFields).forEach(function (f) {
      if (flags[f]) return;
      if (raw[f] === null) flags[f] = { kind: f === 'dueDate' ? 'absent' : 'missing' };
      else if (src[f] === 'ocr') flags[f] = { kind: 'ocr_only' };
    });

    var basis = null;
    if (raw.invoiceNumber) {
      basis = 'Счёт № ' + raw.invoiceNumber + (raw.invoiceDate ? ' от ' + ruDate(raw.invoiceDate) : '');
      if (raw.contract) basis += '; ' + raw.contract;
      if (src.invoiceNumber === 'ocr') flags.basis = { kind: 'ocr_only' };
    } else {
      flags.basis = { kind: 'missing' };
    }

    var found = ['recipient', 'recipientInn', 'amountKop', 'invoiceNumber', 'purpose'].some(function (f) { return raw[f] !== null; });
    return {
      fields: {
        recipient: raw.recipient,
        recipientInn: raw.recipientInn,
        amount: raw.amountKop === null ? null : raw.amountKop / 100,
        invoiceNumber: raw.invoiceNumber,
        basis: basis,
        purpose: raw.purpose,
        dueDate: raw.dueDate
      },
      flags: flags,
      sources: src,
      buyer: { inn: raw.buyerInn, name: raw.buyerName },
      notOurBuyer: Boolean(raw.buyerInn && OUR_INNS.indexOf(raw.buyerInn) === -1),
      empty: !found
    };
  }

  return {
    OUR_INNS: OUR_INNS,
    normalize: normalize,
    meaningfulChars: meaningfulChars,
    parseDate: parseDate,
    decodeQrBytes: decodeQrBytes,
    parseQr: parseQr,
    parseText: parseText,
    merge: merge,
    orgName: orgName
  };
});
