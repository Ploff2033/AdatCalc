(function () {
  // Реестр оплат на телефоне (макеты MobileRegistry / MobilePhoto). Основной
  // пользователь — учредитель по своей ссылке (?owner=..., см. app.js), он
  // только смотрит и принимает решения. admin на телефоне видит тот же экран
  // и вдобавок может внести оплату в карточке; создание и правка заявок —
  // на десктопе (screen-registry.js).
  var R = window.Registry;
  var esc = R.esc;

  var filters = { closed: false, status: '', unit: '', category: '', period: '' };
  var data = null;
  var dicts = { units: [], categories: [] };
  var root = null;
  var bound = false;
  var inCard = false;

  // Пакетное решение (change reestr-bulk): режим выбора на карточках групп
  // «Ожидает решения» и «Отложена», панель внизу, подтверждение — в
  // Registry.createSelection (общий с ПК).
  var sel = R.createSelection({
    onChange: function () {
      if (data && !inCard && document.getElementById('rgm-body')) renderList();
      renderBar();
    },
    onApplied: function () { loadAndRenderList(); }
  });

  function renderBar() {
    var bar = document.getElementById('rgm-bulkbar');
    if (!bar) return;
    bar.innerHTML = inCard ? '' : sel.barHtml();
    // У admin на телефоне снизу своё меню — панель ставим над ним по его
    // реальной высоте (зависит от устройства и safe-area), у учредителя
    // меню нет — панель у самого низа.
    var nav = document.querySelector('.bottom-nav');
    var navH = nav && !R.isOwnerMode() && nav.getClientRects().length ? nav.getBoundingClientRect().height : 0;
    bar.style.bottom = navH + 'px';
    var body = document.getElementById('rgm-body');
    if (body) body.classList.toggle('with-bulkbar', sel.isOn() && !inCard);
  }

  function groupItems(group) {
    return ((data && data.items) || []).filter(function (it) { return it.state.group === group; });
  }

  function canPay() {
    return !R.isOwnerMode() && window.Auth && Auth.isAtLeast('admin');
  }

  function go(number) {
    location.hash = number ? '#/registry/' + encodeURIComponent(number) : '#/registry';
  }

  // ---------- список ----------

  function selectHtml(id, label, opts, current) {
    return '<label class="mf"><span class="mf-l">' + label + '</span><select id="' + id + '" aria-label="' + label + '">' +
      opts.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === current ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') +
      '</select></label>';
  }

  function dictOpts(list) {
    return [{ id: '', label: 'все' }].concat(list.map(function (d) { return { id: d.id, label: d.name }; }));
  }

  function cardHtml(it) {
    var s = it.state;
    var due = it.dueDate ? 'до ' + R.ddmm(it.dueDate) : 'без срока';
    var thumbs = it.files.map(R.thumb).join('');
    var progress = '';
    if (s.status === 'partial') {
      var pct = Math.min(100, Math.round(s.paid / s.toPay * 1000) / 10);
      progress = '<div class="stack" style="gap:4px"><div class="bar"><i style="width:' + pct + '%;background:#2F7A52"></i></div>' +
        '<div class="spread" style="font-size:13px"><span>оплачено <b class="num">' + R.money(s.paid) + '</b></span>' +
        '<span style="color:var(--bad-fg)">не оплачено <b class="num">' + R.money(s.unpaid) + '</b></span></div></div>';
    }
    var picking = sel.isOn() && sel.selectable(it);
    var actions = s.status === 'pending' && !sel.isOn()
      ? '<div class="rgm-actions">' +
          '<button type="button" class="btn sm" data-act="approved" data-id="' + esc(it.id) + '">Одобрить</button>' +
          '<button type="button" class="btn ghost sm" data-act="postponed" data-id="' + esc(it.id) + '">Отложить</button>' +
          '<button type="button" class="btn ghost sm rgm-reject" data-act="rejected" data-id="' + esc(it.id) + '">Отклонить</button>' +
        '</div>' : '';
    var comment = it.decisionComment && (it.decision === 'rejected' || it.decision === 'postponed' || s.status === 'partial')
      ? '<span class="hint">' + esc(it.decisionComment) + '</span>' : '';
    var check = picking
      ? '<span class="rgm-check' + (sel.has(it.id) ? ' on' : '') + '" role="checkbox" aria-checked="' + sel.has(it.id) + '" aria-label="Выбрать ' + esc(it.number) + '"></span>'
      : '';
    return '<article class="rgm-card' + (s.overdue ? ' overdue' : '') + (picking ? ' pickable' : '') + (picking && sel.has(it.id) ? ' picked' : '') + '" data-number="' + esc(it.number) + '" data-id="' + esc(it.id) + '">' +
      '<div class="spread" style="gap:10px"><span class="num" style="font-size:12px">' + check + '<span class="' + (s.overdue ? 'rg-overdue-text' : 'hint') + '">' + due + '</span>' +
        '<span class="hint"> · ' + esc(it.number) + ' · ' + esc(it.unitName) + '</span></span>' + R.statusChip(it) + '</div>' +
      '<div class="rgm-title"><span>' + esc(it.purpose) + '</span><span class="num">' + R.money(it.amount) + '</span></div>' +
      '<span class="hint">' + esc(it.recipient) + ' · ' + esc(it.categoryName) + (it.applicant ? ' · ' + esc(it.applicant) : '') + '</span>' +
      (thumbs ? '<div class="rgm-thumbs">' + thumbs + '</div>' : '') +
      progress + comment + actions +
    '</article>';
  }

  function renderList() {
    inCard = false;
    var t = data.totals;
    var items = data.items;
    var html =
      '<div class="seg" role="group" aria-label="Активные или закрытые" id="rgm-closed">' +
        '<button type="button" data-closed="0" class="' + (!filters.closed ? 'on' : '') + '" aria-pressed="' + !filters.closed + '">Активные</button>' +
        '<button type="button" data-closed="1" class="' + (filters.closed ? 'on' : '') + '" aria-pressed="' + filters.closed + '">Закрытые</button>' +
      '</div>' +
      '<div class="rgm-filters">' +
        selectHtml('rgm-f-status', 'Статус:', R.STATUS_OPTIONS, filters.status) +
        selectHtml('rgm-f-unit', 'Подразд.:', dictOpts(dicts.units), filters.unit) +
        selectHtml('rgm-f-category', 'Категория:', dictOpts(dicts.categories), filters.category) +
        selectHtml('rgm-f-period', 'Создана:', R.PERIODS, filters.period) +
      '</div>';
    if (t) {
      var unpaidTotal = items.reduce(function (a, it) { return a + it.state.unpaid; }, 0);
      html += '<div class="spread rgm-summary"><span>Не оплачено <b class="num">' + R.rub(unpaidTotal) + '</b></span>' +
        (t.overdue.count ? '<span class="rg-overdue-text" style="font-weight:600">просрочено ' + t.overdue.count + '</span>' : '') + '</div>';
    }
    if (!items.length) html += '<p class="empty-state">Заявок нет.</p>';
    var group = null;
    items.forEach(function (it) {
      if (it.state.group !== group) {
        group = it.state.group;
        var g = t.groups[group];
        var bulkBtn = '';
        if ((group === 0 || group === 2) && groupItems(group).some(sel.selectable)) {
          bulkBtn = sel.isOn()
            ? '<button type="button" class="btn ghost sm rgm-sep-btn" data-bulk-group="' + group + '">' + (sel.groupAllPicked(groupItems(group)) ? 'Снять все' : 'Выбрать все') + '</button>'
            : '<button type="button" class="btn ghost sm rgm-sep-btn" data-bulk-enter="1">Выбрать</button>';
        }
        html += '<div class="rgm-sep"><span>' + R.GROUP_LABELS[group] + ' · ' + g.count + '</span>' +
          '<span class="rgm-sep-right">' + (group === 3 ? '' : '<span class="num">' + R.rub(g.sum) + '</span>') + bulkBtn + '</span></div>';
      }
      html += cardHtml(it);
    });
    document.getElementById('rgm-body').innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll('#rgm-closed button'), function (b) {
      b.addEventListener('click', function () {
        filters.closed = b.dataset.closed === '1';
        filters.status = '';
        sel.exit();
        loadAndRenderList();
      });
    });
    [['rgm-f-status', 'status'], ['rgm-f-unit', 'unit'], ['rgm-f-category', 'category'], ['rgm-f-period', 'period']].forEach(function (pair) {
      document.getElementById(pair[0]).addEventListener('change', function () {
        filters[pair[1]] = this.value;
        sel.exit();
        loadAndRenderList();
      });
    });
    renderBar();
  }

  async function loadAndRenderList() {
    try {
      data = await R.api.get('/requests' + R.listQuery(filters));
      renderList();
    } catch (err) {
      document.getElementById('rgm-body').innerHTML = '<p class="banner">Не удалось загрузить реестр: ' + esc(err.message) + '</p>';
    }
  }

  // Решение из списка (спека "Решение с телефона в одно нажатие"):
  // "Одобрить" — вся сумма, "Отложить" — без вопросов, "Отклонить" —
  // спрашивает причину (необязательно; Отмена — ничего не делать).
  async function quickDecision(btn) {
    var body = { decision: btn.dataset.act };
    if (body.decision === 'rejected') {
      var reason = window.prompt('Причина отказа (необязательно):', '');
      if (reason === null) return;
      body.comment = reason;
    }
    btn.disabled = true;
    try {
      await R.api.post('/requests/' + encodeURIComponent(btn.dataset.id) + '/decision', body);
      await loadAndRenderList();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  }

  // ---------- карточка ----------

  function kv(label, value) {
    if (!value) return '';
    return '<div class="rgm-kv"><span>' + label + '</span><span>' + value + '</span></div>';
  }

  function renderCard(it) {
    inCard = true;
    renderBar();
    var s = it.state;
    var hasPayments = it.payments.length > 0;
    var decided = it.decision
      ? '<p class="hint" style="margin:0">Решение от ' + R.tsDate(it.decidedAt) + ': ' + R.decisionChip(it) + (it.decisionComment ? ' — «' + esc(it.decisionComment) + '»' : '') + '</p>' : '';
    var edited = it.editedAfterDecision
      ? '<p class="banner" style="margin:0">Заявка изменена ' + R.tsDate(it.updatedAt) + ' после решения ' + R.tsDate(it.decidedAt) + '.</p>' : '';
    var payments = '';
    if (it.decision === 'approved') {
      payments = '<section class="rgm-panel"><span class="sub">Оплаты</span>' +
        '<div class="rgm-kv"><span>К оплате</span><b class="num">' + R.rub(s.toPay) + '</b></div>' +
        '<div class="rgm-kv"><span>Оплачено</span><b class="num">' + R.rub(s.paid) + '</b></div>' +
        '<div class="rgm-kv"><span>Не оплачено</span><b class="num"' + (s.overdue ? ' style="color:var(--bad-fg)"' : '') + '>' + R.rub(s.unpaid) + '</b></div>' +
        it.payments.map(function (p) {
          return '<div class="rgm-kv"><span class="num">' + R.ddmmyyyy(p.paidOn) + (p.file ? ' · <a href="' + esc(p.file.url) + '"' + R.docTarget() + '>платёжка</a>' : '') + '</span>' +
            '<span class="num">' + R.rub(p.amount) + (canPay() ? ' <button type="button" class="btn ghost icon rgm-del-pay" data-id="' + esc(p.id) + '" aria-label="Удалить оплату">✕</button>' : '') + '</span></div>';
        }).join('') +
        (canPay() && s.unpaid > 0
          ? '<form id="rgm-pay-form" class="stack g8">' +
              '<div class="grid-2" style="grid-template-columns:1fr 1fr"><div class="field"><label for="rgm-pay-date">Дата оплаты</label><input id="rgm-pay-date" type="date" class="inp" style="height:44px" max="' + esc(data.today) + '" value="' + esc(data.today) + '"></div>' +
              '<div class="field"><label for="rgm-pay-amount">Сумма, ₽</label><input id="rgm-pay-amount" class="inp num" inputmode="decimal" style="height:44px"></div></div>' +
              '<button type="submit" class="btn">+ Оплата</button></form>' : '') +
        '<p class="banner" id="rgm-pay-error" hidden></p></section>';
    }
    document.getElementById('rgm-body').innerHTML =
      '<button type="button" class="btn ghost sm" id="rgm-back" style="align-self:flex-start">← Реестр</button>' +
      '<section class="rgm-panel">' +
        '<div class="spread"><span class="num hint">' + esc(it.number) + ' · ' + R.tsDate(it.createdAt) + '</span>' + R.statusChip(it) + '</div>' +
        '<div class="rgm-title" style="font-size:16px"><span>' + esc(it.purpose) + '</span><span class="num" style="font-size:20px">' + R.money(it.amount) + '</span></div>' +
        kv('Получатель', esc(it.recipient)) +
        kv('Подразделение', esc(it.unitName)) +
        kv('Категория', esc(it.categoryName)) +
        kv('Заявитель', esc(it.applicant)) +
        kv('Основание', esc(it.basis)) +
        kv('Срок оплаты', it.dueDate ? '<span' + (s.overdue ? ' class="rg-overdue-text"' : '') + '>до ' + R.ddmmyyyy(it.dueDate) + '</span>' : '') +
        (it.files.length ? '<div class="rgm-thumbs big">' + it.files.map(R.thumb).join('') + '</div>' : '<p class="hint" style="margin:0">Файлов нет.</p>') +
      '</section>' +
      '<section class="rgm-panel"><span class="sub">Решение</span>' + decided + edited +
        '<div class="field"><label for="rgm-dec-amount">К оплате, ₽</label><input id="rgm-dec-amount" class="inp num" inputmode="decimal" style="height:48px;font-size:18px;font-weight:600"></div>' +
        '<div class="field"><label for="rgm-dec-comment">Комментарий (необязательно)</label><input id="rgm-dec-comment" class="inp" style="height:44px" value="' + esc(it.decisionComment) + '"></div>' +
        '<div class="rgm-actions">' +
          '<button type="button" class="btn" data-dec="approved">Одобрить</button>' +
          '<button type="button" class="btn ghost" data-dec="postponed"' + (hasPayments ? ' disabled' : '') + '>Отложить</button>' +
          '<button type="button" class="btn ghost rgm-reject" data-dec="rejected"' + (hasPayments ? ' disabled' : '') + '>Отклонить</button>' +
        '</div>' +
        (hasPayments ? '<p class="hint" style="margin:0">По заявке есть оплаты — можно только изменить «К оплате».</p>' : '') +
        '<p class="banner" id="rgm-dec-error" hidden></p>' +
      '</section>' + payments;

    var decAmount = document.getElementById('rgm-dec-amount');
    NumericInput.attach(decAmount);
    NumericInput.setFormattedValue(decAmount, it.approvedAmount !== null ? it.approvedAmount : it.amount);
    document.getElementById('rgm-back').addEventListener('click', function () { go(null); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-dec]'), function (b) {
      b.addEventListener('click', async function () {
        var body = { decision: b.dataset.dec, comment: document.getElementById('rgm-dec-comment').value };
        if (body.decision === 'approved') body.approvedAmount = decAmount.value;
        b.disabled = true;
        try {
          renderCard(await R.api.post('/requests/' + encodeURIComponent(it.id) + '/decision', body));
        } catch (err) {
          var el = document.getElementById('rgm-dec-error');
          el.textContent = err.message;
          el.hidden = false;
          b.disabled = false;
        }
      });
    });
    var payForm = document.getElementById('rgm-pay-form');
    if (payForm) {
      var payAmount = document.getElementById('rgm-pay-amount');
      NumericInput.attach(payAmount);
      NumericInput.setFormattedValue(payAmount, s.unpaid);
      payForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          renderCard(await R.api.post('/requests/' + encodeURIComponent(it.id) + '/payments', {
            paidOn: document.getElementById('rgm-pay-date').value,
            amount: payAmount.value
          }));
        } catch (err) {
          var el = document.getElementById('rgm-pay-error');
          el.textContent = err.message;
          el.hidden = false;
        }
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.rgm-del-pay'), function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Удалить эту оплату?')) return;
        try { renderCard(await R.api.del('/payments/' + encodeURIComponent(b.dataset.id))); }
        catch (err) { alert(err.message); }
      });
    });
    window.scrollTo(0, 0);
  }

  async function openCard(number) {
    try {
      var item = await R.api.get('/requests/' + encodeURIComponent(number));
      if (!data) data = { today: R.localDateStr(), items: [], totals: null };
      renderCard(item);
    } catch (err) {
      document.getElementById('rgm-body').innerHTML =
        '<button type="button" class="btn ghost sm" id="rgm-back" style="align-self:flex-start">← Реестр</button>' +
        '<p class="banner">' + (err.status === 404 ? 'Заявка ' + esc(number) + ' не найдена.' : esc(err.message)) + '</p>';
      document.getElementById('rgm-back').addEventListener('click', function () { go(null); });
    }
  }

  // ---------- долгое нажатие: вход в режим выбора ----------

  // Как в галерее телефона: зажать карточку ~0,5 с — включается режим выбора
  // и эта заявка сразу отмечается (кнопка «Выбрать» в заголовке группы
  // остаётся — не все знают про зажатие). Pointer events — одинаково для
  // пальца и мыши. Сдвиг пальца больше 10 px — это прокрутка, не зажатие.
  var LONG_PRESS_MS = 500;
  var suppressNextClick = false; // ровно один клик — тот, которым закончилось зажатие

  function bindLongPress(body) {
    var timer = null;
    var start = null;
    var cancel = function () { clearTimeout(timer); timer = null; start = null; };
    body.addEventListener('pointerdown', function (e) {
      suppressNextClick = false;
      if (e.button > 0 || e.target.closest('a, button, select, input, label')) return;
      var card = e.target.closest('.rgm-card');
      if (!card || !data) return;
      var item = data.items.find(function (x) { return x.id === card.dataset.id; });
      if (!item || !sel.selectable(item)) return;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(function () {
        timer = null;
        if (!sel.isOn()) sel.enter();
        if (!sel.has(item.id)) sel.toggle(item);
        suppressNextClick = true;
        if (navigator.vibrate) { try { navigator.vibrate(25); } catch (err) { /* не везде есть */ } }
      }, LONG_PRESS_MS);
    });
    body.addEventListener('pointermove', function (e) {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { body.addEventListener(t, cancel); });
    body.addEventListener('scroll', cancel, { passive: true });
    // Системное меню долгого нажатия («Копировать / Выделить») на карточках не нужно.
    body.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.rgm-card') && !e.target.closest('a, img')) e.preventDefault();
    });
  }

  // ---------- каркас ----------

  function scaffold(container) {
    root = container;
    root.innerHTML =
      '<header class="rgm-head"><div class="stack" style="gap:2px"><span class="rgm-cap">' + (R.isOwnerMode() ? 'Учредитель' : 'Все подразделения') + '</span><h1>Реестр оплат</h1></div>' +
        '<button type="button" class="btn sm rgm-excel" id="rgm-excel">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Excel</button></header>' +
      '<main class="rgm-body" id="rgm-body"><p class="hint">Загрузка…</p></main>' +
      '<div class="rgm-bulkbar-wrap" id="rgm-bulkbar"></div>';
    document.getElementById('rgm-bulkbar').addEventListener('click', function (e) { sel.handleBarClick(e); });
    document.getElementById('rgm-excel').addEventListener('click', async function () {
      try {
        if (!data || !data.totals) data = await R.api.get('/requests' + R.listQuery(filters));
        if (!data.items.length) { alert('Нет заявок для выгрузки по текущим фильтрам.'); return; }
        R.exportXlsx(data);
      } catch (err) { alert(err.message); }
    });
    var body = document.getElementById('rgm-body');
    R.bindThumbs(body);
    bindLongPress(body);
    body.addEventListener('click', function (e) {
      // Клик, которым закончилось долгое нажатие, — уже обработан.
      if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); return; }
      if (e.target.closest('[data-bulk-enter]')) { sel.enter(); return; }
      var grp = e.target.closest('[data-bulk-group]');
      if (grp) { sel.toggleGroup(groupItems(Number(grp.dataset.bulkGroup))); return; }
      var actBtn = e.target.closest('[data-act]');
      if (actBtn) { quickDecision(actBtn); return; }
      if (e.target.closest('a, button, select, input, label')) return;
      var card = e.target.closest('.rgm-card');
      if (!card) return;
      // В режиме выбора тап по выбираемой карточке — отметка, по остальным —
      // как обычно, открыть карточку.
      if (sel.isOn()) {
        var item = data.items.find(function (x) { return x.id === card.dataset.id; });
        if (item && sel.toggle(item)) return;
      }
      go(card.dataset.number);
    });
  }

  // param — номер заявки (#/registry/<номер>) или пусто — список.
  async function show(param, container) {
    if (!bound || root !== container || !document.getElementById('rgm-body')) {
      scaffold(container);
      bound = true;
      try {
        var res = await Promise.all([R.api.get('/units'), R.api.get('/categories')]);
        dicts.units = res[0];
        dicts.categories = res[1];
      } catch (err) { /* фильтры без значений — не критично */ }
    }
    if (param) await openCard(param);
    else await loadAndRenderList();
  }

  window.MobileRegistryScreen = { show: show };
})();
