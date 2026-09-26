(function () {
  // ДДС — модуль от 25.09.2026 (см. документ "AdatBeton Calc — ДДС и
  // Дашборд (MVP)"). Основной сценарий — анонимный работник по токену на
  // мобильном (см. mobile-cash.js); этот экран — журнал по всем заводам с
  // фильтрами для админа/менеджера (макет Cash.dc.html) + возможность
  // завести запись вручную (например, задним числом за работника).
  //
  // Свой отдельный запрос (не часть State.loadAll()) — как и
  // stock-movements: лог может расти, тянуть его в общую загрузку каждого
  // экрана незачем.
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap" id="c-scope">Все заводы</span><h1>ДДС</h1></div>' +
      '<div class="page-head-actions"><button class="btn ghost sm" id="c-export-btn">Экспорт (ZIP)</button><button class="btn pri sm" id="c-add-btn">Новая запись</button></div>' +
    '</div>' +
    '<div class="grid-4" id="c-summary" style="gap:12px"></div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<select class="inp" id="c-plant-filter" style="width:180px" aria-label="Завод" hidden></select>' +
      '<div class="seg" role="group" aria-label="Тип" id="c-type-seg" style="width:250px"></div>' +
      '<select class="inp" id="c-category-filter" style="width:180px" aria-label="Категория"></select>' +
      '<div class="seg" role="group" aria-label="Период" id="c-period-seg" style="width:300px"></div>' +
      '<label style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:4px;background:#fff;font-size:13px"><button type="button" class="tog" id="c-no-receipt-toggle" aria-label="Только без фото чека" aria-pressed="false"><i></i></button>Без фото чека</label>' +
    '</div>' +
    '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
      '<div class="row head" style="grid-template-columns:70px 90px minmax(0,1fr) 70px 130px 130px 44px"><div>Время</div><div>Завод</div><div>Категория и комментарий</div><div>Чек</div><div class="r">Сумма</div><div>Статус</div><div></div></div>' +
      '<div id="c-rows"></div>' +
      '<p class="empty-state" id="c-empty" hidden>Записей не найдено.</p>' +
    '</section>' +
    '<aside class="drawer" id="c-drawer" hidden style="width:440px">' +
      '<div class="drawer-head"><h2 id="c-drawer-title">Новая запись</h2><button type="button" class="btn ghost icon" id="c-drawer-close" aria-label="Закрыть">✕</button></div>' +
      '<form id="c-form">' +
        '<div class="drawer-body">' +
          '<div class="field" id="c-f-plant-field"><label for="c-f-plant">Завод</label><select id="c-f-plant" class="inp"></select></div>' +
          '<div class="seg" role="group" aria-label="Тип операции" id="c-f-type-seg"><button type="button" data-type="expense" class="on" aria-pressed="true">Расход</button><button type="button" data-type="income" aria-pressed="false">Доход</button></div>' +
          '<div class="field"><span class="hint">Категория</span><div class="grid-2" id="c-f-category-grid" style="gap:8px"></div></div>' +
          '<div id="c-f-order-field" hidden>' +
            '<span class="hint">Заказ</span>' +
            '<div id="c-f-order-list" class="stack g8" style="margin-top:6px"></div>' +
          '</div>' +
          '<div class="field"><label for="c-f-amount">Сумма</label><div class="unit"><input id="c-f-amount" class="inp num" inputmode="decimal"><span>₽</span></div></div>' +
          '<div class="field"><label for="c-f-date">Дата</label><input id="c-f-date" type="date" class="inp"></div>' +
          '<div class="field" id="c-f-receipt-field"><label>Фото чека <span class="req" id="c-f-receipt-req">*</span></label>' +
            '<div class="card" style="display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px">' +
              '<div id="c-f-receipt-thumb" style="width:72px;height:72px;border-radius:4px;background:repeating-linear-gradient(0deg,var(--border-soft) 0 6px,var(--surface-2) 6px 12px);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none"></div>' +
              '<span class="stack" style="gap:2px;min-width:0"><span id="c-f-receipt-status" style="font-weight:600">Нет фото</span><span id="c-f-receipt-hint" class="hint">Прикрепите фото чека</span></span>' +
              '<button type="button" class="btn ghost sm" id="c-f-receipt-btn" style="height:44px;flex:none">Прикрепить</button>' +
            '</div>' +
            '<input type="file" id="c-f-receipt-input" accept="image/*" style="display:none">' +
          '</div>' +
          '<div class="field" id="c-f-comment-field"><label for="c-f-comment">Комментарий <span class="req" id="c-f-comment-req">*</span></label><textarea id="c-f-comment" class="inp" style="height:72px;padding:10px 12px;resize:vertical"></textarea></div>' +
        '</div>' +
        '<div class="drawer-foot">' +
          '<p class="banner" id="c-form-error" hidden></p>' +
          '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">' +
            '<button type="button" class="btn ghost" id="c-delete-btn" style="color:#8C2217;border-color:#E3B8B1" hidden>Удалить</button>' +
            '<button type="submit" class="btn pri" id="c-save-btn">Добавить запись</button>' +
          '</div>' +
        '</div>' +
      '</form>' +
    '</aside>';

  // Тот же справочник правил, что в backend/handlers/cash-entries.js —
  // бэкенд остаётся источником истины для валидации, тут только для UI
  // (какие поля показать/потребовать).
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

  var entries = [];
  var plantFilterValue = '';
  var typeFilterValue = '';
  var categoryFilterValue = '';
  var periodValue = 'month';
  var noReceiptOnly = false;

  var editingId = null;
  var draftType = 'expense';
  var draftCategory = 'fuel';
  var draftOrderId = null;
  var draftReceiptDataUrl = null; // новое фото, выбранное в этой сессии редактирования (ещё не отправлено)
  var draftReceiptCleared = false;

  function periodRange() {
    var now = new Date();
    if (periodValue === 'month') {
      var start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
    }
    if (periodValue === '30d') {
      var d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { from: d.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
    }
    return { from: '', to: '' };
  }

  function currentQueryString() {
    var params = [];
    if (plantFilterValue) params.push('plantId=' + encodeURIComponent(plantFilterValue));
    if (typeFilterValue) params.push('type=' + encodeURIComponent(typeFilterValue));
    if (categoryFilterValue) params.push('category=' + encodeURIComponent(categoryFilterValue));
    var range = periodRange();
    if (range.from) params.push('from=' + range.from);
    if (range.to) params.push('to=' + range.to);
    if (noReceiptOnly) params.push('noReceipt=1');
    return params.length ? '?' + params.join('&') : '';
  }

  async function loadEntries() {
    try { entries = await Api.get('/cash-entries' + currentQueryString()); }
    catch (err) { entries = []; }
  }

  function renderSummary() {
    var income = 0, expense = 0, noReceiptCount = 0, noReceiptSum = 0;
    entries.forEach(function (e) {
      if (e.amount > 0) income += e.amount; else expense += e.amount;
      if (!e.receiptPath && (e.category === 'fuel' || e.category === 'parts')) { noReceiptCount++; noReceiptSum += Math.abs(e.amount); }
    });
    var balance = income + expense;
    var cards = [
      { label: 'Доходы', value: Format.fmt(income, 0), color: '#1F5239' },
      { label: 'Расходы', value: Format.fmt(expense, 0), color: 'var(--ink)' },
      { label: 'Сальдо', value: (balance >= 0 ? '+' : '') + Format.fmt(balance, 0), color: balance >= 0 ? '#1F5239' : '#8C2217' }
    ];
    document.getElementById('c-summary').innerHTML = cards.map(function (k) {
      return '<div class="card stack g6" style="padding:12px 16px"><span class="cap">' + k.label + '</span><span class="num" style="font-size:22px;font-weight:500;color:' + k.color + '">' + k.value + '</span></div>';
    }).join('') +
      '<div class="card stack g6" style="padding:12px 16px' + (noReceiptCount ? ';background:var(--bad-bg);border-color:#E3B8B1' : '') + '"><span class="cap" style="' + (noReceiptCount ? 'color:var(--bad-fg)' : '') + '">Без фото чека</span><span class="num" style="font-size:22px;font-weight:500' + (noReceiptCount ? ';color:var(--bad-fg)' : '') + '">' + noReceiptCount + ' запис' + (noReceiptCount === 1 ? 'ь' : (noReceiptCount >= 2 && noReceiptCount <= 4 ? 'и' : 'ей')) + ' · ' + Format.fmt(noReceiptSum, 0) + '</span></div>';
  }

  function dayKey(occurredAt) { return occurredAt; }
  function dayLabel(occurredAt) {
    var d = new Date(occurredAt + 'T00:00:00');
    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (occurredAt === todayStr) return 'Сегодня, ' + d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
    if (occurredAt === y.toISOString().slice(0, 10)) return 'Вчера, ' + d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
    return d.toLocaleDateString('ru-RU', { weekday: 'long', day: '2-digit', month: 'long' });
  }
  function timeLabel(insertedAt) { return new Date(insertedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

  function statusFor(e) {
    var ageMinutes = (Date.now() - new Date(e.insertedAt).getTime()) / 60000;
    if (e.category === 'storno') return { label: 'Сторно', cls: 'warn' };
    if (e.stornoed) return { label: 'Сторнирована', cls: 'mute' };
    if (!e.stornoOfId && ageMinutes <= 20) return { label: 'Правка ' + Math.max(0, Math.round(20 - ageMinutes)) + ' мин', cls: 'act' };
    // admin правит без окна (см. openForEdit) — "Закрыта" тут было бы
    // неверно, обычная запись открыта для правки ему всегда.
    if (!e.stornoOfId && Auth.isAtLeast('admin')) return { label: 'Открыта (админ)', cls: 'mute' };
    return { label: 'Закрыта', cls: 'mute' };
  }

  function renderRows() {
    document.getElementById('c-empty').hidden = entries.length > 0;
    var groups = {};
    var order = [];
    entries.forEach(function (e) {
      var key = dayKey(e.occurredAt);
      if (!groups[key]) { groups[key] = { income: 0, expense: 0, items: [] }; order.push(key); }
      groups[key].items.push(e);
      if (e.amount > 0) groups[key].income += e.amount; else groups[key].expense += e.amount;
    });
    var html = order.map(function (key) {
      var g = groups[key];
      var rows = g.items.map(function (e) {
        var st = statusFor(e);
        var isStornoed = e.stornoed;
        var color = e.amount >= 0 ? '#1F5239' : 'var(--ink)';
        // Кликабельная миниатюра, а не просто текстовый статус — по отзыву
        // пользователя ("нет подробного вида") фото раньше нельзя было
        // посмотреть прямо из журнала.
        var receiptChip = e.receiptPath
          ? '<a href="' + e.receiptPath + '" target="_blank" rel="noopener" title="Открыть фото чека"><img src="' + e.receiptPath + '" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid var(--border);display:block"></a>'
          : ((e.category === 'fuel' || e.category === 'parts') ? '<span class="chip bad">нет чека</span>' : '<span class="chip mute">—</span>');
        var canAct = !e.stornoOfId; // сторно-записи не редактируются и сами не сторнируются
        var detailLine = e.comment || '';
        if (e.orderId) {
          var order2 = (State.data.orders || []).find(function (o) { return o.id === e.orderId; });
          if (order2) {
            var orderDetail = order2.recipeName + ' · ' + Format.fmtNum(order2.saleVolume, 1, 'м³') + ' · ' + new Date(order2.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            detailLine = orderDetail + (detailLine ? ' · ' + detailLine : '');
          }
        }
        return '<div class="row" style="grid-template-columns:70px 90px minmax(0,1fr) 70px 130px 130px 44px;min-height:54px;opacity:' + (isStornoed ? '.6' : '1') + '">' +
          '<div class="num hint">' + timeLabel(e.insertedAt) + '</div>' +
          '<div>' + e.plantName + '</div>' +
          '<div class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + CATEGORY_LABELS[e.category] + '</span><span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + detailLine + '</span></div>' +
          '<div>' + receiptChip + '</div>' +
          '<div class="r num" style="font-size:15px;font-weight:600;color:' + color + ';text-decoration:' + (isStornoed ? 'line-through' : 'none') + ';white-space:nowrap">' + (e.amount >= 0 ? '+' : '') + Format.fmtNum(e.amount, 2) + ' ₽</div>' +
          '<div><span class="chip ' + st.cls + '">' + st.label + '</span></div>' +
          '<div style="display:flex;justify-content:flex-end">' +
            (canAct ? '<button type="button" class="btn ghost icon c-menu-btn" aria-label="Действия" style="width:32px;height:32px" data-entry-id="' + e.id + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>' : '') +
          '</div>' +
        '</div>';
      }).join('');
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 16px;height:38px;background:var(--surface-3);border-bottom:1px solid var(--border)">' +
        '<span style="font-weight:600">' + dayLabel(key) + '</span><span class="num" style="font-size:12px;color:var(--ink-soft)">расход ' + Format.fmtNum(Math.abs(g.expense), 0) + ' · доход ' + Format.fmtNum(g.income, 0) + '</span>' +
      '</div>' + rows;
    }).join('');
    document.getElementById('c-rows').innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll('.c-menu-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        // ensureSharedMenu(), а не getElementById — при самом первом клике
        // за сессию #c-shared-menu ещё не создан (создаётся лениво), и
        // .hidden на null падал с TypeError.
        var menu = ensureSharedMenu();
        var willOpen = menu.hidden || menu.dataset.entryId !== btn.dataset.entryId;
        closeAllMenus();
        if (willOpen) openSharedMenu(btn);
      });
    });
  }

  // Общее плавающее меню ⋯ для всей таблицы (одно на страницу, а не по
  // одному на строку) — по отзыву пользователя ("действия открываются как
  // бы на слое ниже"): раньше каждое меню лежало внутри строки, а строка —
  // внутри <section class="card" style="overflow:hidden">, и это overflow
  // обрезал/прятал popup, стоило ему хоть немного выйти за нижний край
  // секции (обычный случай — последние строки таблицы). Одно меню, живущее
  // прямо в <body> с position:fixed и координатами по клику, ничем не
  // обрезается и не зависит от того, в какой строке его открыли.
  function ensureSharedMenu() {
    var menu = document.getElementById('c-shared-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'c-shared-menu';
    menu.className = 'card stack g4';
    menu.style.cssText = 'position:fixed;z-index:50;padding:6px;min-width:150px';
    menu.hidden = true;
    menu.innerHTML =
      '<button type="button" class="btn ghost sm" id="c-shared-edit-btn" style="justify-content:flex-start">Изменить</button>' +
      '<button type="button" class="btn ghost sm" id="c-shared-storno-btn" style="justify-content:flex-start">Сторно</button>';
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.getElementById('c-shared-edit-btn').addEventListener('click', function () {
      var id = menu.dataset.entryId;
      closeAllMenus();
      var entry = entries.find(function (x) { return x.id === id; });
      if (entry) openForEdit(entry);
    });
    document.getElementById('c-shared-storno-btn').addEventListener('click', function () {
      var id = menu.dataset.entryId;
      closeAllMenus();
      handleStorno(id);
    });
    return menu;
  }

  function openSharedMenu(btn) {
    var menu = ensureSharedMenu();
    var rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = 'auto';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.dataset.entryId = btn.dataset.entryId;
    menu.hidden = false;
  }

  function closeAllMenus() {
    var menu = document.getElementById('c-shared-menu');
    if (menu) menu.hidden = true;
  }

  async function handleStorno(id) {
    var note = window.prompt('Комментарий к сторно (необязательно):', '');
    if (note === null) return;
    try {
      await Api.post('/cash-entries/' + id + '/storno', { note: note });
      await loadEntries();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderFilters() {
    var plants = State.data.plants || [];
    var isAdmin = Auth.isAtLeast('admin');
    var plantSelect = document.getElementById('c-plant-filter');
    plantSelect.hidden = !(plants.length > 1);
    if (plants.length > 1) {
      plantSelect.innerHTML = (isAdmin ? '<option value="">Все заводы</option>' : '') + plants.map(function (p) {
        return '<option value="' + p.id + '">' + p.name + '</option>';
      }).join('');
      var validPrev = plantFilterValue && plants.some(function (p) { return p.id === plantFilterValue; });
      if (!validPrev && !(isAdmin && plantFilterValue === '')) {
        plantFilterValue = isAdmin ? '' : (Plant.currentPlantId() || plants[0].id);
      }
      plantSelect.value = plantFilterValue;
    } else {
      plantFilterValue = plants[0] ? plants[0].id : '';
    }
    document.getElementById('c-scope').textContent = plantFilterValue ? (plants.find(function (p) { return p.id === plantFilterValue; }) || {}).name || 'Завод' : 'Все заводы';

    var typeSeg = document.getElementById('c-type-seg');
    typeSeg.innerHTML = [['', 'Все'], ['expense', 'Расход'], ['income', 'Доход']].map(function (t) {
      return '<button type="button" data-type="' + t[0] + '" class="' + (t[0] === typeFilterValue ? 'on' : '') + '" aria-pressed="' + (t[0] === typeFilterValue) + '">' + t[1] + '</button>';
    }).join('');
    Array.prototype.forEach.call(typeSeg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () { typeFilterValue = btn.dataset.type; renderFilters(); loadAndRender(); });
    });

    var catSelect = document.getElementById('c-category-filter');
    var allCats = EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES).concat([{ id: 'storno', label: 'Сторно' }]);
    catSelect.innerHTML = '<option value="">Все категории</option>' + allCats.map(function (c) { return '<option value="' + c.id + '">' + c.label + '</option>'; }).join('');
    catSelect.value = categoryFilterValue;

    var periodSeg = document.getElementById('c-period-seg');
    periodSeg.innerHTML = [['month', 'Этот месяц'], ['30d', '30 дней'], ['all', 'Всё время']].map(function (p) {
      return '<button type="button" data-period="' + p[0] + '" class="' + (p[0] === periodValue ? 'on' : '') + '" aria-pressed="' + (p[0] === periodValue) + '">' + p[1] + '</button>';
    }).join('');
    Array.prototype.forEach.call(periodSeg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () { periodValue = btn.dataset.period; renderFilters(); loadAndRender(); });
    });

    var noReceiptBtn = document.getElementById('c-no-receipt-toggle');
    noReceiptBtn.classList.toggle('on', noReceiptOnly);
    noReceiptBtn.setAttribute('aria-pressed', noReceiptOnly ? 'true' : 'false');
  }

  async function loadAndRender() {
    await loadEntries();
    renderSummary();
    renderRows();
  }

  // ---- Форма (drawer) ----
  function renderCategoryGrid() {
    var grid = document.getElementById('c-f-category-grid');
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
    // По отзыву пользователя: раньше поле "Фото чека" было видно всегда
    // (только звёздочка "*" появлялась/пропадала), непонятно было,
    // обязательно оно или просто не нужно — "а то будут вопросы". Чек
    // либо нужен категории, либо нет вообще (ЗП/Прочее/Продажа бетона) —
    // поэтому поле целиком показываем только когда rule.receiptRequired.
    // Комментарий — по отдельному отзыву — наоборот уместен всегда (даже
    // необязательный, например "аванс за май" к топливу), поэтому его НЕ
    // прячем, меняется только звёздочка "обязательно".
    document.getElementById('c-f-receipt-field').hidden = !(draftType === 'expense' && rule.receiptRequired);
    document.getElementById('c-f-comment-req').hidden = !rule.commentRequired;
    document.getElementById('c-f-order-field').hidden = draftCategory !== 'concrete_sale';
    if (draftCategory === 'concrete_sale') renderOrderPicker();
  }

  function recentPlantOrders() {
    var plantId = document.getElementById('c-f-plant').value;
    // По отзыву пользователя: "продажа бетона" — это заказы буквально за
    // 1-3 дня (это и есть "последние"), и только без НДС — заказы с НДС
    // проходят по безналу/счёту, а не наличкой в кассу. Раньше сюда попадали
    // вообще все незаказ-отменённые заказы завода, включая старые и с НДС.
    var cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return (State.data.orders || []).filter(function (o) {
      return o.plantId === plantId && !o.cancelledAt && !o.vatApplied && new Date(o.createdAt).getTime() >= cutoff;
    }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).slice(0, 8);
  }

  function renderOrderPicker() {
    var list = document.getElementById('c-f-order-list');
    var orders = recentPlantOrders();
    if (!draftOrderId && orders.length) draftOrderId = orders[0].id;
    list.innerHTML = orders.map(function (o) {
      var on = o.id === draftOrderId;
      return '<label class="pick' + (on ? ' on' : '') + '" data-order-id="' + o.id + '">' +
        '<input type="radio" name="c-order" ' + (on ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--ink)">' +
        '<span class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + o.recipeName + ' · ' + Format.fmtNum(o.saleVolume, 1, 'м³') + '</span><span class="hint">' + new Date(o.createdAt).toLocaleDateString('ru-RU') + '</span></span>' +
        '<span class="num" style="font-weight:600;white-space:nowrap">' + Format.fmtNum(o.totalRevenue, 0) + '</span>' +
      '</label>';
    }).join('') || '<p class="hint">На этом заводе нет недавних заказов.</p>';
    Array.prototype.forEach.call(list.querySelectorAll('[data-order-id]'), function (label) {
      label.addEventListener('click', function () {
        draftOrderId = label.dataset.orderId;
        var order = orders.find(function (o) { return o.id === draftOrderId; });
        if (order) NumericInput.setFormattedValue(document.getElementById('c-f-amount'), order.totalRevenue);
        renderOrderPicker();
      });
    });
  }

  function renderPlantSelect(preferredId) {
    var select = document.getElementById('c-f-plant');
    var plants = State.data.plants || [];
    var isAdmin = Auth.isAtLeast('admin');
    document.getElementById('c-f-plant-field').hidden = !(isAdmin && plants.length > 1);
    select.innerHTML = plants.map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
    var valid = plants.some(function (p) { return p.id === preferredId; });
    select.value = valid ? preferredId : (Plant.currentPlantId() || (plants[0] && plants[0].id) || '');
  }

  // Карточка "Фото чека" — вид один в один по макету (Cash.dc.html/
  // MobileCashForm.dc.html: превью 72×72 + статус/подсказка + кнопка
  // справа) вместо голого <input type="file">, который был раньше —
  // по отзыву пользователя ("прикрепление фото более симпатичным, более
  // похожим на макет").
  var RECEIPT_PLACEHOLDER_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.2" r="3.4"/></svg>';
  function renderReceiptPreview(imgSrc, statusText, hintText, btnLabel) {
    document.getElementById('c-f-receipt-thumb').innerHTML = imgSrc
      ? '<img src="' + imgSrc + '" style="width:100%;height:100%;object-fit:cover;display:block">'
      : RECEIPT_PLACEHOLDER_ICON;
    document.getElementById('c-f-receipt-status').textContent = statusText;
    document.getElementById('c-f-receipt-hint').textContent = hintText;
    document.getElementById('c-f-receipt-btn').textContent = btnLabel;
  }

  function resetReceiptField() {
    draftReceiptDataUrl = null;
    draftReceiptCleared = false;
    document.getElementById('c-f-receipt-input').value = '';
    renderReceiptPreview(null, 'Нет фото', 'Прикрепите фото чека', 'Прикрепить');
  }

  function openForCreate() {
    editingId = null;
    draftType = 'expense';
    draftCategory = 'fuel';
    draftOrderId = null;
    document.getElementById('c-drawer-title').textContent = 'Новая запись';
    document.getElementById('c-save-btn').textContent = 'Добавить запись';
    document.getElementById('c-delete-btn').hidden = true;
    document.getElementById('c-form-error').hidden = true;
    renderPlantSelect(plantFilterValue || Plant.currentPlantId());
    setDraftType('expense');
    NumericInput.setFormattedValue(document.getElementById('c-f-amount'), '');
    document.getElementById('c-f-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('c-f-comment').value = '';
    resetReceiptField();
    document.getElementById('c-drawer').hidden = false;
  }

  function openForEdit(entry) {
    // admin правит когда угодно, без окна (см. backend/handlers/cash-entries.js
    // ::assertEditable — тот же бэкенд всё равно проверит ещё раз).
    var ageMinutes = (Date.now() - new Date(entry.insertedAt).getTime()) / 60000;
    if (!Auth.isAtLeast('admin') && ageMinutes > 20) { alert('Окно редактирования (20 мин) истекло — используйте «Сторно».'); return; }
    editingId = entry.id;
    draftType = entry.type;
    draftCategory = entry.category;
    draftOrderId = entry.orderId;
    document.getElementById('c-drawer-title').textContent = 'Изменить запись';
    document.getElementById('c-save-btn').textContent = 'Сохранить';
    document.getElementById('c-delete-btn').hidden = false;
    document.getElementById('c-form-error').hidden = true;
    renderPlantSelect(entry.plantId);
    document.getElementById('c-f-plant').disabled = true; // завод не меняется при правке
    setDraftType(entry.type, true);
    NumericInput.setFormattedValue(document.getElementById('c-f-amount'), Math.abs(entry.amount));
    document.getElementById('c-f-date').value = entry.occurredAt;
    document.getElementById('c-f-comment').value = entry.comment || '';
    resetReceiptField();
    if (entry.receiptPath) renderReceiptPreview(entry.receiptPath, 'Чек прикреплён', 'Текущее фото', 'Переснять');
    document.getElementById('c-drawer').hidden = false;
  }

  function setDraftType(type, lockType) {
    draftType = type;
    var seg = document.getElementById('c-f-type-seg');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('on', btn.dataset.type === type);
      btn.setAttribute('aria-pressed', btn.dataset.type === type ? 'true' : 'false');
      btn.disabled = !!lockType;
    });
    if (!categoriesFor(type).some(function (c) { return c.id === draftCategory; })) {
      draftCategory = categoriesFor(type)[0].id;
    }
    applyCategoryRules();
  }

  function closeDrawer() { document.getElementById('c-drawer').hidden = true; document.getElementById('c-f-plant').disabled = false; }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('c-form-error');
    errorEl.hidden = true;
    var rule = categoryRule(draftType, draftCategory);
    var payload = {
      plantId: document.getElementById('c-f-plant').value,
      type: draftType,
      category: draftCategory,
      amount: NumericInput.parseNumber(document.getElementById('c-f-amount').value) || 0,
      comment: document.getElementById('c-f-comment').value.trim(),
      occurredAt: document.getElementById('c-f-date').value
    };
    if (draftCategory === 'concrete_sale') payload.orderId = draftOrderId;
    if (!(payload.amount > 0)) { errorEl.textContent = 'Укажите сумму больше нуля.'; errorEl.hidden = false; return; }
    if (rule.commentRequired && !payload.comment) { errorEl.textContent = 'Для категории «' + rule.label + '» комментарий обязателен.'; errorEl.hidden = false; return; }
    if (draftReceiptDataUrl) payload.receiptDataUrl = draftReceiptDataUrl;
    if (draftReceiptCleared) payload.removeReceipt = true;
    if (rule.receiptRequired && !draftReceiptDataUrl && !(editingId && !draftReceiptCleared)) {
      errorEl.textContent = 'Для категории «' + rule.label + '» нужно фото чека.';
      errorEl.hidden = false;
      return;
    }
    try {
      if (editingId) await Api.put('/cash-entries/' + editingId, payload);
      else await Api.post('/cash-entries', payload);
      closeDrawer();
      await loadAndRender();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!confirm('Удалить запись? Это возможно только в течение окна редактирования.')) return;
    try {
      await Api.del('/cash-entries/' + editingId);
      closeDrawer();
      await loadAndRender();
    } catch (err) {
      alert(err.message);
    }
  }

  // Экспорт — по отзыву пользователя ("фото в столбце не работает, давай
  // тогда отдельно папку с названием месяца"): попытка вписать base64-фото
  // прямо в ячейку HTML-как-бы-xls оказалась ненадёжной (Excel далеко не
  // всегда рисует data:-картинку в такой "маскировке"). Вместо этого —
  // честный .zip: CSV-ведомость в корне + рядом папка с реальными файлами
  // фото чеков, названная по текущему периоду. Тут же и второе требование
  // ("выгрузка должна совпадать с тем что на экране") — reflowFolderName()
  // берёт то же periodValue, что сейчас выбрано в фильтре периода, а сами
  // entries уже отфильтрованы currentQueryString() ровно так же, как для
  // отрисовки таблицы (см. loadEntries()) — экспортируется штатно то же,
  // что показано.
  function periodFolderName() {
    var now = new Date();
    if (periodValue === 'month') {
      var label = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    if (periodValue === '30d') {
      var range = periodRange();
      var f = range.from.split('-'), t = range.to.split('-');
      return '30 дней (' + f[2] + '.' + f[1] + '–' + t[2] + '.' + t[1] + '.' + t[0] + ')';
    }
    return 'Всё время';
  }

  // По отзыву пользователя: имя файла должно нести дату записи и её текст
  // (комментарий — если пусто, категория), чтобы по одному только списку
  // файлов в папке было видно, к какой записи какое фото и было ли оно
  // вообще, без сверки с CSV. Время — до секунд (не до минуты, как раньше)
  // + usedNames ниже — двойная защита от совпадений имён, а не просто
  // "обычно не совпадёт": секунда почти никогда не повторяется, а на тот
  // редкий случай, когда всё-таки совпало (дата+текст+сумма один в один),
  // usedNames гарантированно различит их суффиксом "-2", "-3"...
  function receiptFileName(e, usedNames, ext) {
    var d = new Date(e.insertedAt);
    var stamp = e.occurredAt + '_' + d.toTimeString().slice(0, 8).replace(/:/g, '-');
    var text = (e.comment || '').trim() || (CATEGORY_LABELS[e.category] || e.category);
    text = text.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    var base = stamp + '_' + text + '_' + Math.round(Math.abs(e.amount)) + 'р';
    var name = base + ext;
    var n = 2;
    while (usedNames[name]) { name = base + '-' + n + ext; n++; }
    usedNames[name] = true;
    return name;
  }

  async function exportToExcel() {
    if (!entries.length) return;
    var btn = document.getElementById('c-export-btn');
    var originalLabel = btn.textContent;
    btn.disabled = true;
    var folderName = periodFolderName();
    var headers = ['Дата', 'Время', 'Завод', 'Тип', 'Категория', 'Сумма', 'Комментарий', 'Чек', 'Статус'];
    function csvEscape(v) { var s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    function csvNum(n) { return (Math.round((n || 0) * 100) / 100).toString().replace('.', ','); }
    var zipFiles = [];
    var rows = [];
    var usedNames = {};
    try {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        btn.textContent = 'Готовим файл… ' + (i + 1) + '/' + entries.length;
        var st = statusFor(e);
        var receiptCell = 'нет';
        if (e.receiptPath) {
          try {
            var res = await fetch(e.receiptPath);
            if (!res.ok) throw new Error('http ' + res.status);
            var buf = await res.arrayBuffer();
            var ext = (e.receiptPath.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
            var fname = receiptFileName(e, usedNames, ext);
            zipFiles.push({ name: folderName + '/' + fname, data: new Uint8Array(buf) });
            receiptCell = fname;
          } catch (err) {
            receiptCell = 'ошибка загрузки фото';
          }
        }
        rows.push([e.occurredAt, timeLabel(e.insertedAt), e.plantName, e.type === 'income' ? 'Доход' : 'Расход', CATEGORY_LABELS[e.category], csvNum(e.amount), e.comment || '', receiptCell, st.label]);
      }
      var csv = '﻿' + [headers].concat(rows).map(function (r) { return r.map(csvEscape).join(';'); }).join('\r\n');
      zipFiles.unshift({ name: 'ДДС ' + folderName + '.csv', data: new TextEncoder().encode(csv) });
      var blob = ZipWriter.build(zipFiles);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'dds-' + new Date().toISOString().slice(0, 10) + '.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function render() {
    renderFilters();
    renderSummary();
    renderRows();
  }

  function init() {
    document.getElementById('page-cash').innerHTML = HTML;
    document.getElementById('c-add-btn').addEventListener('click', openForCreate);
    document.getElementById('c-export-btn').addEventListener('click', exportToExcel);
    document.getElementById('c-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('c-form').addEventListener('submit', handleSubmit);
    document.getElementById('c-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('c-plant-filter').addEventListener('change', function () { plantFilterValue = this.value; renderFilters(); loadAndRender(); });
    document.getElementById('c-category-filter').addEventListener('change', function () { categoryFilterValue = this.value; loadAndRender(); });
    document.getElementById('c-no-receipt-toggle').addEventListener('click', function () {
      noReceiptOnly = !noReceiptOnly;
      renderFilters();
      loadAndRender();
    });
    document.getElementById('c-f-type-seg').querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () { setDraftType(btn.dataset.type); });
    });
    document.getElementById('c-f-plant').addEventListener('change', function () { if (draftCategory === 'concrete_sale') { draftOrderId = null; renderOrderPicker(); } });
    NumericInput.attach(document.getElementById('c-f-amount'));
    document.getElementById('c-f-receipt-btn').addEventListener('click', function () {
      document.getElementById('c-f-receipt-input').click();
    });
    document.getElementById('c-f-receipt-input').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      renderReceiptPreview(null, 'Обработка…', 'Сжимаем фото', 'Прикрепить');
      PhotoCompress.fromFile(file).then(function (dataUrl) {
        draftReceiptDataUrl = dataUrl;
        draftReceiptCleared = false;
        var now = new Date();
        renderReceiptPreview(dataUrl, 'Чек прикреплён', 'сегодня, ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'Переснять');
      }).catch(function (err) {
        renderReceiptPreview(null, 'Не удалось прочитать фото', err.message, 'Прикрепить');
      });
    });
    document.addEventListener('click', closeAllMenus);
  }

  // renderedMode: тот же приём, что в screen-orders.js/screen-main.js —
  // desktop-контроллер сам решает, чья разметка (своя или mobile-cash.js)
  // сейчас в #page-cash, и пересобирает DOM только при первом показе/
  // переходе через брейкпоинт.
  var renderedMode = null;
  function show() {
    if (window.Viewport && Viewport.isMobile()) {
      if (renderedMode !== 'mobile') { MobileCashScreen.init(); renderedMode = 'mobile'; }
      MobileCashScreen.show();
      return;
    }
    if (renderedMode !== 'desktop') { init(); renderedMode = 'desktop'; }
    render();
    loadAndRender();
  }

  window.CashScreen = { show: show, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, INCOME_CATEGORIES: INCOME_CATEGORIES, CATEGORY_LABELS: CATEGORY_LABELS };
})();
