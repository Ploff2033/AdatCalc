(function (root) {
  // Отбор заказов на экране «Заказы» на ПК (change orders-filter-search):
  // период, клиент, строка поиска, итоги и имя CSV. Чистые функции без DOM —
  // экран (screen-orders.js) только хранит выбор и рисует. Экспортируется и
  // как window.OrderFilter, и как CommonJS-модуль — для node:test
  // (backend/test/order-filter-ui.test.js).
  //
  // Сервер не участвует: GET /api/orders уже отдаёт менеджеру и admin всю
  // историю, работнику по ссылке — свой завод за 7 дней. Отбор лишь сужает
  // то, что уже загружено, и доступ не расширяет.
  var OE = root.OrderEdit || (typeof require === 'function' ? require('./order-edit') : null);
  var DAY_MS = 24 * 60 * 60 * 1000;
  var NUMBER_RE = /^\d+(?:[.,]\d+)?$/;

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е'); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // 'ГГГГ-ММ-ДД' из <input type="date"> → местная полночь; пусто/мусор → null.
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // Период → { start, end }: местные границы календарных дней, end —
  // исключающая (полночь следующего дня), null — границы нет.
  // period: '30d' | 'month' | 'all' | 'custom' (from/to — 'ГГГГ-ММ-ДД').
  function periodRange(period, from, to, now) {
    var today = startOfDay(now || new Date());
    var tomorrow = addDays(today, 1);
    if (period === '30d') return { start: addDays(today, -29), end: tomorrow };
    if (period === 'month') return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: tomorrow };
    if (period !== 'custom') return { start: null, end: null };
    var a = parseYmd(from), b = parseYmd(to);
    if (a && b && a > b) { var t = a; a = b; b = t; } // перепутанные даты — молча меняем местами
    if (!a && !b) return { start: null, end: null };
    return { start: a, end: b ? addDays(b, 1) : tomorrow };
  }

  // Значения полей «с»/«по» сразу после выбора «Выбрать даты…».
  function customDefaults(now) {
    var d = now || new Date();
    return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(d) };
  }

  function inPeriod(order, range) {
    if (!range.start && !range.end) return true;
    var t = new Date(order.createdAt);
    if (range.start && t < range.start) return false;
    if (range.end && t >= range.end) return false;
    return true;
  }

  // Справочник клиентов → индексы по id и по нормализованному имени.
  function clientIndex(clients) {
    var byId = {}, byName = {};
    (clients || []).forEach(function (c) {
      byId[c.id] = c;
      var n = norm(c.name).trim();
      if (n && !byName[n]) byName[n] = c;
    });
    return { byId: byId, byName: byName };
  }

  // Ключ клиента заказа: по ссылке; без ссылки (клиента удалили) — к клиенту
  // с тем же нынешним именем, иначе отдельная группа по сохранённому имени.
  function clientKey(order, idx) {
    if (order.clientId) return 'id:' + order.clientId;
    var n = norm(order.clientName).trim();
    if (!n) return 'none';
    var c = idx.byName[n];
    return c ? 'id:' + c.id : 'name:' + n;
  }

  // Пункты списка «Клиент» по заказам после отбора по заводу и периоду.
  // → { none: число заказов без клиента, items: [{ key, label, count }] по алфавиту }.
  function clientOptions(orders, clients) {
    var idx = clientIndex(clients);
    var groups = {}, none = 0;
    orders.forEach(function (o) {
      var key = clientKey(o, idx);
      if (key === 'none') { none++; return; }
      var g = groups[key];
      if (!g) {
        var c = key.indexOf('id:') === 0 ? idx.byId[key.slice(3)] : null;
        g = groups[key] = { key: key, label: c ? c.name : (o.clientName || ''), count: 0 };
      }
      g.count++;
    });
    var items = Object.keys(groups).map(function (k) { return groups[k]; });
    items.sort(function (a, b) { return a.label.localeCompare(b.label, 'ru'); });
    return { none: none, items: items };
  }

  // Пункты, подходящие под набранный текст (часть имени, без регистра).
  function matchOptions(items, typed) {
    var q = norm(typed).trim();
    if (!q) return items;
    return items.filter(function (it) { return norm(it.label).indexOf(q) !== -1; });
  }

  function escapeHtml(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Подпись пункта с выделенным совпадением: «Монолит<b>строй</b>».
  function highlight(label, typed) {
    var q = norm(typed).trim();
    var i = q ? norm(label).indexOf(q) : -1;
    if (i === -1) return escapeHtml(label);
    return escapeHtml(label.slice(0, i)) + '<b>' + escapeHtml(label.slice(i, i + q.length)) + '</b>' + escapeHtml(label.slice(i + q.length));
  }

  // Строка, в которой ищутся слова: поля и пометки, видимые в строке списка.
  // Разделитель \n не даёт словам склеиться на стыке полей.
  function haystack(order) {
    var parts = [order.address, order.recipeName, order.plantName, order.mixerName];
    var mode = OE.deliveryModeOf(order);
    if (mode === 'hired') parts.push('найм');
    if (mode === 'pickup') parts.push('самовывоз');
    if (order.cancelledAt) parts.push('отменен');
    if (order.vatApplied) parts.push('с ндс');
    if ((order.edits || []).length) parts.push('испр.'); // как пометка «испр.» (OrderEdit.editLines)
    return norm(parts.filter(Boolean).join('\n'));
  }

  // Каждое слово должно подойти. Слово-число — объём точно или часть текста.
  function matchesSearch(order, query) {
    var words = norm(query).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var hay = haystack(order);
    return words.every(function (w) {
      if (NUMBER_RE.test(w) && Math.abs((order.saleVolume || 0) - parseFloat(w.replace(',', '.'))) < 1e-9) return true;
      return hay.indexOf(w) !== -1;
    });
  }

  // state: { plantId, period, from, to, clientKey, query }; ctx: { clients, now }.
  // → { orders: отобранные (порядок исходный), options: список клиентов,
  //     clientKey: выбранный клиент, сброшенный в '' если его нет в списке }.
  function apply(orders, state, ctx) {
    ctx = ctx || {};
    var range = periodRange(state.period, state.from, state.to, ctx.now);
    var base = (orders || []).filter(function (o) {
      return (!state.plantId || o.plantId === state.plantId) && inPeriod(o, range);
    });
    var options = clientOptions(base, ctx.clients);
    var key = state.clientKey || '';
    if (key && key !== 'none' && !options.items.some(function (it) { return it.key === key; })) key = '';
    var idx = clientIndex(ctx.clients);
    var result = base.filter(function (o) {
      return (!key || clientKey(o, idx) === key) && matchesSearch(o, state.query);
    });
    return { orders: result, options: options, clientKey: key, range: range };
  }

  // Итоги, общие для плиток и заголовков дней: те же суммы, что и раньше
  // считал renderKpi, — по всем переданным заказам.
  function totals(orders) {
    return orders.reduce(function (t, o) {
      t.count++;
      t.volume += o.saleVolume || 0;
      t.pay += o.totalRevenue || 0;
      return t;
    }, { count: 0, volume: 0, pay: 0 });
  }

  function countLabel(n) {
    var m10 = n % 10, m100 = n % 100;
    var word = m10 === 1 && m100 !== 11 ? 'заказ' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'заказа' : 'заказов');
    return n + ' ' + word;
  }

  // Имя CSV. «Всё время» (и пустые даты) — прежнее имя по UTC-дате, как было.
  function csvFileName(range, now) {
    now = now || new Date();
    if (!range.start && !range.end) return 'zakazy-' + now.toISOString().slice(0, 10) + '.csv';
    var last = ymd(new Date(range.end.getTime() - DAY_MS / 2));
    return range.start ? 'zakazy-' + ymd(range.start) + '_' + last + '.csv' : 'zakazy-po-' + last + '.csv';
  }

  var api = {
    norm: norm, periodRange: periodRange, customDefaults: customDefaults, inPeriod: inPeriod,
    clientIndex: clientIndex, clientKey: clientKey, clientOptions: clientOptions, matchOptions: matchOptions, highlight: highlight,
    matchesSearch: matchesSearch, apply: apply, totals: totals, countLabel: countLabel, csvFileName: csvFileName
  };
  root.OrderFilter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
