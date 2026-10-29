(function () {
  // Реестр оплат — общее для десктопного экрана admin (screen-registry.js) и
  // мобильного (mobile-registry.js, он же экран учредителя): запросы к
  // /api/registry/*, форматирование, статусы, экспорт в Excel.
  //
  // Свой fetch-обёртка, а не shared/api.js: учредитель ходит без сессии, по
  // токену из своей ссылки (?owner=...), и каждый запрос реестра несёт его в
  // заголовке X-Owner-Token (см. backend/registry-routes.js). Токен остаётся
  // в адресе страницы — ссылка из Telegram и ярлык "на экран Домой"
  // работают сами по себе, без сохранения где-то ещё.

  function ownerToken() {
    try { return new URLSearchParams(location.search).get('owner') || ''; }
    catch (err) { return ''; }
  }

  function isOwnerMode() {
    return Boolean(ownerToken());
  }

  async function request(method, path, opts) {
    var o = opts || {};
    var headers = {};
    var token = ownerToken();
    if (token) headers['X-Owner-Token'] = token;
    var body;
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.json);
    } else if (o.raw !== undefined) {
      headers['Content-Type'] = o.raw.type || 'application/octet-stream';
      body = o.raw;
    }
    var res = await fetch('/api/registry' + path, { method: method, headers: headers, body: body });
    if (res.status === 204) return null;
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      var msg = (data && data.error) || ('Ошибка запроса (' + res.status + ')');
      // Прокси перед приложением со своим лимитом тела отвечает 413 без
      // нашего JSON — даём понятный текст вместо "Ошибка запроса (413)".
      if (res.status === 413 && !(data && data.error)) msg = 'Файл слишком большой для сервера (больше 10 МБ или лимит прокси)';
      var err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  var api = {
    get: function (path) { return request('GET', path); },
    post: function (path, json) { return request('POST', path, { json: json || {} }); },
    put: function (path, json) { return request('PUT', path, { json: json || {} }); },
    del: function (path) { return request('DELETE', path); },
    // blob — File или Blob; имя и тип файла — в query, тело — сами байты.
    upload: function (path, blob, query) {
      var qs = new URLSearchParams(query || {}).toString();
      return request('POST', path + (qs ? '?' + qs : ''), { raw: blob });
    }
  };

  // ---------- форматирование ----------

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function rub(n) {
    return money(n) + ' ₽';
  }

  // 'YYYY-MM-DD' → '12.10' / '12.10.2026'
  function ddmm(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p[2] + '.' + p[1];
  }
  function ddmmyyyy(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function tsDate(ts) {
    return ts ? new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  }

  // Локальная дата без ухода через UTC (тот же класс бага, что описан в
  // screen-cash.js::localDateStr).
  function localDateStr(d) {
    d = d || new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fileSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
    return Math.max(1, Math.round(bytes / 1024)) + ' КБ';
  }

  // Цвета по решению (просьба пользователя): одобрено — зелёный, отклонено —
  // красный, отложено — жёлтый. "Ожидает решения" — оранжевый (требует
  // действия), чтобы не сливаться с жёлтым "Отложена". Частичная оплата —
  // синий: решение "одобрено", но деньги ещё в процессе. «Платёжка готова» —
  // фиолетовый (change reestr-payment-order): ждёт оплаты в банке.
  var STATUS_CHIP = { ready: 'ready', pending: 'act', approved: 'ok', partial: 'part', paid: 'ok', rejected: 'bad', postponed: 'warn' };
  var DECISION_CHIP = { approved: 'ok', rejected: 'bad', postponed: 'warn' };
  var STATUS_OPTIONS = [
    { id: '', label: 'все' },
    { id: 'ready', label: 'Платёжка готова' },
    { id: 'pending', label: 'Ожидает решения' },
    { id: 'approved', label: 'Одобрена' },
    { id: 'partial', label: 'Частично оплачена' },
    { id: 'postponed', label: 'Отложена' },
    { id: 'paid', label: 'Оплачена' },
    { id: 'rejected', label: 'Отклонена' }
  ];
  // Группы списка — номера те же, что в backend/registry-calc.js::GROUP_OF_STATUS
  // (порядок показа). Только через имена: перенумерация не должна тихо
  // ломать экраны.
  var GROUP = { READY: 0, PENDING: 1, APPROVED: 2, POSTPONED: 3, CLOSED: 4 };
  var GROUP_LABELS = ['Платёжка готова', 'Ожидает решения', 'Одобрена / Частично оплачена', 'Отложена', 'Закрытые'];
  // Группы, из которых выбирают пачкой: решения — «Ожидает» и «Отложена»,
  // «Платёжка готова» — из «Одобрена / Частично».
  var BULK_GROUPS = [GROUP.PENDING, GROUP.APPROVED, GROUP.POSTPONED];
  var FILE_KINDS = [
    { id: 'invoice', label: 'Счёт' },
    { id: 'contract', label: 'Договор' },
    { id: 'payment_order', label: 'Платёжка' },
    { id: 'other', label: 'Прочее' }
  ];

  // Текст самого решения (а не статуса оплаты): у одобренной и частично
  // оплаченной заявки решение одно — «Одобрено».
  var DECISION_LABELS = { approved: 'Одобрено', rejected: 'Отклонено', postponed: 'Отложено' };
  function decisionLabel(item) {
    var label = DECISION_LABELS[item.decision] || '';
    if (item.decision === 'approved' && item.approvedAmount < item.amount) label += ' ' + rub(item.approvedAmount) + ' из ' + rub(item.amount);
    return label;
  }

  function decisionChip(item) {
    return '<span class="chip ' + (DECISION_CHIP[item.decision] || 'mute') + '">' + esc(decisionLabel(item)) + '</span>';
  }

  function statusChip(item) {
    var label = item.state.statusLabel;
    if (item.state.status === 'paid' && item.lastPaidOn) label = 'Оплачена ' + ddmm(item.lastPaidOn);
    return '<span class="chip ' + STATUS_CHIP[item.state.status] + '">' + esc(label) + '</span>';
  }

  // Сколько платёжка ждёт оплаты: «готова сегодня 10:40», «готова вчера
  // 18:05», «готова 2 дн.» — по календарным дням Москвы.
  var MSK = 'Europe/Moscow';
  function mskDay(d) { return d.toLocaleDateString('en-CA', { timeZone: MSK }); }
  function readyAge(item, now) {
    if (!item || !item.paymentOrderAt) return '';
    var at = new Date(item.paymentOrderAt);
    if (isNaN(at)) return '';
    var n = now || new Date();
    var days = Math.round((Date.parse(mskDay(n)) - Date.parse(mskDay(at))) / 86400000);
    var time = at.toLocaleTimeString('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit' });
    if (days <= 0) return 'готова сегодня ' + time;
    if (days === 1) return 'готова вчера ' + time;
    return 'готова ' + days + ' дн.';
  }

  // Период по дате создания: '' — всё время (по умолчанию: иначе старые
  // неоплаченные заявки выпали бы из списка "Активные").
  var PERIODS = [
    { id: '', label: 'всё время' },
    { id: 'month', label: 'этот месяц' },
    { id: 'prev', label: 'прошлый месяц' },
    { id: '30d', label: '30 дней' }
  ];
  function periodRange(id) {
    var now = new Date();
    if (id === 'month') return { from: localDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDateStr(now) };
    if (id === 'prev') {
      return { from: localDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localDateStr(new Date(now.getFullYear(), now.getMonth(), 0)) };
    }
    if (id === '30d') {
      var d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { from: localDateStr(d), to: localDateStr(now) };
    }
    return { from: '', to: '' };
  }

  // filters: { closed, status, unit, category, period }
  function listQuery(f) {
    var q = new URLSearchParams();
    if (f.closed) q.set('closed', '1');
    if (f.status) { q.set('status', f.status); q.set('closed', 'all'); }
    if (f.unit) q.set('unit', f.unit);
    if (f.category) q.set('category', f.category);
    var r = periodRange(f.period);
    if (r.from) q.set('from', r.from);
    if (r.to) q.set('to', r.to);
    var s = q.toString();
    return s ? '?' + s : '';
  }

  function isImage(file) {
    return /^image\//.test(file.mime);
  }

  // ---------- файлы: подготовка перед загрузкой ----------

  // Фото — сжимаем тем же PhotoCompress, что и чеки ДДС (на телефоне
  // оригиналы весят мегабайты); PDF — как есть. Возвращает { blob, name }.
  async function prepareUpload(file) {
    if (/^image\//.test(file.type)) {
      var dataUrl = await PhotoCompress.fromFile(file, 2000, 0.8);
      var bin = atob(dataUrl.split(',')[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var base = (file.name || 'фото').replace(/\.[^.]+$/, '');
      return { blob: new Blob([bytes], { type: 'image/jpeg' }), name: base + '.jpg' };
    }
    if (file.type && file.type !== 'application/pdf') {
      throw new Error('Допустимы только PDF и фото (JPEG, PNG, WEBP)');
    }
    if (file.size > 10 * 1024 * 1024) throw new Error('Файл больше 10 МБ');
    return { blob: file, name: file.name || 'документ.pdf' };
  }

  // ---------- форма заявки (боковая панель и экран проверки) ----------

  // Одна форма на два места: боковая панель реестра (screen-registry.js,
  // раскладка в две колонки) и узкая колонка экрана проверки счетов
  // (registry-autofill.js, opts.column). prefix — префикс id полей, чтобы
  // формы не пересекались, если обе окажутся в DOM.
  function selectableOptions(list, current) {
    return '<option value="">— выберите —</option>' + list.filter(function (d) { return !d.hidden || d.id === current; }).map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (d.id === current ? ' selected' : '') + '>' + esc(d.name) + (d.hidden ? ' (скрыто)' : '') + '</option>';
    }).join('');
  }

  // opts.notes[key] — HTML под полем (подсказка распознавания, «как в прошлой
  // заявке»), opts.flagged[key] — подсветить поле для проверки.
  function formField(key, v, dicts, p, opts) {
    var note = (opts.notes && opts.notes[key]) || '';
    var cls = 'field' + (opts.flagged && opts.flagged[key] ? ' rg-flag' : '');
    var label = function (text, req) {
      return '<label for="' + p + '-' + key + '">' + text + (req ? ' <span class="req">*</span>' : '') + '</label>';
    };
    var wrap = function (inner) { return '<div class="' + cls + '" data-field="' + key + '">' + inner + note + '</div>'; };
    switch (key) {
      case 'unit':
        return wrap(label('Подразделение', true) + '<select id="' + p + '-unit" class="inp">' + selectableOptions(dicts.units, v.unitId) + '</select>');
      case 'category':
        return wrap(label('Категория', true) + '<select id="' + p + '-category" class="inp">' + selectableOptions(dicts.categories, v.categoryId) + '</select>');
      case 'applicant':
        return wrap(label('Заявитель') + '<input id="' + p + '-applicant" class="inp" list="' + p + '-dl-applicant" autocomplete="off" value="' + esc(v.applicant) + '">');
      case 'due':
        return wrap(label('Срок оплаты') + '<input id="' + p + '-due" type="date" class="inp" value="' + esc(v.dueDate || '') + '">');
      case 'recipient':
        // Многострочное: длинные названия («ИП Фамилия Имя Отчество»,
        // «ООО «ЛУКОЙЛ-Интер-Кард»») видны целиком и в узкой колонке
        // экрана проверки. Подсказки — свой список (datalist у textarea нет).
        return wrap(label('Получатель', true) + '<div class="rg-suggest-wrap"><textarea id="' + p + '-recipient" class="inp rg-grow" rows="1" autocomplete="off" spellcheck="false">' + esc(v.recipient) + '</textarea><div class="rg-suggest" id="' + p + '-sg-recipient" hidden></div></div>');
      case 'inn':
        return wrap(label('ИНН получателя') + '<input id="' + p + '-inn" class="inp num" inputmode="numeric" maxlength="14" value="' + esc(v.recipientInn) + '">');
      case 'basis':
        return wrap(label('Основание (счёт / договор)') + '<textarea id="' + p + '-basis" class="inp" rows="2" style="height:auto;min-height:40px;padding:9px 12px;resize:vertical" placeholder="Счёт №… от …">' + esc(v.basis) + '</textarea>');
      case 'amount':
        return wrap(label('Сумма', true) + '<div class="unit"><input id="' + p + '-amount" class="inp num" inputmode="decimal" style="height:48px;font-size:20px;font-weight:600"><span>₽</span></div>');
      case 'purpose':
        return wrap(label('Цель расхода', true) + '<textarea id="' + p + '-purpose" class="inp rg-grow rg-purpose" rows="5">' + esc(v.purpose) + '</textarea>');
    }
    return '';
  }

  function formHtml(it, dicts, opts) {
    var o = opts || {};
    var p = o.prefix || 'rg-i';
    var v = it || {};
    var f = function (key) { return formField(key, v, dicts, p, o); };
    var pair = function (a, b) { return '<div class="grid-2">' + f(a) + f(b) + '</div>'; };
    // Узкая колонка экрана проверки — в порядке чтения счёта сверху вниз
    // (макет PaymentsReview): сначала то, что распознано, потом выбор.
    var body = o.column
      ? ['recipient', 'inn', 'amount', 'basis', 'purpose', 'due', 'unit', 'category', 'applicant'].map(f).join('')
      : pair('unit', 'category') + pair('applicant', 'due') + f('recipient') + pair('inn', 'amount') + f('basis') + f('purpose');
    return body + '<datalist id="' + p + '-dl-applicant"></datalist>';
  }

  function readForm(prefix) {
    var p = prefix || 'rg-i';
    var val = function (key) { var el = document.getElementById(p + '-' + key); return el ? el.value : undefined; };
    return {
      unitId: val('unit'),
      categoryId: val('category'),
      applicant: val('applicant'),
      dueDate: val('due') || null,
      recipient: val('recipient'),
      recipientInn: val('inn'),
      basis: val('basis'),
      amount: val('amount'),
      purpose: val('purpose')
    };
  }

  // Поля, растущие по тексту (получатель, цель): высота = содержимое.
  function autoGrow(el) {
    var fit = function () {
      el.style.height = 'auto';
      el.style.height = (el.scrollHeight + 2) + 'px';
    };
    el.addEventListener('input', fit);
    // В скрытом/ещё не отрисованном контейнере scrollHeight = 0 — досчитываем после кадра.
    fit();
    requestAnimationFrame(fit);
  }

  // Подсказки получателя для многострочного поля: свой выпадающий список
  // (datalist работает только с <input>). Enter по подсказке не нужен —
  // клик или стрелки+Enter.
  function bindRecipientSuggest(p) {
    var input = document.getElementById(p + '-recipient');
    var box = document.getElementById(p + '-sg-recipient');
    if (!input || !box) return;
    var timer = null;
    var values = [];
    var active = -1;
    var paint = function () {
      box.hidden = !values.length;
      box.innerHTML = values.map(function (x, i) {
        return '<button type="button" class="rg-suggest-item' + (i === active ? ' on' : '') + '" data-i="' + i + '">' + esc(x) + '</button>';
      }).join('');
    };
    var choose = function (i) {
      input.value = values[i];
      values = [];
      paint();
      input.dispatchEvent(new Event('input'));
    };
    var load = function () {
      var q = input.value.trim();
      api.get('/suggest?field=recipient&q=' + encodeURIComponent(q)).then(function (res) {
        values = res.filter(function (x) { return x !== input.value; });
        active = -1;
        if (document.activeElement === input) paint();
      }).catch(function () {});
    };
    input.addEventListener('input', function (e) { if (e.isTrusted !== false) { clearTimeout(timer); timer = setTimeout(load, 200); } });
    input.addEventListener('focus', load);
    input.addEventListener('blur', function () { setTimeout(function () { values = []; paint(); }, 150); });
    input.addEventListener('keydown', function (e) {
      if (!values.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % values.length; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + values.length) % values.length; paint(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { values = []; paint(); }
    });
    box.addEventListener('mousedown', function (e) {
      var b = e.target.closest('[data-i]');
      if (b) { e.preventDefault(); choose(Number(b.dataset.i)); }
    });
  }

  // Подсказки заявителя из ранее введённых (GET /suggest).
  function bindSuggest(p, field) {
    var input = document.getElementById(p + '-' + field);
    var list = document.getElementById(p + '-dl-' + field);
    if (!input || !list) return;
    var timer = null;
    var load = function () {
      api.get('/suggest?field=' + field + '&q=' + encodeURIComponent(input.value.trim())).then(function (values) {
        list.innerHTML = values.map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join('');
      }).catch(function () {});
    };
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 200); });
    input.addEventListener('focus', load, { once: true });
  }

  function bindForm(it, prefix) {
    var p = prefix || 'rg-i';
    var amount = document.getElementById(p + '-amount');
    NumericInput.attach(amount);
    if (it && it.amount !== null && it.amount !== undefined) NumericInput.setFormattedValue(amount, it.amount);
    bindSuggest(p, 'applicant');
    bindRecipientSuggest(p);
    ['recipient', 'purpose'].forEach(function (k) {
      var el = document.getElementById(p + '-' + k);
      if (el) autoGrow(el);
    });
  }

  // ---------- копирование получателя ----------

  // Кнопка «Скопировать» рядом с получателем — для бухгалтера и admin, чтобы
  // не перепечатывать название в банк-клиент. Это <span role="button">, а не
  // <button>: она живёт и внутри строки таблицы, которая сама <button>.
  var COPY_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function copyBtn(text, what) {
    if (!text) return '';
    return '<span class="rg-copy" role="button" tabindex="0" data-copy="' + esc(text) + '" title="Скопировать ' + esc(what || '') + '" aria-label="Скопировать ' + esc(what || '') + '">' + COPY_ICON + '</span>';
  }

  // Clipboard API есть только в «безопасном» контексте (https, localhost);
  // если сервер открыт по http — запасной путь через скрытое поле и execCommand.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }

  function toast(text, kind) {
    var el = document.getElementById('rg-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rg-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.className = 'rg-toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.hidden = true; }, 2200);
  }

  // Один делегированный обработчик на документ, в фазе перехвата — чтобы клик
  // по иконке не открывал карточку и не переключал отметку в режиме выбора.
  function onCopy(e) {
    var btn = e.target.closest && e.target.closest('[data-copy]');
    if (!btn) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    var text = btn.dataset.copy;
    copyText(text).then(function (ok) {
      if (ok) {
        btn.classList.add('done');
        setTimeout(function () { btn.classList.remove('done'); }, 1200);
        toast('Скопировано: ' + text);
      } else {
        toast('Не удалось скопировать — выделите название вручную', 'bad');
      }
    });
  }
  document.addEventListener('click', onCopy, true);
  document.addEventListener('keydown', onCopy, true);

  // ---------- пакетное решение (change reestr-bulk) ----------

  // Контроллер режима выбора — общий для телефона (mobile-registry.js) и ПК
  // (screen-registry.js); разметку каждый экран рисует сам по onChange.
  // opts: { onChange(), onApplied(result) }.
  function createSelection(opts) {
    var o = opts || {};
    var on = false;
    var picked = {}; // id → заявка (для суммы и подтверждения)
    var busy = false;

    var changed = function () { if (o.onChange) o.onChange(); };
    // Два вида пачки (change reestr-payment-order): решение — из «Ожидает» и
    // «Отложена», «Платёжка готова» — из «Одобрена / Частично». Смешивать
    // нельзя: выбор из другого вида сбрасывает прежние отметки.
    var kindOf = function (it) {
      if (!it) return null;
      var st = it.state.status;
      if (st === 'pending' || st === 'postponed') return 'decision';
      if (st === 'approved' || st === 'partial') return 'ready';
      return null;
    };
    var kind = null;
    var selectable = function (it) { return kindOf(it) !== null; };
    var list = function () { return Object.keys(picked).map(function (id) { return picked[id]; }); };
    var itemKop = function (it) { return Math.round((kind === 'ready' ? it.state.unpaid : it.amount) * 100); };
    var sumKop = function () { return list().reduce(function (s, it) { return s + itemKop(it); }, 0); };
    var switchKind = function (k) { if (kind !== k) { picked = {}; kind = k; } };

    var sel = {
      isOn: function () { return on; },
      selectable: selectable,
      has: function (id) { return Boolean(picked[id]); },
      count: function () { return list().length; },
      sumKop: sumKop,
      kind: function () { return kind; },
      enter: function () { on = true; picked = {}; kind = null; changed(); },
      exit: function () { if (!on) return; on = false; picked = {}; kind = null; changed(); },
      toggle: function (it) {
        if (!on || !selectable(it)) return false;
        switchKind(kindOf(it));
        if (picked[it.id]) delete picked[it.id]; else picked[it.id] = it;
        changed();
        return true;
      },
      // Все выбираемые заявки группы: если все уже отмечены — снять.
      toggleGroup: function (items) {
        var pickable = items.filter(selectable);
        if (pickable.length) switchKind(kindOf(pickable[0]));
        var all = pickable.length && pickable.every(function (it) { return picked[it.id]; });
        pickable.forEach(function (it) { if (all) delete picked[it.id]; else picked[it.id] = it; });
        changed();
      },
      groupAllPicked: function (items) {
        var pickable = items.filter(selectable);
        return pickable.length > 0 && pickable.every(function (it) { return picked[it.id]; });
      },
      barHtml: function () {
        if (!on) return '';
        var n = list().length;
        var dis = n && !busy ? '' : ' disabled';
        return '<div class="rg-bulkbar" role="region" aria-label="Пакетное решение">' +
          '<span class="rg-bulkbar-info">Выбрано <b>' + n + '</b>' + (n ? ' · <b class="num">' + rub(sumKop() / 100) + '</b>' : '') + '</span>' +
          '<div class="rg-bulkbar-actions">' +
            '<button type="button" class="btn ghost" data-bulk="cancel">Отмена</button>' +
            (kind === 'ready'
              ? '<button type="button" class="btn pri rg-ready-btn" data-bulk="payment_ready"' + dis + '>' + (busy ? 'Применяем…' : 'Платёжка готова') + '</button>'
              : '<button type="button" class="btn ghost" data-bulk="postponed"' + dis + '>Отложить</button>' +
                '<button type="button" class="btn pri" data-bulk="approved"' + dis + '>' + (busy ? 'Применяем…' : 'Одобрить') + '</button>') +
          '</div></div>';
      },
      // Клики по панели — делегированно из экрана: true, если обработан.
      handleBarClick: function (e) {
        var b = e.target.closest('[data-bulk]');
        if (!b) return false;
        if (b.dataset.bulk === 'cancel') sel.exit();
        else sel.confirmAndApply(b.dataset.bulk);
        return true;
      },
      confirmAndApply: async function (decision) {
        var items = list();
        if (!items.length || busy) return;
        var ok = await confirmBulk(decision, items, sumKop(), itemKop);
        if (!ok) return;
        busy = true;
        changed();
        try {
          var res = await api.post('/decisions', { ids: items.map(function (it) { return it.id; }), decision: decision });
          busy = false;
          on = false;
          picked = {};
          kind = null;
          showBulkResult(decision, res, items.length);
          changed();
          if (o.onApplied) o.onApplied(res);
        } catch (err) {
          busy = false;
          changed();
          showBulkResult(decision, null, items.length, err.message);
        }
      }
    };
    return sel;
  }

  function zayavokWord(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'заявку';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'заявки';
    return 'заявок';
  }

  // Подтверждение со списком (лист снизу на телефоне, диалог на ПК — CSS).
  // Не window.confirm: нужен список «№ · получатель · сумма» и крупные кнопки.
  function confirmBulk(decision, items, kop, itemKop) {
    return new Promise(function (resolve) {
      var el = document.createElement('div');
      el.className = 'rg-modal';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      var ready = decision === 'payment_ready';
      var title = decision === 'approved'
        ? 'Одобрить ' + items.length + ' ' + zayavokWord(items.length) + ' на ' + rub(kop / 100) + '?'
        : ready
          ? '«Платёжка готова» для ' + items.length + ' ' + (items.length === 1 ? 'заявки' : 'заявок') + ' на ' + rub(kop / 100) + '?'
          : 'Отложить ' + items.length + ' ' + zayavokWord(items.length) + '?';
      var yes = decision === 'approved' ? 'Одобрить' : ready ? 'Платёжка готова' : 'Отложить';
      el.innerHTML =
        '<div class="rg-modal-sheet">' +
          '<h2>' + esc(title) + '</h2>' +
          (decision === 'approved' ? '<p class="hint" style="margin:0">Каждая заявка — на свою полную сумму. Уменьшить «К оплате» можно в карточке.</p>' : '') +
          (ready ? '<p class="hint" style="margin:0">Платёжка — на остаток «Не оплачено» каждой заявки. Учредителю уйдёт одно сообщение.</p>' : '') +
          '<ul class="rg-modal-list">' + items.map(function (it) {
            return '<li><span class="num hint">' + esc(it.number) + '</span><span class="rg-ellipsis">' + esc(it.recipient) + '</span><b class="num">' + money(itemKop ? itemKop(it) / 100 : it.amount) + '</b></li>';
          }).join('') + '</ul>' +
          '<div class="rg-modal-actions">' +
            '<button type="button" class="btn ghost" data-m="no">Отмена</button>' +
            '<button type="button" class="btn ' + (decision === 'postponed' ? '' : 'pri') + '" data-m="yes">' + yes + '</button>' +
          '</div>' +
        '</div>';
      var done = function (v) {
        document.removeEventListener('keydown', onKey);
        el.remove();
        document.body.classList.remove('rg-noscroll');
        resolve(v);
      };
      var onKey = function (e) { if (e.key === 'Escape') done(false); };
      el.addEventListener('click', function (e) {
        if (e.target === el) return done(false);
        var b = e.target.closest('[data-m]');
        if (b) done(b.dataset.m === 'yes');
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(el);
      document.body.classList.add('rg-noscroll');
      el.querySelector('[data-m="yes"]').focus();
    });
  }

  // Итог: без пропусков — короткое уведомление; с пропусками или ошибкой —
  // баннер, висит до закрытия.
  function showBulkResult(decision, res, total, errorText) {
    var old = document.getElementById('rg-bulk-result');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'rg-bulk-result';
    el.setAttribute('role', 'status');
    var verb = decision === 'approved' ? 'Одобрено' : decision === 'payment_ready' ? 'Отмечено' : 'Отложено';
    var body;
    if (errorText) {
      el.className = 'rg-bulk-result bad';
      body = 'Не удалось применить: ' + esc(errorText);
    } else {
      var skipped = res.skipped || [];
      el.className = 'rg-bulk-result' + (skipped.length ? ' warn' : ' ok');
      body = '<b>' + verb + ' ' + res.applied.length + ' из ' + total + '</b>' +
        (skipped.length ? '<br>Не удалось: ' + skipped.map(function (s) { return esc(s.number || 'заявка') + ' — ' + esc(s.reason); }).join('; ') : '');
    }
    el.innerHTML = '<span>' + body + '</span><button type="button" class="btn ghost icon" aria-label="Закрыть">✕</button>';
    el.querySelector('button').addEventListener('click', function () { el.remove(); });
    document.body.appendChild(el);
    if (!errorText && !(res.skipped || []).length) setTimeout(function () { el.remove(); }, 4000);
  }

  // «Отменить платёжку»: причина по желанию. null — передумали.
  function askCancelReason() {
    var v = window.prompt('Отменить платёжку? Причина (необязательно) — уйдёт бухгалтеру:', '');
    return v === null ? null : v.trim();
  }

  // ---------- экспорт в Excel (спека payment-registry/export) ----------

  function exportXlsx(listResponse) {
    var items = listResponse.items;
    var S = XlsxWriter.STYLE;
    var origin = location.origin;

    // "Файлы" — по колонке на файл: в Excel одна гиперссылка на ячейку, а
    // ссылка нужна на каждый файл. Колонок столько, сколько файлов у самой
    // "толстой" заявки (минимум одна), общая шапка "Файлы" объединена.
    var filesOf = function (it) {
      var list = it.files.map(function (f) { return { label: f.kindLabel + ': ' + f.name, url: f.url }; });
      it.payments.forEach(function (p) {
        if (p.file) list.push({ label: 'Платёжка ' + ddmmyyyy(p.paidOn) + ': ' + p.file.name, url: p.file.url });
      });
      return list;
    };
    var fileCols = Math.max(1, items.reduce(function (m, it) { return Math.max(m, filesOf(it).length); }, 0));

    var headBefore = ['№ заявки', 'Срок оплаты', 'Заявитель', 'Подразделение', 'Категория', 'Основание', 'Получатель', 'Сумма, ₽', 'Цель расхода', 'Решение по оплате'];
    var headAfter = ['Дата фактической оплаты', 'К оплате, ₽', 'Оплачено, ₽', 'Не оплачено, ₽'];
    var colFiles = headBefore.length; // 0-based индекс первой колонки файлов
    var colAfter = colFiles + fileCols;
    var col = { amount: 7, toPay: colAfter + 1, paid: colAfter + 2, unpaid: colAfter + 3 };

    var sum = { amount: 0, toPay: 0, paid: 0, unpaid: 0 };
    items.forEach(function (it) {
      sum.amount += Math.round(it.amount * 100);
      sum.toPay += Math.round((it.state.toPay || 0) * 100);
      sum.paid += Math.round(it.state.paid * 100);
      sum.unpaid += Math.round(it.state.unpaid * 100);
    });

    var width = colAfter + headAfter.length;
    var blankRow = function (style) { var r = []; for (var i = 0; i < width; i++) r.push({ v: '', style: style }); return r; };

    var totalRow = blankRow(S.DEFAULT);
    totalRow[0] = { v: 'ИТОГО', style: S.HEAD_PLAIN };
    totalRow[2] = { v: 'Всего заявок', style: S.HEAD_PLAIN };
    totalRow[3] = { v: items.length, num: true, style: S.TEXT };
    totalRow[col.amount] = { v: sum.amount / 100, num: true, style: S.NUM };
    totalRow[col.toPay] = { v: sum.toPay / 100, num: true, style: S.NUM };
    totalRow[col.paid] = { v: sum.paid / 100, num: true, style: S.NUM };
    totalRow[col.unpaid] = { v: sum.unpaid / 100, num: true, style: S.NUM };

    var headRow = blankRow(S.HEAD_PLAIN);
    headBefore.forEach(function (h, i) { headRow[i] = { v: h, style: S.HEAD_PLAIN }; });
    headRow[colFiles] = { v: 'Файлы', style: S.HEAD_PLAIN };
    headAfter.forEach(function (h, i) { headRow[colAfter + i] = { v: h, style: S.HEAD_PLAIN }; });

    var hyperlinks = [];
    var dataRows = items.map(function (it, idx) {
      var excelRow = idx + 3;
      var decision = it.state.statusLabel;
      if ((it.decision === 'rejected' || it.decision === 'postponed') && it.decisionComment) decision += ': ' + it.decisionComment;
      var row = [
        { v: it.number, style: S.TEXT },
        { v: ddmmyyyy(it.dueDate), style: S.TEXT },
        { v: it.applicant, style: S.TEXT },
        { v: it.unitName, style: S.TEXT },
        { v: it.categoryName, style: S.TEXT },
        { v: it.basis, style: S.NOTE },
        { v: it.recipient, style: S.TEXT },
        { v: it.amount, num: true, style: S.NUM },
        { v: it.purpose, style: S.NOTE },
        { v: decision, style: S.NOTE }
      ];
      var fl = filesOf(it);
      for (var i = 0; i < fileCols; i++) {
        var f = fl[i];
        if (f) {
          hyperlinks.push({ ref: XlsxWriter.colLetter(colFiles + i) + excelRow, url: origin + f.url });
          row.push({ v: f.label, style: S.LINK });
        } else {
          row.push({ v: '', style: S.TEXT });
        }
      }
      row.push({ v: ddmmyyyy(it.lastPaidOn), style: S.TEXT });
      row.push(it.state.toPay === null ? { v: '', style: S.NUM } : { v: it.state.toPay, num: true, style: S.NUM });
      row.push({ v: it.state.paid, num: true, style: S.NUM });
      row.push({ v: it.state.unpaid, num: true, style: S.NUM });
      return row;
    });

    var colWidths = [12, 12, 16, 16, 16, 28, 26, 14, 36, 22];
    for (var c = 0; c < fileCols; c++) colWidths.push(30);
    colWidths.push(14, 14, 14, 14);
    var merges = fileCols > 1 ? [XlsxWriter.colLetter(colFiles) + '2:' + XlsxWriter.colLetter(colAfter - 1) + '2'] : [];

    var blob = XlsxWriter.build({
      sheetName: 'Реестр оплат',
      rows: [totalRow, headRow].concat(dataRows),
      merges: merges,
      colWidths: colWidths,
      hyperlinks: hyperlinks
    });
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'Реестр оплат ' + ddmmyyyy(localDateStr()) + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- просмотр фото на весь экран ----------

  // Ссылки на документы (PDF, «Открыть» оригинал фото, платёжки). На
  // компьютере — новая вкладка. На телефоне — та же вкладка: на iPhone (Safari
  // и встроенный браузер Telegram) из новой вкладки нет очевидного пути назад,
  // а в той же — работают свайп от левого края и «Назад» Telegram; адрес с
  // #/registry/<номер> возвращает в ту же карточку.
  function isTouch() {
    return Boolean(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  }

  function docTarget() {
    return isTouch() ? '' : ' target="_blank" rel="noopener"';
  }

  // Полноэкранное фото — слой поверх страницы, но с собственным шагом в
  // истории браузера: на телефоне кнопка «Назад» должна закрыть фото, а не
  // увести страницу под ним (баг: слой оставался открытым поверх нового
  // экрана, и фото «открывалось повторно»). pushState без смены адреса —
  // hashchange не срабатывает, роутер ничего не перерисовывает.
  var photoInHistory = false;

  function hidePhoto() {
    var el = document.getElementById('rg-photo');
    if (el) el.hidden = true;
    document.body.classList.remove('rg-noscroll');
  }

  function openPhoto(url, title) {
    var el = document.getElementById('rg-photo');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rg-photo';
      el.className = 'rg-photo';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML =
        '<div class="rg-photo-bar"><span class="rg-photo-title"></span>' +
        '<a class="btn sm ghost-dark rg-photo-open">Открыть</a>' +
        '<button type="button" class="btn sm ghost-dark rg-photo-close" aria-label="Закрыть">✕</button></div>' +
        '<div class="rg-photo-img"><img alt=""></div>' +
        // Большая кнопка внизу — под большой палец: на iPhone ✕ наверху
        // перекрывают «чёлка» и панель Telegram, а аппаратной «Назад» нет.
        '<div class="rg-photo-foot"><button type="button" class="btn rg-photo-done">Закрыть</button>' +
        '<span class="rg-photo-hint">или смахните фото вниз</span></div>';
      document.body.appendChild(el);
      el.querySelector('.rg-photo-close').addEventListener('click', closePhoto);
      el.querySelector('.rg-photo-done').addEventListener('click', closePhoto);
      bindPhotoGestures(el);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !el.hidden) closePhoto();
      });
      // «Назад» (кнопка телефона/браузера) снимает наш шаг истории — закрываем слой.
      window.addEventListener('popstate', function () {
        if (!photoInHistory) return;
        photoInHistory = false;
        hidePhoto();
      });
      // Страница ушла на другой экран при открытом фото (например, по ссылке)
      // — слой не должен остаться висеть поверх нового экрана.
      window.addEventListener('hashchange', function () {
        photoInHistory = false;
        hidePhoto();
      });
    }
    el.querySelector('img').src = url;
    el.querySelector('img').alt = title || 'Фото';
    el.querySelector('.rg-photo-title').textContent = title || '';
    var openLink = el.querySelector('.rg-photo-open');
    openLink.href = url;
    if (isTouch()) { openLink.removeAttribute('target'); openLink.removeAttribute('rel'); }
    else { openLink.target = '_blank'; openLink.rel = 'noopener'; }
    el.hidden = false;
    document.body.classList.add('rg-noscroll');
    if (!photoInHistory) {
      history.pushState({ rgPhoto: true }, '');
      photoInHistory = true;
    }
  }

  // Тап по тёмному фону (мимо фото) и свайп вниз — закрыть. Свайп не
  // мешает масштабированию: при двух пальцах или увеличенной странице
  // (visualViewport.scale > 1) жест не перехватывается.
  function bindPhotoGestures(el) {
    var wrap = el.querySelector('.rg-photo-img');
    var img = wrap.querySelector('img');
    var startX = 0, startY = null, dy = 0;
    var zoomed = function () { return window.visualViewport && window.visualViewport.scale > 1.01; };
    var reset = function () {
      startY = null;
      dy = 0;
      img.style.transition = 'transform .18s ease';
      img.style.transform = '';
      el.style.backgroundColor = '';
    };
    wrap.addEventListener('click', function (e) {
      if (e.target !== img) closePhoto();
    });
    wrap.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || zoomed()) { startY = null; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dy = 0;
      img.style.transition = 'none';
    }, { passive: true });
    wrap.addEventListener('touchmove', function (e) {
      if (startY === null) return;
      if (e.touches.length !== 1 || zoomed()) { reset(); return; }
      var dx = e.touches[0].clientX - startX;
      dy = e.touches[0].clientY - startY;
      if (dy <= 0 || Math.abs(dx) > dy) { img.style.transform = ''; return; }
      img.style.transform = 'translateY(' + dy + 'px)';
      el.style.backgroundColor = 'rgba(17,17,17,' + Math.max(0.35, 1 - dy / 450) + ')';
    }, { passive: true });
    wrap.addEventListener('touchend', function () {
      if (startY === null) return;
      var shouldClose = dy > 90;
      reset();
      if (shouldClose) closePhoto();
    });
    wrap.addEventListener('touchcancel', reset);
  }

  // Закрытие кнопкой ✕ / Escape — убираем и свой шаг истории, иначе
  // следующее «Назад» ничего бы видимо не делало. Сам слой спрячет popstate.
  function closePhoto() {
    if (photoInHistory) history.back();
    else hidePhoto();
  }

  // Миниатюра файла: фото — превью, открывается во весь экран; PDF —
  // ссылка в новой вкладке (на телефоне — встроенный просмотрщик).
  function thumb(f) {
    if (isImage(f)) {
      return '<button type="button" class="rg-thumb" data-photo="' + esc(f.url) + '" data-title="' + esc(f.kindLabel + ': ' + f.name) + '" aria-label="Открыть фото ' + esc(f.name) + '">' +
        '<img src="' + esc(f.url) + '" alt="" loading="lazy"></button>';
    }
    return '<a class="rg-thumb pdf" href="' + esc(f.url) + '"' + docTarget() + ' aria-label="Открыть PDF ' + esc(f.name) + '">PDF</a>';
  }

  // Делегированный обработчик для всех .rg-thumb[data-photo] внутри root.
  function bindThumbs(root) {
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-photo]');
      if (!btn || !root.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      openPhoto(btn.dataset.photo, btn.dataset.title);
    });
  }

  window.Registry = {
    api: api,
    ownerToken: ownerToken,
    isOwnerMode: isOwnerMode,
    esc: esc,
    money: money,
    rub: rub,
    ddmm: ddmm,
    ddmmyyyy: ddmmyyyy,
    tsDate: tsDate,
    localDateStr: localDateStr,
    fileSize: fileSize,
    STATUS_OPTIONS: STATUS_OPTIONS,
    GROUP: GROUP,
    GROUP_LABELS: GROUP_LABELS,
    BULK_GROUPS: BULK_GROUPS,
    FILE_KINDS: FILE_KINDS,
    PERIODS: PERIODS,
    statusChip: statusChip,
    decisionLabel: decisionLabel,
    decisionChip: decisionChip,
    listQuery: listQuery,
    isImage: isImage,
    prepareUpload: prepareUpload,
    exportXlsx: exportXlsx,
    readyAge: readyAge,
    askCancelReason: askCancelReason,
    openPhoto: openPhoto,
    closePhoto: closePhoto,
    thumb: thumb,
    bindThumbs: bindThumbs,
    formHtml: formHtml,
    readForm: readForm,
    bindForm: bindForm,
    docTarget: docTarget,
    createSelection: createSelection,
    copyBtn: copyBtn,
    copyText: copyText,
    toast: toast
  };
})();
