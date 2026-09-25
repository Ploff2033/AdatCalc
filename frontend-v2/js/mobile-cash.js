(function () {
  // ДДС мобильный (макеты MobileCashForm/MobileCashIncome/MobileCashHistory
  // .dc.html) — три доски макета объединены в один экран с внутренним
  // переключателем "Новая запись/История" + сегментом "Расход/Доход"
  // внутри формы, а не три отдельных роута: у router.js/bottom-nav и так
  // один пункт "ДДС" (как и на самих макетах — там переключение через
  // внутренние ссылки экрана, а не через нижний бар). Основной сценарий —
  // анонимный работник по токену, см. app.js/router.js (единственный
  // экран v2 без ограничения роли).
  var HTML =
    '<div class="mobile-page">' +
      '<div style="display:flex;gap:6px">' +
        '<button type="button" class="btn sm" id="mc-tab-form" style="flex:1;height:40px">Новая запись</button>' +
        '<button type="button" class="btn ghost sm" id="mc-tab-history" style="flex:1;height:40px">История</button>' +
      '</div>' +
      '<div id="mc-form-section" class="stack g12">' +
        '<div class="seg" role="group" aria-label="Тип операции" id="mc-type-seg"><button type="button" data-type="expense" class="on" aria-pressed="true">Расход</button><button type="button" data-type="income" aria-pressed="false">Доход</button></div>' +
        '<span class="sub">Категория</span>' +
        '<div class="grid-2" id="mc-category-grid" style="gap:8px"></div>' +
        '<div id="mc-order-field" hidden><span class="sub">Заказ</span><div id="mc-order-list" class="stack g8" style="margin-top:6px"></div></div>' +
        '<div class="field"><label for="mc-cash-amount">Сумма</label><div class="unit"><input id="mc-cash-amount" class="inp num" style="height:56px;font-size:24px;font-weight:600" inputmode="decimal"><span>₽</span></div>' +
          '<div id="mc-order-hint" class="hint" hidden></div>' +
        '</div>' +
        '<div class="field"><label for="mc-cash-date">Дата</label><input id="mc-cash-date" type="date" class="inp" style="height:48px"></div>' +
        '<div class="field" id="mc-receipt-field"><label>Фото чека <span class="req" id="mc-receipt-req">*</span></label>' +
          '<div id="mc-receipt-preview" class="hint">Не прикреплено</div>' +
          '<input type="file" id="mc-receipt-input" accept="image/*" capture="environment" class="inp" style="padding:8px">' +
        '</div>' +
        '<div class="field"><label for="mc-cash-comment">Комментарий <span class="req" id="mc-comment-req">*</span></label><textarea id="mc-cash-comment" class="inp" style="height:72px;padding:10px 12px;resize:none"></textarea></div>' +
        '<p class="banner" id="mc-cash-error" hidden></p>' +
        '<button type="button" class="btn ghost sm" id="mc-cancel-edit-btn" style="height:44px" hidden>Отменить редактирование</button>' +
        '<button type="button" class="btn pri" id="mc-cash-save-btn" style="height:52px;width:100%;font-size:16px">Сохранить</button>' +
      '</div>' +
      '<div id="mc-history-section" class="stack g12" hidden>' +
        '<div id="mc-history-status" role="status" hidden></div>' +
        '<div id="mc-history-list" class="stack g12"></div>' +
        '<p class="empty-state" id="mc-history-empty" hidden>Записей пока нет.</p>' +
      '</div>' +
    '</div>';

  var EXPENSE_CATEGORIES = [
    { id: 'fuel', label: 'Топливо', receiptRequired: true, commentRequired: false },
    { id: 'salary', label: 'ЗП', receiptRequired: false, commentRequired: true },
    { id: 'parts', label: 'Автозапчасти', receiptRequired: true, commentRequired: false },
    { id: 'other', label: 'Другое', receiptRequired: false, commentRequired: true }
  ];
  var INCOME_CATEGORIES = [
    { id: 'concrete_sale', label: 'Продажа бетона', receiptRequired: false, commentRequired: false },
    { id: 'other', label: 'Прочее', receiptRequired: false, commentRequired: true }
  ];
  var CATEGORY_LABELS = {};
  EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES).forEach(function (c) { CATEGORY_LABELS[c.id] = c.label; });
  CATEGORY_LABELS.storno = 'Сторно';

  function categoriesFor(type) { return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES; }
  function categoryRule(type, id) {
    var found = categoriesFor(type).filter(function (c) { return c.id === id; })[0];
    return found || { id: id, label: CATEGORY_LABELS[id] || id, receiptRequired: false, commentRequired: false };
  }

  var activeTab = 'form';
  var draftType = 'expense';
  var draftCategory = 'fuel';
  var draftOrderId = null;
  var draftReceiptDataUrl = null;
  var editingId = null;
  var entries = [];

  function queryString() {
    var role = Auth.getRole();
    if (role) return '?plantId=' + encodeURIComponent(Plant.currentPlantId());
    var token = Plant.currentToken();
    return token ? '?token=' + encodeURIComponent(token) : '';
  }

  async function loadEntries() {
    try { entries = await Api.get('/cash-entries' + queryString()); }
    catch (err) { entries = []; }
  }

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('mc-form-section').hidden = tab !== 'form';
    document.getElementById('mc-history-section').hidden = tab !== 'history';
    document.getElementById('mc-tab-form').className = 'btn sm' + (tab === 'form' ? '' : ' ghost');
    document.getElementById('mc-tab-history').className = 'btn sm' + (tab === 'history' ? '' : ' ghost');
    if (tab === 'history') renderHistory();
  }

  // ---- Форма ----
  function renderCategoryGrid() {
    var grid = document.getElementById('mc-category-grid');
    grid.innerHTML = categoriesFor(draftType).map(function (c) {
      return '<button type="button" class="cat' + (c.id === draftCategory ? ' on' : '') + '" data-cat="' + c.id + '" aria-pressed="' + (c.id === draftCategory) + '">' + c.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('.cat'), function (btn) {
      btn.addEventListener('click', function () { draftCategory = btn.dataset.cat; applyCategoryRules(); });
    });
  }

  function applyCategoryRules() {
    renderCategoryGrid();
    var rule = categoryRule(draftType, draftCategory);
    document.getElementById('mc-receipt-field').hidden = draftType !== 'expense';
    document.getElementById('mc-receipt-req').hidden = !rule.receiptRequired;
    document.getElementById('mc-comment-req').hidden = !rule.commentRequired;
    var isOrder = draftCategory === 'concrete_sale';
    document.getElementById('mc-order-field').hidden = !isOrder;
    document.getElementById('mc-order-hint').hidden = !isOrder;
    if (isOrder) renderOrderPicker();
  }

  function recentOrders() {
    var plantId = Plant.currentPlantId();
    return (State.data.orders || []).filter(function (o) { return o.plantId === plantId && !o.cancelledAt; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).slice(0, 6);
  }

  function renderOrderPicker() {
    var list = document.getElementById('mc-order-list');
    var orders = recentOrders();
    if (!draftOrderId && orders.length) draftOrderId = orders[0].id;
    list.innerHTML = orders.map(function (o) {
      var on = o.id === draftOrderId;
      return '<label class="pick' + (on ? ' on' : '') + '" data-order-id="' + o.id + '">' +
        '<input type="radio" name="mc-order" ' + (on ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--ink)">' +
        '<span class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + o.recipeName + ' · ' + Format.fmtNum(o.saleVolume, 1, 'м³') + '</span><span class="hint">' + new Date(o.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ', ' + new Date(o.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '</span></span>' +
        '<span class="num" style="font-weight:600;white-space:nowrap">' + Format.fmtNum(o.totalRevenue, 0) + '</span>' +
      '</label>';
    }).join('') || '<p class="hint">Нет недавних заказов на этом заводе.</p>';
    var hint = document.getElementById('mc-order-hint');
    var selected = orders.find(function (o) { return o.id === draftOrderId; });
    hint.textContent = selected ? 'По заказу ' + Format.fmtNum(selected.totalRevenue, 2, '₽') + ' без НДС' : '';
    Array.prototype.forEach.call(list.querySelectorAll('[data-order-id]'), function (label) {
      label.addEventListener('click', function () {
        draftOrderId = label.dataset.orderId;
        var order = orders.find(function (o) { return o.id === draftOrderId; });
        if (order) NumericInput.setFormattedValue(document.getElementById('mc-cash-amount'), order.totalRevenue);
        renderOrderPicker();
      });
    });
  }

  function setDraftType(type) {
    draftType = type;
    var seg = document.getElementById('mc-type-seg');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('on', btn.dataset.type === type);
      btn.setAttribute('aria-pressed', btn.dataset.type === type ? 'true' : 'false');
    });
    if (!categoriesFor(type).some(function (c) { return c.id === draftCategory; })) draftCategory = categoriesFor(type)[0].id;
    applyCategoryRules();
  }

  function resetForm() {
    editingId = null;
    draftOrderId = null;
    draftReceiptDataUrl = null;
    document.getElementById('mc-cash-save-btn').textContent = 'Сохранить';
    document.getElementById('mc-cancel-edit-btn').hidden = true;
    setDraftType('expense');
    NumericInput.setFormattedValue(document.getElementById('mc-cash-amount'), '');
    document.getElementById('mc-cash-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('mc-cash-comment').value = '';
    document.getElementById('mc-receipt-input').value = '';
    document.getElementById('mc-receipt-preview').textContent = 'Не прикреплено';
    document.getElementById('mc-cash-error').hidden = true;
  }

  function openForEdit(entry) {
    var ageMinutes = (Date.now() - new Date(entry.insertedAt).getTime()) / 60000;
    if (ageMinutes > 20) { alert('Окно редактирования (20 мин) истекло — используйте «Сторно».'); return; }
    editingId = entry.id;
    draftOrderId = entry.orderId;
    draftReceiptDataUrl = null;
    setDraftType(entry.type);
    draftCategory = entry.category;
    applyCategoryRules();
    NumericInput.setFormattedValue(document.getElementById('mc-cash-amount'), Math.abs(entry.amount));
    document.getElementById('mc-cash-date').value = entry.occurredAt;
    document.getElementById('mc-cash-comment').value = entry.comment || '';
    document.getElementById('mc-receipt-input').value = '';
    document.getElementById('mc-receipt-preview').innerHTML = entry.receiptPath ? '<a href="' + entry.receiptPath + '" target="_blank" rel="noopener">Текущее фото чека →</a>' : 'Не прикреплено';
    document.getElementById('mc-cash-save-btn').textContent = 'Сохранить изменения';
    document.getElementById('mc-cancel-edit-btn').hidden = false;
    document.getElementById('mc-cash-error').hidden = true;
    switchTab('form');
    window.scrollTo(0, 0);
  }

  async function handleSubmit() {
    var errorEl = document.getElementById('mc-cash-error');
    errorEl.hidden = true;
    var rule = categoryRule(draftType, draftCategory);
    var payload = {
      plantId: Plant.currentPlantId(),
      type: draftType,
      category: draftCategory,
      amount: NumericInput.parseNumber(document.getElementById('mc-cash-amount').value) || 0,
      comment: document.getElementById('mc-cash-comment').value.trim(),
      occurredAt: document.getElementById('mc-cash-date').value
    };
    if (draftCategory === 'concrete_sale') payload.orderId = draftOrderId;
    if (!(payload.amount > 0)) { errorEl.textContent = 'Укажите сумму больше нуля.'; errorEl.hidden = false; return; }
    if (rule.commentRequired && !payload.comment) { errorEl.textContent = 'Для категории «' + rule.label + '» комментарий обязателен.'; errorEl.hidden = false; return; }
    if (draftReceiptDataUrl) payload.receiptDataUrl = draftReceiptDataUrl;
    if (rule.receiptRequired && !draftReceiptDataUrl && !editingId) { errorEl.textContent = 'Для категории «' + rule.label + '» нужно фото чека.'; errorEl.hidden = false; return; }

    var btn = document.getElementById('mc-cash-save-btn');
    btn.disabled = true;
    try {
      var saved;
      if (editingId) saved = await Api.put('/cash-entries/' + editingId, payload);
      else saved = await Api.post('/cash-entries', payload);
      resetForm();
      switchTab('history');
      await loadEntries();
      renderHistory();
      showSavedStatus(saved);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function showSavedStatus(entry) {
    var el = document.getElementById('mc-history-status');
    el.hidden = false;
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:6px;background:var(--ok-bg);color:var(--ok-fg)';
    el.innerHTML = '<span><b>Сохранено:</b> ' + CATEGORY_LABELS[entry.category] + ', <span class="num">' + (entry.amount >= 0 ? '+' : '') + Format.fmtNum(entry.amount, 2) + ' ₽</span></span>' +
      '<button type="button" class="btn ghost" style="width:32px;height:32px;padding:0;border-color:transparent;color:inherit" aria-label="Закрыть" id="mc-status-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    document.getElementById('mc-status-close').addEventListener('click', function () { el.hidden = true; });
    setTimeout(function () { el.hidden = true; }, 6000);
  }

  // ---- История ----
  function statusFor(e) {
    var ageMinutes = (Date.now() - new Date(e.insertedAt).getTime()) / 60000;
    if (e.category === 'storno') return { label: 'Сторно', cls: 'warn' };
    if (e.stornoed) return { label: 'Сторнирована', cls: 'mute' };
    if (!e.stornoOfId && ageMinutes <= 20) return { label: 'Правка ещё ' + Math.max(0, Math.round(20 - ageMinutes)) + ' мин', cls: 'act' };
    return { label: 'Сохранено', cls: 'mute' };
  }

  async function handleStorno(id) {
    var note = window.prompt('Комментарий к сторно (необязательно):', '');
    if (note === null) return;
    try {
      await Api.post('/cash-entries/' + id + '/storno', { note: note });
      await loadEntries();
      renderHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteEntry(id) {
    if (!confirm('Удалить запись?')) return;
    try {
      await Api.del('/cash-entries/' + id);
      await loadEntries();
      renderHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderHistory() {
    document.getElementById('mc-history-empty').hidden = entries.length > 0;
    var list = document.getElementById('mc-history-list');
    // entries уже отсортированы бэкендом по inserted_at DESC — тут просто
    // берём верхушку ("последние записи за смену/день", см. документ).
    var recent = entries.slice(0, 20);
    list.innerHTML = recent.map(function (e) {
      var st = statusFor(e);
      var ageMinutes = (Date.now() - new Date(e.insertedAt).getTime()) / 60000;
      var canEdit = !e.stornoOfId && !e.stornoed && ageMinutes <= 20;
      var canStorno = !e.stornoOfId && !e.stornoed;
      var color = e.amount >= 0 ? '#1F5239' : 'var(--ink)';
      return '<article class="card stack g8" style="padding:12px 14px;opacity:' + (e.stornoed ? '.6' : '1') + '" data-entry-id="' + e.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">' +
          '<span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + CATEGORY_LABELS[e.category] + ' <span class="num hint" style="font-weight:400">' + new Date(e.insertedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '</span></span>' +
          '<span class="num" style="font-size:17px;font-weight:600;color:' + color + ';text-decoration:' + (e.stornoed ? 'line-through' : 'none') + ';white-space:nowrap;flex:none">' + (e.amount >= 0 ? '+' : '') + Format.fmtNum(e.amount, 2) + '</span>' +
        '</div>' +
        (e.comment ? '<span class="hint">' + e.comment + (e.receiptPath ? ' · чек' : '') + '</span>' : (e.receiptPath ? '<span class="hint">чек прикреплён</span>' : '')) +
        '<span class="chip ' + st.cls + '" style="align-self:flex-start">' + st.label + '</span>' +
        (canEdit ? '<div class="grid-2" style="gap:8px"><button type="button" class="btn ghost sm mc-hist-edit" style="height:44px">Изменить</button><button type="button" class="btn ghost sm mc-hist-delete" style="height:44px;color:#8C2217;border-color:#E3B8B1">Удалить</button></div>' : '') +
        (!canEdit && canStorno ? '<button type="button" class="btn ghost sm mc-hist-storno" style="height:44px;width:100%">Сторно</button>' : '') +
      '</article>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.mc-hist-edit'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.closest('[data-entry-id]').dataset.entryId;
        var entry = entries.find(function (x) { return x.id === id; });
        if (entry) openForEdit(entry);
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll('.mc-hist-delete'), function (btn) {
      btn.addEventListener('click', function () { handleDeleteEntry(btn.closest('[data-entry-id]').dataset.entryId); });
    });
    Array.prototype.forEach.call(list.querySelectorAll('.mc-hist-storno'), function (btn) {
      btn.addEventListener('click', function () { handleStorno(btn.closest('[data-entry-id]').dataset.entryId); });
    });
  }

  function render() {
    if (activeTab === 'history') { loadEntries().then(renderHistory); }
    else if (draftCategory === 'concrete_sale') { renderOrderPicker(); }
  }

  var initialized = false;
  function init() {
    document.getElementById('page-cash').innerHTML = HTML;
    document.getElementById('mc-tab-form').addEventListener('click', function () { switchTab('form'); });
    document.getElementById('mc-tab-history').addEventListener('click', function () { switchTab('history'); loadEntries().then(renderHistory); });
    document.getElementById('mc-type-seg').querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () { setDraftType(btn.dataset.type); });
    });
    NumericInput.attach(document.getElementById('mc-cash-amount'));
    document.getElementById('mc-cash-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('mc-receipt-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      document.getElementById('mc-receipt-preview').textContent = 'Сжимаем фото…';
      PhotoCompress.fromFile(file).then(function (dataUrl) {
        draftReceiptDataUrl = dataUrl;
        document.getElementById('mc-receipt-preview').innerHTML = '<img src="' + dataUrl + '" style="max-width:120px;max-height:90px;border-radius:4px;display:block">';
      }).catch(function (err) {
        document.getElementById('mc-receipt-preview').textContent = 'Не удалось прочитать фото: ' + err.message;
      });
    });
    document.getElementById('mc-cash-save-btn').addEventListener('click', handleSubmit);
    document.getElementById('mc-cancel-edit-btn').addEventListener('click', resetForm);
    applyCategoryRules();
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.MobileCashScreen = { init: init, show: show };
})();
