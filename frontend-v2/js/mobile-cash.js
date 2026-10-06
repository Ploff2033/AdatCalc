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
    '<div class="mobile-page" style="padding:8px 12px;gap:8px">' +
      '<div style="display:flex;gap:6px">' +
        '<button type="button" class="btn sm" id="mc-tab-form" style="flex:1;height:40px">Новая запись</button>' +
        '<button type="button" class="btn ghost sm" id="mc-tab-history" style="flex:1;height:40px">История</button>' +
      '</div>' +
      '<div id="mc-form-section" class="stack g12">' +
        '<div class="seg" role="group" aria-label="Тип операции" id="mc-type-seg"><button type="button" data-type="expense" class="on" aria-pressed="true">Расход</button><button type="button" data-type="income" aria-pressed="false">Доход</button></div>' +
        '<span class="sub">Категория</span>' +
        '<div class="grid-2" id="mc-category-grid" style="gap:8px"></div>' +
        '<div id="mc-order-field" hidden><span class="sub">Заказ</span><div id="mc-order-list" class="stack g8" style="margin-top:6px"></div></div>' +
        '<div id="mc-employee-field" hidden><span class="sub">Сотрудник (необязательно)</span><div id="mc-employee-list" class="stack g8" style="margin-top:6px"></div></div>' +
        '<div id="mc-vehicle-field" hidden><span class="sub">Техника (необязательно)</span><div id="mc-vehicle-list" class="stack g8" style="margin-top:6px"></div></div>' +
        '<div class="field"><label for="mc-cash-amount">Сумма</label><div class="unit"><input id="mc-cash-amount" class="inp num" style="height:56px;font-size:24px;font-weight:600" inputmode="decimal"><span>₽</span></div>' +
          '<div id="mc-order-hint" class="hint" hidden></div>' +
        '</div>' +
        '<div class="field"><label for="mc-cash-date">Дата</label><input id="mc-cash-date" type="date" class="inp" style="height:48px"></div>' +
        '<div class="field" id="mc-receipt-field"><label>Фото чека <span class="req" id="mc-receipt-req">*</span></label>' +
          '<div class="card" style="display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px">' +
            '<div id="mc-receipt-thumb" style="width:72px;height:72px;border-radius:4px;background:repeating-linear-gradient(0deg,var(--border-soft) 0 6px,var(--surface-2) 6px 12px);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none"></div>' +
            '<span class="stack" style="gap:2px;min-width:0"><span id="mc-receipt-status" style="font-weight:600">Нет фото</span><span id="mc-receipt-hint" class="hint">Прикрепите фото чека</span></span>' +
            '<button type="button" class="btn ghost sm" id="mc-receipt-btn" style="height:44px;flex:none">Прикрепить</button>' +
          '</div>' +
          '<input type="file" id="mc-receipt-input" accept="image/*" capture="environment" style="display:none">' +
        '</div>' +
        '<div class="field" id="mc-comment-field"><label for="mc-cash-comment">Комментарий <span class="req" id="mc-comment-req">*</span></label><textarea id="mc-cash-comment" class="inp" style="height:72px;padding:10px 12px;resize:none"></textarea></div>' +
        '<p class="banner" id="mc-cash-error" hidden></p>' +
        '<button type="button" class="btn ghost sm" id="mc-cancel-edit-btn" style="height:44px" hidden>Отменить редактирование</button>' +
        '<button type="button" class="btn pri" id="mc-cash-save-btn" style="height:52px;width:100%;font-size:16px">Сохранить</button>' +
      '</div>' +
      '<div id="mc-history-section" class="stack g12" hidden>' +
        '<div id="mc-history-status" role="status" hidden></div>' +
        '<div id="mc-history-list" class="stack g8" style="margin:0 -12px"></div>' +
        '<p class="empty-state" id="mc-history-empty" hidden>Записей пока нет.</p>' +
      '</div>' +
    '</div>';

  // Топливо/Автозапчасти — фото чека не обязательно (не везде дают чек), но
  // поле всё равно показываем (receiptOptional), см. тот же приём в
  // screen-cash.js.
  var EXPENSE_CATEGORIES = [
    { id: 'fuel', label: 'Топливо', receiptRequired: false, receiptOptional: true, commentRequired: false },
    { id: 'salary', label: 'ЗП', receiptRequired: false, commentRequired: true },
    { id: 'parts', label: 'Автозапчасти', receiptRequired: false, receiptOptional: true, commentRequired: false },
    { id: 'other', label: 'Другое', receiptRequired: false, commentRequired: true }
  ];
  var INCOME_CATEGORIES = [
    { id: 'concrete_sale', label: 'Продажа бетона', receiptRequired: false, commentRequired: false },
    { id: 'other', label: 'Прочее', receiptRequired: false, commentRequired: true }
  ];
  var CATEGORY_LABELS = {};
  EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES).forEach(function (c) { CATEGORY_LABELS[c.id] = c.label; });
  CATEGORY_LABELS.storno = 'Сторно';

  // Локальная календарная дата 'YYYY-MM-DD' без ухода через UTC — см. тот
  // же приём и комментарий в screen-cash.js::localDateStr. new Date()
  // .toISOString().slice(0,10) с полуночи до ~3 утра МСК тихо подставлял
  // ВЧЕРАШНЮЮ дату в поле "Дата" новой записи (Москва — UTC+3).
  function localDateStr(d) {
    d = d || new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function categoriesFor(type) { return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES; }
  function categoryRule(type, id) {
    var found = categoriesFor(type).filter(function (c) { return c.id === id; })[0];
    return found || { id: id, label: CATEGORY_LABELS[id] || id, receiptRequired: false, commentRequired: false };
  }

  var activeTab = 'form';
  var draftType = 'expense';
  var draftCategory = 'fuel';
  var draftOrderId = null;
  // По желанию — та же привязка "ЗП"/"Топливо" к сотруднику/технике, что и
  // в desktop screen-cash.js (см. тот же комментарий там).
  var draftEmployeeId = null;
  var draftVehicleKind = null; // 'mixer' | 'truck' | 'other' | null
  var draftVehicleId = null;
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
    // Фото чека — поле целиком, а не только звёздочка "*" (см. тот же
    // приём и комментарий в screen-cash.js::applyCategoryRules): иначе на
    // телефоне работник видит поле даже для ЗП/Прочего, где чека не бывает
    // вообще, и не понимает, обязательно оно или нет. Показываем и когда
    // обязательно (receiptRequired), и когда просто разрешено приложить
    // (receiptOptional — Топливо/Автозапчасти: чек не везде дают, но если
    // есть, пусть прикрепит). Комментарий, по отдельному отзыву, наоборот
    // не прячем никогда — уместен и как необязательный, меняется только
    // звёздочка.
    document.getElementById('mc-receipt-field').hidden = !(draftType === 'expense' && (rule.receiptRequired || rule.receiptOptional));
    document.getElementById('mc-comment-req').hidden = !rule.commentRequired;
    var isOrder = draftCategory === 'concrete_sale';
    document.getElementById('mc-order-field').hidden = !isOrder;
    document.getElementById('mc-order-hint').hidden = !isOrder;
    if (isOrder) renderOrderPicker();
    var isSalary = draftCategory === 'salary';
    document.getElementById('mc-employee-field').hidden = !isSalary;
    if (isSalary) renderEmployeePicker();
    var isFuel = draftCategory === 'fuel';
    document.getElementById('mc-vehicle-field').hidden = !isFuel;
    if (isFuel) renderVehiclePicker();
  }

  // Список сотрудников уже отфильтрован бэкендом по роли (не-admin — только
  // водители своего завода, без оклада/должности, см. employees.js::list) —
  // тот же State.data.employees, что используется для выбора водителя в
  // Путевых листах.
  function renderEmployeePicker() {
    var list = document.getElementById('mc-employee-list');
    var plantId = Plant.currentPlantId();
    // showInCash === false и общие сотрудники (plantId === null) — та же
    // логика, что в desktop screen-cash.js::renderEmployeePicker, см.
    // комментарий там.
    var employees = (State.data.employees || []).filter(function (e) { return e.plantId === plantId && e.showInCash !== false; });
    var noneOn = !draftEmployeeId;
    var html = '<label class="pick' + (noneOn ? ' on' : '') + '" data-employee-id="">' +
      '<input type="radio" name="mc-employee" ' + (noneOn ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--ink)">' +
      '<span style="font-weight:600">Без сотрудника</span>' +
    '</label>';
    html += employees.map(function (e) {
      var on = e.id === draftEmployeeId;
      return '<label class="pick' + (on ? ' on' : '') + '" data-employee-id="' + e.id + '">' +
        '<input type="radio" name="mc-employee" ' + (on ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--ink)">' +
        '<span class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + e.name + '</span>' + (e.position ? '<span class="hint">' + e.position + '</span>' : '') + '</span>' +
      '</label>';
    }).join('');
    list.innerHTML = html;
    Array.prototype.forEach.call(list.querySelectorAll('[data-employee-id]'), function (label) {
      label.addEventListener('click', function () {
        draftEmployeeId = label.dataset.employeeId || null;
        renderEmployeePicker();
      });
    });
  }

  // Единый список техники — миксеры + инертовозы вместе, см. тот же
  // комментарий и vehicleOptions() в desktop screen-cash.js.
  function vehicleOptions() {
    var mixers = (State.data.mixers || []).map(function (m) { return { id: m.id, kind: 'mixer', name: m.name, licensePlate: m.licensePlate }; });
    var trucks = (State.data.aggregateTrucks || []).map(function (t) { return { id: t.id, kind: 'truck', name: t.name, licensePlate: t.licensePlate }; });
    // "Другое" — та же логика, что в desktop screen-cash.js::vehicleOptions.
    var other = (State.data.otherEquipment || []).map(function (o) { return { id: o.id, kind: 'other', name: o.name, licensePlate: o.licensePlate }; });
    return mixers.concat(trucks, other);
  }

  function renderVehiclePicker() {
    var list = document.getElementById('mc-vehicle-list');
    var vehicles = vehicleOptions();
    var noneOn = !draftVehicleId;
    var html = '<label class="pick' + (noneOn ? ' on' : '') + '" data-vehicle-id="" data-vehicle-kind="">' +
      '<input type="radio" name="mc-vehicle" ' + (noneOn ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--ink)">' +
      '<span style="font-weight:600">Без техники</span>' +
    '</label>';
    html += vehicles.map(function (v) {
      var on = v.id === draftVehicleId && v.kind === draftVehicleKind;
      return '<label class="pick' + (on ? ' on' : '') + '" data-vehicle-id="' + v.id + '" data-vehicle-kind="' + v.kind + '">' +
        '<input type="radio" name="mc-vehicle" ' + (on ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--ink)">' +
        '<span style="font-weight:600">' + v.name + (v.licensePlate ? ' (' + v.licensePlate + ')' : '') + '</span>' +
      '</label>';
    }).join('');
    list.innerHTML = html;
    Array.prototype.forEach.call(list.querySelectorAll('[data-vehicle-id]'), function (label) {
      label.addEventListener('click', function () {
        draftVehicleId = label.dataset.vehicleId || null;
        draftVehicleKind = label.dataset.vehicleKind || null;
        renderVehiclePicker();
      });
    });
  }

  function recentOrders() {
    var plantId = Plant.currentPlantId();
    // См. тот же приём в screen-cash.js::recentPlantOrders — только
    // недавние (3 дня) заказы без НДС: с НДС идут по безналу, наличка в
    // кассу с них не может числиться.
    var cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return (State.data.orders || []).filter(function (o) {
      return o.plantId === plantId && !o.cancelledAt && !o.vatApplied && new Date(o.createdAt).getTime() >= cutoff;
    }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).slice(0, 6);
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

  // Карточка "Фото чека" — по макету (MobileCashForm.dc.html: превью 72×72
  // + статус/подсказка + кнопка справа), см. тот же приём и комментарий в
  // screen-cash.js::renderReceiptPreview.
  var RECEIPT_PLACEHOLDER_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.2" r="3.4"/></svg>';
  function renderReceiptPreview(imgSrc, statusText, hintText, btnLabel) {
    document.getElementById('mc-receipt-thumb').innerHTML = imgSrc
      ? '<img src="' + imgSrc + '" style="width:100%;height:100%;object-fit:cover;display:block">'
      : RECEIPT_PLACEHOLDER_ICON;
    document.getElementById('mc-receipt-status').textContent = statusText;
    document.getElementById('mc-receipt-hint').textContent = hintText;
    document.getElementById('mc-receipt-btn').textContent = btnLabel;
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
    draftEmployeeId = null;
    draftVehicleKind = null;
    draftVehicleId = null;
    draftReceiptDataUrl = null;
    document.getElementById('mc-cash-save-btn').textContent = 'Сохранить';
    document.getElementById('mc-cancel-edit-btn').hidden = true;
    setDraftType('expense');
    NumericInput.setFormattedValue(document.getElementById('mc-cash-amount'), '');
    document.getElementById('mc-cash-date').value = localDateStr();
    document.getElementById('mc-cash-comment').value = '';
    document.getElementById('mc-receipt-input').value = '';
    renderReceiptPreview(null, 'Нет фото', 'Прикрепите фото чека', 'Прикрепить');
    document.getElementById('mc-cash-error').hidden = true;
  }

  function openForEdit(entry) {
    // admin правит когда угодно, без окна — см. тот же комментарий в
    // screen-cash.js и backend/handlers/cash-entries.js::assertEditable.
    var ageMinutes = (Date.now() - new Date(entry.insertedAt).getTime()) / 60000;
    if (!Auth.isAtLeast('admin') && ageMinutes > 20) { alert('Окно редактирования (20 мин) истекло — используйте «Сторно».'); return; }
    editingId = entry.id;
    draftOrderId = entry.orderId;
    draftEmployeeId = entry.employeeId || null;
    draftVehicleKind = entry.mixerId ? 'mixer' : (entry.aggregateTruckId ? 'truck' : (entry.otherEquipmentId ? 'other' : null));
    draftVehicleId = entry.mixerId || entry.aggregateTruckId || entry.otherEquipmentId || null;
    draftReceiptDataUrl = null;
    setDraftType(entry.type);
    draftCategory = entry.category;
    applyCategoryRules();
    NumericInput.setFormattedValue(document.getElementById('mc-cash-amount'), Math.abs(entry.amount));
    document.getElementById('mc-cash-date').value = entry.occurredAt;
    document.getElementById('mc-cash-comment').value = entry.comment || '';
    document.getElementById('mc-receipt-input').value = '';
    if (entry.receiptPath) renderReceiptPreview(entry.receiptPath, 'Чек прикреплён', 'Текущее фото', 'Переснять');
    else renderReceiptPreview(null, 'Нет фото', 'Прикрепите фото чека', 'Прикрепить');
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
    payload.employeeId = draftCategory === 'salary' ? (draftEmployeeId || null) : null;
    payload.mixerId = draftCategory === 'fuel' && draftVehicleKind === 'mixer' ? draftVehicleId : null;
    payload.aggregateTruckId = draftCategory === 'fuel' && draftVehicleKind === 'truck' ? draftVehicleId : null;
    payload.otherEquipmentId = draftCategory === 'fuel' && draftVehicleKind === 'other' ? draftVehicleId : null;
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
    if (!e.stornoOfId && Auth.isAtLeast('admin')) return { label: 'Открыта (админ)', cls: 'mute' };
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

  function orderDetailFor(orderId) {
    var order = (State.data.orders || []).find(function (o) { return o.id === orderId; });
    if (!order) return null;
    return order.recipeName + ' · ' + Format.fmtNum(order.saleVolume, 1, 'м³') + ' · ' + new Date(order.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function renderHistory() {
    document.getElementById('mc-history-empty').hidden = entries.length > 0;
    var list = document.getElementById('mc-history-list');
    var isAdmin = Auth.isAtLeast('admin');
    // entries уже отсортированы бэкендом по inserted_at DESC — тут просто
    // берём верхушку ("последние записи за смену/день", см. документ).
    var recent = entries.slice(0, 20);
    list.innerHTML = recent.map(function (e) {
      var st = statusFor(e);
      var ageMinutes = (Date.now() - new Date(e.insertedAt).getTime()) / 60000;
      var canEdit = !e.stornoOfId && !e.stornoed && (isAdmin || ageMinutes <= 20);
      var canStorno = !e.stornoOfId && !e.stornoed;
      var color = e.amount >= 0 ? '#1F5239' : 'var(--ink)';
      var when = new Date(e.insertedAt);
      var dateTime = when.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ', ' + when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      // "Подробный вид" — по отзыву пользователя: раньше карточка истории
      // показывала только категорию/время/сумму, без даты (при списке за
      // несколько дней непонятно, какой это день), без самого фото чека
      // (только текст "чек прикреплён", без возможности его посмотреть) и
      // без деталей заказа у "Продажи бетона". Теперь дата всегда полная,
      // фото — кликабельная миниатюра, у заказа — марка/объём/дата.
      var detailLine = e.comment || '';
      if (e.orderId) {
        var orderDetail = orderDetailFor(e.orderId);
        if (orderDetail) detailLine = orderDetail + (detailLine ? ' · ' + detailLine : '');
      }
      if (e.employeeId) {
        var emp = (State.data.employees || []).find(function (x) { return x.id === e.employeeId; });
        if (emp) detailLine = emp.name + (detailLine ? ' · ' + detailLine : '');
      }
      if (e.mixerId || e.aggregateTruckId || e.otherEquipmentId) {
        var veh = e.mixerId
          ? (State.data.mixers || []).find(function (x) { return x.id === e.mixerId; })
          : (e.aggregateTruckId ? (State.data.aggregateTrucks || []).find(function (x) { return x.id === e.aggregateTruckId; })
            : (State.data.otherEquipment || []).find(function (x) { return x.id === e.otherEquipmentId; }));
        if (veh) detailLine = (veh.name + (veh.licensePlate ? ' (' + veh.licensePlate + ')' : '')) + (detailLine ? ' · ' + detailLine : '');
      }
      return '<article class="card-flat stack g8" style="padding:12px 14px;opacity:' + (e.stornoed ? '.6' : '1') + '" data-entry-id="' + e.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">' +
          '<span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + CATEGORY_LABELS[e.category] + '</span>' +
          '<span class="num" style="font-size:17px;font-weight:600;color:' + color + ';text-decoration:' + (e.stornoed ? 'line-through' : 'none') + ';white-space:nowrap;flex:none">' + (e.amount >= 0 ? '+' : '') + Format.fmtNum(e.amount, 2) + '</span>' +
        '</div>' +
        '<span class="hint num">' + dateTime + '</span>' +
        (detailLine ? '<span class="hint">' + detailLine + '</span>' : '') +
        (e.receiptPath ? '<a href="' + e.receiptPath + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit"><img src="' + e.receiptPath + '" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--border)"><span class="hint" style="text-decoration:underline">Открыть фото чека</span></a>' : '') +
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
    else if (draftCategory === 'salary') { renderEmployeePicker(); }
    else if (draftCategory === 'fuel') { renderVehiclePicker(); }
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
    document.getElementById('mc-cash-date').value = localDateStr();
    document.getElementById('mc-receipt-btn').addEventListener('click', function () {
      document.getElementById('mc-receipt-input').click();
    });
    document.getElementById('mc-receipt-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      renderReceiptPreview(null, 'Обработка…', 'Сжимаем фото', 'Прикрепить');
      PhotoCompress.fromFile(file).then(function (dataUrl) {
        draftReceiptDataUrl = dataUrl;
        var now = new Date();
        renderReceiptPreview(dataUrl, 'Чек прикреплён', 'сегодня, ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'Переснять');
      }).catch(function (err) {
        renderReceiptPreview(null, 'Не удалось прочитать фото', err.message, 'Прикрепить');
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
