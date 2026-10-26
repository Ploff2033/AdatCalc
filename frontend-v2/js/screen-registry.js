(function () {
  // Реестр оплат — десктопный экран admin (макеты Payments / PaymentsCard /
  // PaymentsNew). Спеки: openspec/changes/reestr-oplat/specs/payment-registry/*.
  // На телефоне (Viewport.isMobile) тот же маршрут отдаёт мобильный экран
  // (mobile-registry.js) — тот же, что видит учредитель, плюс внесение оплат.
  //
  // Отличия от макета — по решениям интервью: номер DDMMYY-N, а не ЗО-0152;
  // в карточке список оплат (их может быть несколько), а не одно поле
  // "Оплачено"; файлы необязательны, получатель обязателен, есть "Основание".
  var R = window.Registry;
  var esc = R.esc;

  var COLS = '118px minmax(0,1fr) minmax(0,1.7fr) 112px 118px 150px 112px 112px 118px';
  var HEAD_CELLS = '<div>№ · срок</div><div>Заявитель</div><div>Получатель · цель</div><div>Категория</div><div class="r">Сумма</div><div>Статус</div><div class="r">Оплачено</div><div class="r">К оплате</div><div class="r">Не оплачено</div>';

  // Пакетное решение (change reestr-bulk): в режиме выбора слева колонка
  // отметок, внизу панель (Registry.createSelection, общий с телефоном).
  var sel = null;
  function cols() { return (sel && sel.isOn() ? '36px ' : '') + COLS; }

  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap">Все подразделения</span><h1>Реестр оплат</h1></div>' +
      '<div class="page-head-actions"><button class="btn ghost sm" id="rg-export-btn">Экспорт в Excel</button><button class="btn pri sm" id="rg-add-btn">Новая заявка</button></div>' +
    '</div>' +
    '<div class="grid-4" id="rg-tiles" style="gap:12px"></div>' +
    // Автозаполнение из счёта (registry-autofill.js, макет PaymentsDrop) —
    // основной путь ввода; «Новая заявка» в шапке остаётся ручным вводом.
    '<div class="rg-autodrop" id="rg-autodrop" tabindex="0" role="button" aria-label="Перетащите счета или выберите файлы">' +
      '<div class="rg-autodrop-idle"><b>Перетащите счета</b><span class="hint">PDF или фото, до 20 файлов за раз · или вставьте скриншот Ctrl+V</span></div>' +
      '<div class="rg-autodrop-over"><b id="rg-autodrop-over-text">Отпустите, чтобы распознать</b></div>' +
      '<button type="button" class="btn ghost sm" id="rg-autodrop-pick">Выбрать файлы</button>' +
      '<input type="file" id="rg-autodrop-input" multiple accept="application/pdf,image/jpeg,image/png,image/webp" hidden>' +
    '</div>' +
    '<div class="rg-filters">' +
      '<div class="seg" role="group" aria-label="Активные или закрытые" id="rg-closed-seg" style="width:240px">' +
        '<button type="button" data-closed="0" class="on" aria-pressed="true">Активные</button><button type="button" data-closed="1" aria-pressed="false">Закрытые</button>' +
      '</div>' +
      '<label class="rg-filter"><span>Статус</span><select class="inp" id="rg-f-status"></select></label>' +
      '<label class="rg-filter"><span>Подразделение</span><select class="inp" id="rg-f-unit"></select></label>' +
      '<label class="rg-filter"><span>Категория</span><select class="inp" id="rg-f-category"></select></label>' +
      '<label class="rg-filter"><span>Создана</span><select class="inp" id="rg-f-period"></select></label>' +
    '</div>' +
    '<p class="banner" id="rg-load-error" hidden></p>' +
    '<section class="card" style="overflow-x:auto">' +
      '<div style="min-width:1080px">' +
        '<div class="row head" id="rg-head" style="grid-template-columns:' + COLS + '">' + HEAD_CELLS + '</div>' +
        '<div id="rg-rows"></div>' +
        '<p class="empty-state" id="rg-empty" hidden>Заявок не найдено.</p>' +
      '</div>' +
    '</section>' +
    '<div class="rg-bulkbar-wrap desk" id="rg-bulkbar"></div>' +
    '<div class="rg-backdrop" id="rg-backdrop" hidden></div>' +
    '<aside class="drawer rg-drawer" id="rg-drawer" hidden aria-labelledby="rg-drawer-title"></aside>';

  var filters = { closed: false, status: '', unit: '', category: '', period: '' };
  var data = null; // ответ GET /requests
  var dicts = { units: [], categories: [] };
  var drawer = null; // null | { mode: 'new' } | { mode: 'card', item }
  var queue = []; // файлы новой заявки до создания: { file, kind, status, error }
  var newKind = 'invoice';

  // ---------- загрузка ----------

  async function loadDicts() {
    var res = await Promise.all([R.api.get('/units'), R.api.get('/categories')]);
    dicts.units = res[0];
    dicts.categories = res[1];
  }

  async function loadList() {
    var errEl = document.getElementById('rg-load-error');
    try {
      data = await R.api.get('/requests' + R.listQuery(filters));
      errEl.hidden = true;
    } catch (err) {
      data = { items: [], totals: null, today: R.localDateStr() };
      errEl.textContent = 'Не удалось загрузить реестр: ' + err.message;
      errEl.hidden = false;
    }
    renderTiles();
    renderRows();
  }

  // ---------- список ----------

  function options(list, current, allLabel) {
    return '<option value="">' + allLabel + '</option>' + list.map(function (d) {
      return '<option value="' + esc(d.id) + '"' + (d.id === current ? ' selected' : '') + '>' + esc(d.name) + (d.hidden ? ' (скрыто)' : '') + '</option>';
    }).join('');
  }

  function renderFilters() {
    document.getElementById('rg-f-status').innerHTML = R.STATUS_OPTIONS.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === filters.status ? ' selected' : '') + '>' + s.label + '</option>';
    }).join('');
    document.getElementById('rg-f-unit').innerHTML = options(dicts.units, filters.unit, 'все');
    document.getElementById('rg-f-category').innerHTML = options(dicts.categories, filters.category, 'все');
    document.getElementById('rg-f-period').innerHTML = R.PERIODS.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === filters.period ? ' selected' : '') + '>' + p.label + '</option>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#rg-closed-seg button'), function (b) {
      var on = (b.dataset.closed === '1') === filters.closed;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function zayavok(n) { return n + ' ' + plural(n, 'заявка', 'заявки', 'заявок'); }

  function renderTiles() {
    var t = data && data.totals;
    if (!t) { document.getElementById('rg-tiles').innerHTML = ''; return; }
    var periodLabel = (R.PERIODS.find(function (p) { return p.id === filters.period; }) || R.PERIODS[0]).label;
    var tiles = [
      { label: 'Ожидает решения', value: R.rub(t.pending.sum), sub: zayavok(t.pending.count) },
      { label: 'К оплате', value: R.rub(t.toPay.sum), sub: 'одобрено, не оплачено · ' + t.toPay.count },
      { label: 'Просрочено', value: R.rub(t.overdue.sum), sub: zayavok(t.overdue.count), bad: t.overdue.count > 0 },
      { label: 'Оплачено · ' + periodLabel, value: R.rub(t.paid.sum), sub: zayavok(t.paid.count) }
    ];
    document.getElementById('rg-tiles').innerHTML = tiles.map(function (k) {
      return '<div class="card stack g6 rg-tile' + (k.bad ? ' bad' : '') + '"><span class="cap">' + esc(k.label) + '</span>' +
        '<span class="num rg-tile-val">' + k.value + '</span><span class="hint">' + esc(k.sub) + '</span></div>';
    }).join('');
  }

  function dueCell(it) {
    if (!it.dueDate) return '<span class="hint">без срока</span>';
    return '<span class="' + (it.state.overdue ? 'rg-overdue-text' : 'hint') + '">до ' + R.ddmm(it.dueDate) + '</span>';
  }

  function rowHtml(it) {
    var s = it.state;
    var fileCount = it.files.length;
    var comment = (it.decision === 'rejected' || it.decision === 'postponed') && it.decisionComment
      ? '<span class="hint rg-ellipsis">' + esc(it.decisionComment) + '</span>' : '';
    var mark = '';
    if (sel.isOn()) {
      mark = sel.selectable(it)
        ? '<span class="rg-cb' + (sel.has(it.id) ? ' on' : '') + '" role="checkbox" aria-checked="' + sel.has(it.id) + '" aria-label="Выбрать ' + esc(it.number) + '"></span>'
        : '<span></span>';
    }
    var picked = sel.isOn() && sel.has(it.id);
    return '<button type="button" class="row rg-row' + (s.overdue ? ' overdue' : '') + (picked ? ' picked' : '') + '" data-id="' + esc(it.id) + '" style="grid-template-columns:' + cols() + '">' + mark +
      '<div class="stack" style="gap:1px"><span class="num" style="font-weight:600">' + esc(it.number) + '</span>' + dueCell(it) + '</div>' +
      '<div class="stack" style="gap:1px;min-width:0"><span class="rg-ellipsis">' + (esc(it.applicant) || '<span class="hint">—</span>') + '</span><span class="hint rg-ellipsis">' + esc(it.unitName) + '</span></div>' +
      '<div class="stack" style="gap:1px;min-width:0"><span class="rg-ellipsis" style="font-weight:600">' + esc(it.recipient) +
        (fileCount ? ' <span class="rg-filecount" title="Файлов: ' + fileCount + '">' + fileCount + '</span>' : '') + '</span>' +
        '<span class="hint rg-ellipsis">' + esc(it.purpose) + '</span></div>' +
      '<div class="rg-ellipsis">' + esc(it.categoryName) + '</div>' +
      '<div class="r num" style="font-weight:600">' + R.money(it.amount) + '</div>' +
      '<div class="stack" style="gap:2px;align-items:flex-start;min-width:0">' + R.statusChip(it) + comment + '</div>' +
      '<div class="r num">' + (s.paid ? R.money(s.paid) + (it.lastPaidOn ? '<div class="hint">' + R.ddmm(it.lastPaidOn) + '</div>' : '') : '<span class="hint">—</span>') + '</div>' +
      '<div class="r num">' + (s.toPay === null ? '<span class="hint">—</span>' : R.money(s.toPay)) + '</div>' +
      '<div class="r num" style="font-weight:600' + (s.overdue ? ';color:var(--bad-fg)' : '') + '">' + R.money(s.unpaid) + '</div>' +
    '</button>';
  }

  function renderRows() {
    var items = (data && data.items) || [];
    document.getElementById('rg-empty').hidden = items.length > 0;
    var html = '';
    var currentGroup = null;
    items.forEach(function (it) {
      if (it.state.group !== currentGroup) {
        currentGroup = it.state.group;
        var g = data.totals.groups[currentGroup];
        var bulkBtn = '';
        var gi = items.filter(function (x) { return x.state.group === currentGroup; });
        if ((currentGroup === 0 || currentGroup === 2) && gi.some(sel.selectable)) {
          bulkBtn = sel.isOn()
            ? '<button type="button" class="btn ghost sm" data-bulk-group="' + currentGroup + '">' + (sel.groupAllPicked(gi) ? 'Снять все' : 'Выбрать все') + '</button>'
            : '<button type="button" class="btn ghost sm" data-bulk-enter="1">Выбрать</button>';
        }
        html += '<div class="rg-group"><span>' + R.GROUP_LABELS[currentGroup] + ' · ' + g.count + '</span>' +
          '<span class="rg-group-right"><span class="num">' + (currentGroup === 3 ? '' : 'не оплачено ' + R.money(g.sum)) + '</span>' + bulkBtn + '</span></div>';
      }
      html += rowHtml(it);
    });
    if (items.length) {
      var sum = items.reduce(function (a, it) {
        a.amount += it.amount; a.paid += it.state.paid; a.toPay += it.state.toPay || 0; a.unpaid += it.state.unpaid;
        return a;
      }, { amount: 0, paid: 0, toPay: 0, unpaid: 0 });
      html += '<div class="row rg-total" style="grid-template-columns:' + cols() + '">' + (sel.isOn() ? '<div></div>' : '') +
        '<div>Итого</div><div class="hint">' + zayavok(items.length) + '</div><div></div><div></div>' +
        '<div class="r num">' + R.money(sum.amount) + '</div><div></div>' +
        '<div class="r num">' + R.money(sum.paid) + '</div><div class="r num">' + R.money(sum.toPay) + '</div>' +
        '<div class="r num">' + R.money(sum.unpaid) + '</div></div>';
    }
    document.getElementById('rg-rows').innerHTML = html;
    var head = document.getElementById('rg-head');
    head.style.gridTemplateColumns = cols();
    head.innerHTML = (sel.isOn() ? '<div></div>' : '') + HEAD_CELLS;
    document.getElementById('rg-bulkbar').innerHTML = sel.barHtml();
  }

  // ---------- drawer: общее ----------

  function openDrawer(state) {
    drawer = state;
    document.getElementById('rg-drawer').hidden = false;
    document.getElementById('rg-backdrop').hidden = false;
    renderDrawer();
  }

  function closeDrawer() {
    if (drawer && drawer.mode === 'new' && queue.some(function (q) { return q.status === 'uploading'; })) return;
    drawer = null;
    releaseQueue();
    var el = document.getElementById('rg-drawer');
    if (!el) return; // разметка десктопа ещё не собрана (первый заход с телефона)
    el.hidden = true;
    el.innerHTML = '';
    document.getElementById('rg-backdrop').hidden = true;
  }

  // Форма заявки — общая с экраном проверки счетов (Registry.formHtml и т. д.).
  function fieldsHtml(it) { return R.formHtml(it, dicts); }
  function readFields() { return R.readForm(); }
  function bindFields(it) { R.bindForm(it); }

  function showError(id, err) {
    var el = document.getElementById(id);
    if (!el) { alert(err.message || err); return; }
    el.textContent = err.message || String(err);
    el.hidden = false;
  }

  function hideError(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function kindSelect(id, current) {
    return '<select class="inp" id="' + id + '" style="width:130px;height:36px" aria-label="Тип файла">' + R.FILE_KINDS.map(function (k) {
      return '<option value="' + k.id + '"' + (k.id === current ? ' selected' : '') + '>' + k.label + '</option>';
    }).join('') + '</select>';
  }

  function dropzoneHtml() {
    return '<div class="rg-drop" id="rg-drop" tabindex="0">' +
      '<span>Перетащите файлы сюда или вставьте скриншот: <b>Ctrl+V</b></span>' +
      '<div style="display:flex;gap:8px;align-items:center">' + kindSelect('rg-kind', newKind) +
        '<button type="button" class="btn ghost sm" id="rg-pick">Выбрать файлы</button></div>' +
      '<input type="file" id="rg-file-input" multiple accept="image/jpeg,image/png,image/webp,application/pdf" hidden>' +
      '</div><p class="hint" style="margin:0">PDF до 10 МБ или фото, до 10 файлов. Файлы необязательны.</p>';
  }

  function bindDropzone(onFiles) {
    var zone = document.getElementById('rg-drop');
    var input = document.getElementById('rg-file-input');
    document.getElementById('rg-kind').addEventListener('change', function () { newKind = this.value; });
    document.getElementById('rg-pick').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      onFiles(Array.prototype.slice.call(input.files));
      input.value = '';
    });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('over');
      onFiles(Array.prototype.slice.call(e.dataTransfer.files || []));
    });
  }

  // Ctrl+V скриншота — пока открыт drawer (новая заявка или карточка).
  function pastedImages(e) {
    var files = [];
    Array.prototype.forEach.call((e.clipboardData && e.clipboardData.items) || [], function (item) {
      if (item.kind === 'file' && /^image\//.test(item.type)) {
        var f = item.getAsFile();
        if (f) files.push(new File([f], 'Скриншот ' + new Date().toLocaleString('ru-RU').replace(/[/:]/g, '-') + '.png', { type: f.type }));
      }
    });
    return files;
  }

  function onPaste(e) {
    // Не открыта ни форма, ни карточка — скриншот счёта идёт в автозаполнение.
    if (!drawer && document.getElementById('rg-autodrop') && !document.getElementById('rg-autodrop').closest('[hidden]') &&
        !(window.Viewport && Viewport.isMobile())) {
      var shots = pastedImages(e);
      if (shots.length) { e.preventDefault(); RegistryAutofill.add(shots); }
      return;
    }
    if (!drawer || !document.getElementById('rg-drop')) return;
    var files = [];
    Array.prototype.forEach.call((e.clipboardData && e.clipboardData.items) || [], function (item) {
      if (item.kind === 'file' && /^image\//.test(item.type)) {
        var f = item.getAsFile();
        if (f) files.push(new File([f], 'Скриншот ' + new Date().toLocaleString('ru-RU').replace(/[/:]/g, '-') + '.png', { type: f.type }));
      }
    });
    if (!files.length) return;
    e.preventDefault();
    if (drawer.mode === 'new') addToQueue(files);
    else uploadNow(files);
  }

  // ---------- drawer: новая заявка ----------

  // url — локальная ссылка на выбранный файл (blob:), чтобы его можно было
  // открыть ещё ДО создания заявки: фото — во весь экран, PDF — в новой
  // вкладке встроенным просмотрщиком браузера. Освобождается в releaseQueue().
  function addToQueue(files) {
    files.forEach(function (f) {
      queue.push({ file: f, kind: newKind, status: 'queued', error: '', url: URL.createObjectURL(f) });
    });
    renderQueue();
  }

  function releaseQueue() {
    queue.forEach(function (q) { if (q.url) URL.revokeObjectURL(q.url); });
    queue = [];
  }

  function queueThumb(q) {
    var title = q.file.name;
    if (/^image\//.test(q.file.type)) {
      return '<button type="button" class="rg-thumb" data-photo="' + esc(q.url) + '" data-title="' + esc(title) + '" aria-label="Посмотреть ' + esc(title) + '">' +
        '<img src="' + esc(q.url) + '" alt=""></button>';
    }
    return '<a class="rg-thumb pdf" href="' + esc(q.url) + '" target="_blank" rel="noopener" aria-label="Открыть ' + esc(title) + '">PDF</a>';
  }

  function renderQueue() {
    var el = document.getElementById('rg-queue');
    if (!el) return;
    el.innerHTML = queue.map(function (q, i) {
      var st = q.status === 'uploading' ? '<span class="hint">загрузка…</span>'
        : q.status === 'done' ? '<span class="chip ok">загружен</span>'
        : q.status === 'error' ? '<span class="rg-overdue-text">' + esc(q.error) + '</span>' : '';
      var kindLabel = (R.FILE_KINDS.find(function (k) { return k.id === q.kind; }) || {}).label;
      return '<div class="rg-file">' +
        queueThumb(q) +
        '<span class="stack" style="min-width:0"><span class="rg-ellipsis" style="font-weight:600">' + esc(q.file.name) + '</span>' +
        '<span class="hint">' + esc(kindLabel) + ' · ' + R.fileSize(q.file.size) + '</span>' + st + '</span>' +
        (q.status === 'error' && drawer.createdId ? '<button type="button" class="btn ghost sm rg-retry" data-i="' + i + '">Повторить</button>' : '') +
        (q.status === 'queued' || (q.status === 'error' && !drawer.createdId) ? '<button type="button" class="btn ghost icon rg-unqueue" data-i="' + i + '" aria-label="Убрать файл">✕</button>' : '') +
      '</div>';
    }).join('');
  }

  function renderNew() {
    var el = document.getElementById('rg-drawer');
    el.innerHTML =
      '<div class="drawer-head"><div class="stack" style="gap:2px"><span class="cap">№ присвоится при создании · ' + R.ddmmyyyy(R.localDateStr()) + '</span><h2 id="rg-drawer-title">Новая заявка на оплату</h2></div>' +
        '<button type="button" class="btn ghost icon" id="rg-close" aria-label="Закрыть">✕</button></div>' +
      '<form id="rg-new-form" class="stack" style="flex:1">' +
        '<div class="drawer-body">' + fieldsHtml(null) +
          '<div class="field"><span class="lbl-like">Файлы (счёт, договор)</span>' + dropzoneHtml() + '<div id="rg-queue" class="stack g6"></div></div>' +
        '</div>' +
        '<div class="drawer-foot"><p class="banner" id="rg-new-error" hidden></p>' +
          '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px"><button type="button" class="btn ghost" id="rg-cancel">Отмена</button><button type="submit" class="btn pri" id="rg-create-btn">Создать заявку</button></div>' +
        '</div>' +
      '</form>';
    bindFields(null);
    bindDropzone(addToQueue);
    renderQueue();
    document.getElementById('rg-close').addEventListener('click', closeDrawer);
    document.getElementById('rg-cancel').addEventListener('click', closeDrawer);
    document.getElementById('rg-queue').addEventListener('click', function (e) {
      var un = e.target.closest('.rg-unqueue');
      if (un) {
        var removed = queue.splice(Number(un.dataset.i), 1)[0];
        if (removed && removed.url) URL.revokeObjectURL(removed.url);
        renderQueue();
        return;
      }
      var retry = e.target.closest('.rg-retry');
      if (retry) uploadQueueItem(queue[Number(retry.dataset.i)]).then(afterQueue);
    });
    document.getElementById('rg-new-form').addEventListener('submit', handleCreate);
    document.getElementById('rg-i-unit').focus();
  }

  async function uploadQueueItem(q) {
    q.status = 'uploading';
    renderQueue();
    try {
      var prepared = await R.prepareUpload(q.file);
      await R.api.upload('/requests/' + encodeURIComponent(drawer.createdId) + '/files', prepared.blob, { kind: q.kind, name: prepared.name });
      q.status = 'done';
    } catch (err) {
      q.status = 'error';
      q.error = err.message;
    }
    renderQueue();
  }

  // Все загружены — открываем карточку созданной заявки; есть ошибки —
  // остаёмся на форме с кнопками "Повторить" (заявка уже создана).
  async function afterQueue() {
    if (queue.some(function (q) { return q.status !== 'done'; })) return;
    var id = drawer.createdId;
    releaseQueue();
    var item = await R.api.get('/requests/' + encodeURIComponent(id));
    openDrawer({ mode: 'card', item: item });
    loadList();
  }

  async function handleCreate(e) {
    e.preventDefault();
    hideError('rg-new-error');
    var btn = document.getElementById('rg-create-btn');
    if (drawer.createdId) return; // уже создана — дальше только "Повторить" у файлов
    btn.disabled = true;
    try {
      var created = await R.api.post('/requests', readFields());
      drawer.createdId = created.id;
      btn.textContent = 'Заявка ' + created.number + ' создана';
      Array.prototype.forEach.call(document.querySelectorAll('#rg-new-form input, #rg-new-form select, #rg-new-form textarea'), function (x) { x.disabled = true; });
      for (var i = 0; i < queue.length; i++) await uploadQueueItem(queue[i]);
      if (queue.some(function (q) { return q.status === 'error'; })) {
        showError('rg-new-error', new Error('Заявка ' + created.number + ' создана, но часть файлов не загрузилась — нажмите «Повторить» или закройте и добавьте их в карточке.'));
        loadList();
        return;
      }
      await afterQueue();
    } catch (err) {
      showError('rg-new-error', err);
      if (!drawer.createdId) btn.disabled = false;
    }
  }

  // ---------- drawer: карточка заявки ----------

  async function refreshCard(item) {
    if (!item) item = await R.api.get('/requests/' + encodeURIComponent(drawer.item.id));
    drawer.item = item;
    renderCard();
    loadList();
  }

  // Действие с карточкой: ошибки — в баннер своего блока, успех — свежая карточка.
  function act(errorId, fn) {
    return async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      hideError(errorId);
      var btn = e && e.currentTarget && e.currentTarget.tagName === 'BUTTON' ? e.currentTarget : null;
      if (btn) btn.disabled = true;
      try {
        var res = await fn();
        await refreshCard(res && res.id ? res : null);
      } catch (err) {
        showError(errorId, err);
        if (btn) btn.disabled = false;
      }
    };
  }

  async function uploadNow(files) {
    var it = drawer.item;
    hideError('rg-files-error');
    for (var i = 0; i < files.length; i++) {
      try {
        var prepared = await R.prepareUpload(files[i]);
        await R.api.upload('/requests/' + encodeURIComponent(it.id) + '/files', prepared.blob, { kind: newKind, name: prepared.name });
      } catch (err) {
        showError('rg-files-error', new Error(files[i].name + ': ' + err.message));
      }
    }
    var errText = document.getElementById('rg-files-error');
    var keep = errText && !errText.hidden ? errText.textContent : '';
    await refreshCard();
    if (keep) showError('rg-files-error', new Error(keep));
  }

  function filesListHtml(it) {
    if (!it.files.length) return '<p class="hint" style="margin:0">Файлов нет.</p>';
    return it.files.map(function (f) {
      return '<div class="rg-file">' + R.thumb(f) +
        '<span class="stack" style="min-width:0"><a class="rg-ellipsis" style="font-weight:600" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' +
        '<span class="hint">' + esc(f.kindLabel) + ' · ' + R.fileSize(f.size) + '</span></span>' +
        '<button type="button" class="btn ghost icon rg-del-file" data-id="' + esc(f.id) + '" aria-label="Удалить файл ' + esc(f.name) + '">✕</button>' +
      '</div>';
    }).join('');
  }

  function decisionHtml(it) {
    var s = it.state;
    var info = it.decision
      ? '<p class="hint" style="margin:0">Решение от ' + R.tsDate(it.decidedAt) + ': ' + R.decisionChip(it) +
        (it.decisionComment ? ' — «' + esc(it.decisionComment) + '»' : '') + '</p>'
      : '<p class="hint" style="margin:0">Решения ещё нет.</p>';
    var edited = it.editedAfterDecision
      ? '<p class="banner" style="margin:0">Заявка изменена ' + R.tsDate(it.updatedAt) + ' после решения ' + R.tsDate(it.decidedAt) + '.</p>' : '';
    var hasPayments = it.payments.length > 0;
    var cur = drawer.decisionDraft || (it.decision || 'approved');
    return '<div class="rg-block"><div class="rg-block-h"><h3>Решение</h3>' + R.statusChip(it) + '</div>' + info + edited +
      '<div class="seg" role="group" aria-label="Решение" id="rg-dec-seg">' +
        [['approved', 'Одобрить'], ['postponed', 'Отложить'], ['rejected', 'Отклонить']].map(function (d) {
          var disabled = hasPayments && d[0] !== 'approved';
          return '<button type="button" data-dec="' + d[0] + '" class="' + (cur === d[0] ? 'on' : '') + '" aria-pressed="' + (cur === d[0]) + '"' + (disabled ? ' disabled title="По заявке есть оплаты"' : '') + '>' + d[1] + '</button>';
        }).join('') +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="field" id="rg-dec-amount-field"' + (cur === 'approved' ? '' : ' hidden') + '><label for="rg-dec-amount">К оплате, ₽</label><input id="rg-dec-amount" class="inp num" inputmode="decimal"></div>' +
        '<div class="field"><label for="rg-dec-comment">Комментарий (необязательно)</label><input id="rg-dec-comment" class="inp" value="' + esc(it.decisionComment) + '"></div>' +
      '</div>' +
      '<p class="banner" id="rg-dec-error" hidden></p>' +
      '<button type="button" class="btn" id="rg-dec-save">Сохранить решение</button>' +
    '</div>';
  }

  function paymentsHtml(it) {
    var s = it.state;
    if (it.decision !== 'approved') return '';
    var rows = it.payments.map(function (p) {
      return '<div class="rg-pay">' +
        '<span class="num">' + R.ddmmyyyy(p.paidOn) + '</span>' +
        '<span class="num r" style="font-weight:600">' + R.rub(p.amount) + '</span>' +
        '<span class="rg-ellipsis">' + (p.file
          ? '<a href="' + esc(p.file.url) + '" target="_blank" rel="noopener">' + esc(p.file.name) + '</a>'
          : '<button type="button" class="btn ghost sm rg-pay-file" data-id="' + esc(p.id) + '">Прикрепить платёжку</button>') + '</span>' +
        '<button type="button" class="btn ghost icon rg-del-pay" data-id="' + esc(p.id) + '" aria-label="Удалить оплату">✕</button>' +
      '</div>';
    }).join('');
    var pct = s.toPay ? Math.min(100, Math.round(s.paid / s.toPay * 1000) / 10) : 0;
    return '<div class="rg-block"><div class="rg-block-h"><h3>Оплаты</h3></div>' +
      '<div class="rg-sums"><span>К оплате <b class="num">' + R.rub(s.toPay) + '</b></span><span>Оплачено <b class="num">' + R.rub(s.paid) + '</b></span>' +
        '<span' + (s.unpaid > 0 && s.overdue ? ' class="rg-overdue-text"' : '') + '>Не оплачено <b class="num">' + R.rub(s.unpaid) + '</b></span></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:#2F7A52"></i></div>' +
      (rows || '<p class="hint" style="margin:0">Оплат пока нет.</p>') +
      (s.unpaid > 0
        ? '<form id="rg-pay-form" class="rg-pay-add">' +
            '<div class="field"><label for="rg-pay-date">Дата оплаты</label><input id="rg-pay-date" type="date" class="inp" max="' + esc(data ? data.today : R.localDateStr()) + '" value="' + esc(data ? data.today : R.localDateStr()) + '"></div>' +
            '<div class="field"><label for="rg-pay-amount">Сумма, ₽</label><input id="rg-pay-amount" class="inp num" inputmode="decimal"></div>' +
            '<button type="submit" class="btn" style="align-self:end">+ Оплата</button>' +
          '</form>' : '') +
      '<p class="banner" id="rg-pay-error" hidden></p>' +
      '<input type="file" id="rg-pay-file-input" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>' +
    '</div>';
  }

  function renderCard() {
    var it = drawer.item;
    var el = document.getElementById('rg-drawer');
    el.innerHTML =
      '<div class="drawer-head"><div class="stack" style="gap:2px"><span class="cap">' + esc(it.number) + ' · создана ' + R.tsDate(it.createdAt) + '</span>' +
        '<h2 id="rg-drawer-title" class="rg-ellipsis">' + esc(it.recipient) + '</h2></div>' +
        '<button type="button" class="btn ghost icon" id="rg-close" aria-label="Закрыть">✕</button></div>' +
      '<div class="drawer-body">' +
        decisionHtml(it) +
        paymentsHtml(it) +
        '<div class="rg-block"><div class="rg-block-h"><h3>Файлы</h3><span class="hint">' + it.files.length + ' из 10</span></div>' +
          filesListHtml(it) + (it.files.length < 10 ? dropzoneHtml() : '') +
          '<p class="banner" id="rg-files-error" hidden></p></div>' +
        '<form id="rg-edit-form" class="rg-block"><div class="rg-block-h"><h3>Заявка</h3></div>' + fieldsHtml(it) +
          '<p class="banner" id="rg-edit-error" hidden></p>' +
          '<button type="submit" class="btn ghost">Сохранить изменения</button></form>' +
      '</div>' +
      '<div class="drawer-foot"><p class="banner" id="rg-del-error" hidden></p>' +
        '<button type="button" class="btn danger" id="rg-del-req">Удалить заявку</button></div>';

    document.getElementById('rg-close').addEventListener('click', closeDrawer);
    bindFields(it);

    // решение
    var decAmount = document.getElementById('rg-dec-amount');
    NumericInput.attach(decAmount);
    NumericInput.setFormattedValue(decAmount, it.approvedAmount !== null ? it.approvedAmount : it.amount);
    Array.prototype.forEach.call(document.querySelectorAll('#rg-dec-seg button'), function (b) {
      b.addEventListener('click', function () {
        drawer.decisionDraft = b.dataset.dec;
        Array.prototype.forEach.call(document.querySelectorAll('#rg-dec-seg button'), function (x) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
        document.getElementById('rg-dec-amount-field').hidden = b.dataset.dec !== 'approved';
      });
    });
    document.getElementById('rg-dec-save').addEventListener('click', act('rg-dec-error', function () {
      var dec = drawer.decisionDraft || it.decision || 'approved';
      var body = { decision: dec, comment: document.getElementById('rg-dec-comment').value };
      if (dec === 'approved') body.approvedAmount = decAmount.value;
      drawer.decisionDraft = null;
      return R.api.post('/requests/' + encodeURIComponent(it.id) + '/decision', body);
    }));

    // оплаты
    var payForm = document.getElementById('rg-pay-form');
    if (payForm) {
      var payAmount = document.getElementById('rg-pay-amount');
      NumericInput.attach(payAmount);
      NumericInput.setFormattedValue(payAmount, it.state.unpaid);
      payForm.addEventListener('submit', act('rg-pay-error', function () {
        return R.api.post('/requests/' + encodeURIComponent(it.id) + '/payments', {
          paidOn: document.getElementById('rg-pay-date').value,
          amount: payAmount.value
        });
      }));
    }
    var payFileInput = document.getElementById('rg-pay-file-input');
    if (payFileInput) {
      payFileInput.addEventListener('change', function () {
        var f = payFileInput.files[0];
        var paymentId = payFileInput.dataset.paymentId;
        payFileInput.value = '';
        if (!f) return;
        act('rg-pay-error', async function () {
          var prepared = await R.prepareUpload(f);
          return R.api.upload('/payments/' + encodeURIComponent(paymentId) + '/file', prepared.blob, { name: prepared.name });
        })();
      });
    }

    // файлы
    if (document.getElementById('rg-drop')) bindDropzone(uploadNow);

    // правка полей
    document.getElementById('rg-edit-form').addEventListener('submit', act('rg-edit-error', function () {
      return R.api.put('/requests/' + encodeURIComponent(it.id), readFields());
    }));

    document.getElementById('rg-del-req').addEventListener('click', async function () {
      if (!confirm('Удалить заявку ' + it.number + ' вместе с файлами?')) return;
      hideError('rg-del-error');
      try {
        await R.api.del('/requests/' + encodeURIComponent(it.id));
        closeDrawer();
        loadList();
      } catch (err) {
        showError('rg-del-error', err);
      }
    });
  }

  // Делегированные клики карточки — навешиваются ОДИН раз в init() на
  // постоянный #rg-drawer (renderCard() перерисовывает только содержимое,
  // иначе обработчики копились бы и действия выполнялись по нескольку раз).
  function onDrawerClick(e) {
    if (!drawer || drawer.mode !== 'card') return;
    var payFileInput = document.getElementById('rg-pay-file-input');
    var delPay = e.target.closest('.rg-del-pay');
    if (delPay) {
      if (!confirm('Удалить эту оплату? Остаток «Не оплачено» пересчитается.')) return;
      act('rg-pay-error', function () { return R.api.del('/payments/' + encodeURIComponent(delPay.dataset.id)); })();
      return;
    }
    var payFile = e.target.closest('.rg-pay-file');
    if (payFile && payFileInput) {
      payFileInput.dataset.paymentId = payFile.dataset.id;
      payFileInput.click();
      return;
    }
    var delFile = e.target.closest('.rg-del-file');
    if (delFile) {
      if (!confirm('Удалить файл? Ссылка на него перестанет открываться.')) return;
      act('rg-files-error', function () { return R.api.del('/files/' + encodeURIComponent(delFile.dataset.id)); })();
    }
  }

  function renderDrawer() {
    if (!drawer) return;
    if (drawer.mode === 'new') renderNew();
    else renderCard();
  }

  // ---------- зона «Перетащите счета» ----------

  function bindAutodrop() {
    var zone = document.getElementById('rg-autodrop');
    var input = document.getElementById('rg-autodrop-input');
    var overText = document.getElementById('rg-autodrop-over-text');
    var depth = 0;
    var count = function (e) {
      var items = e.dataTransfer && e.dataTransfer.items;
      return items ? Array.prototype.filter.call(items, function (i) { return i.kind === 'file'; }).length : 0;
    };
    document.getElementById('rg-autodrop-pick').addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files);
      input.value = '';
      RegistryAutofill.add(files);
    });
    zone.addEventListener('dragenter', function (e) {
      e.preventDefault();
      depth++;
      var n = count(e);
      overText.textContent = n ? 'Отпустите, чтобы распознать ' + n + ' ' + plural(n, 'счёт', 'счёта', 'счетов') : 'Отпустите, чтобы распознать';
      zone.classList.add('over');
    });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); });
    zone.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; zone.classList.remove('over'); } });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      zone.classList.remove('over');
      RegistryAutofill.add(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []));
    });
    RegistryAutofill.onDone(function () { loadList(); });
  }

  // ---------- каркас ----------

  var documentBound = false;
  function init() {
    document.getElementById('page-registry').innerHTML = HTML;
    sel = R.createSelection({
      onChange: function () { renderRows(); },
      onApplied: function () { loadList(); }
    });
    document.getElementById('rg-add-btn').addEventListener('click', function () {
      releaseQueue();
      openDrawer({ mode: 'new' });
    });
    document.getElementById('rg-export-btn').addEventListener('click', function () {
      if (!data || !data.items.length) { alert('Нет заявок для выгрузки по текущим фильтрам.'); return; }
      R.exportXlsx(data);
    });
    document.getElementById('rg-backdrop').addEventListener('click', closeDrawer);
    bindAutodrop();
    var drawerEl = document.getElementById('rg-drawer');
    drawerEl.addEventListener('click', onDrawerClick);
    R.bindThumbs(drawerEl);
    // Слушатели на document — один раз за жизнь страницы: init() вызывается
    // повторно при переходе телефон → десктоп (пересборка разметки).
    if (!documentBound) {
      document.addEventListener('keydown', function (e) {
        var photo = document.getElementById('rg-photo');
        if (e.key === 'Escape' && drawer && !(photo && !photo.hidden)) closeDrawer();
      });
      document.addEventListener('paste', onPaste);
      documentBound = true;
    }
    Array.prototype.forEach.call(document.querySelectorAll('#rg-closed-seg button'), function (b) {
      b.addEventListener('click', function () {
        filters.closed = b.dataset.closed === '1';
        filters.status = '';
        sel.exit();
        renderFilters();
        loadList();
      });
    });
    [['rg-f-status', 'status'], ['rg-f-unit', 'unit'], ['rg-f-category', 'category'], ['rg-f-period', 'period']].forEach(function (pair) {
      document.getElementById(pair[0]).addEventListener('change', function () {
        filters[pair[1]] = this.value;
        sel.exit();
        loadList();
      });
    });
    document.getElementById('rg-bulkbar').addEventListener('click', function (e) { sel.handleBarClick(e); });
    document.getElementById('rg-rows').addEventListener('click', function (e) {
      if (e.target.closest('[data-bulk-enter]')) { sel.enter(); return; }
      var grp = e.target.closest('[data-bulk-group]');
      if (grp) {
        var g = Number(grp.dataset.bulkGroup);
        sel.toggleGroup(data.items.filter(function (x) { return x.state.group === g; }));
        return;
      }
      var row = e.target.closest('.rg-row');
      if (!row) return;
      var item = data.items.find(function (x) { return x.id === row.dataset.id; });
      if (!item) return;
      // В режиме выбора клик по выбираемой строке — отметка, по остальным —
      // как обычно, карточка.
      if (sel.isOn() && sel.toggle(item)) return;
      // Сразу показываем данные из списка, но тут же берём свежие с сервера:
      // список мог загрузиться раньше, чем догрузился файл (автозаполнение
      // догружает счёт в фоне) — иначе карточка показала бы «Файлов нет».
      openDrawer({ mode: 'card', item: item });
      R.api.get('/requests/' + encodeURIComponent(item.id)).then(function (fresh) {
        if (drawer && drawer.mode === 'card' && drawer.item.id === fresh.id) { drawer.item = fresh; renderCard(); }
      }).catch(function () {});
    });
  }

  // param — номер заявки из #/registry/<номер> (ссылка из Telegram).
  var renderedMode = null;
  async function show(param) {
    if (window.Viewport && Viewport.isMobile()) {
      if (renderedMode === 'desktop') closeDrawer();
      renderedMode = 'mobile';
      MobileRegistryScreen.show(param, document.getElementById('page-registry'));
      return;
    }
    if (renderedMode !== 'desktop') { init(); renderedMode = 'desktop'; }
    try { await loadDicts(); } catch (err) { /* фильтры останутся пустыми, список покажет ошибку */ }
    renderFilters();
    await loadList();
    if (param) {
      try { openDrawer({ mode: 'card', item: await R.api.get('/requests/' + encodeURIComponent(param)) }); }
      catch (err) { alert('Заявка ' + param + ' не найдена'); }
    }
  }

  window.RegistryScreen = { show: show };
})();
