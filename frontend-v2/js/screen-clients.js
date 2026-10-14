(function () {
  // Клиенты — модуль от 25.09.2026 (запрошен Капланом, см. документ
  // "AdatBeton Calc v2 — архитектура модулей"): сводный объём и сумма по
  // каждому клиенту за период. С change client-list (14.10.2026) — ещё и
  // мини-CRM: клиент привязан к заводу, в карточке его условия (объект,
  // доставка, НДС, миксер, макс. загрузка) и цены по рецептам — «по чём мы
  // кому продаём». Раскладка — по образцу «Персонала» и макетов Clients*.dc.html
  // (где макет расходится со спекой, верна спека: цена с НДС видна у всех
  // клиентов, период — прежние сегменты).
  var VAT_MULT = 1.22;
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap">Все заводы</span><h1>Клиенты</h1></div><div class="page-head-actions"><button class="btn pri sm" id="cl-add-btn">Новый клиент</button></div></div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<div class="seg" role="group" aria-label="Завод" id="cl-plant-seg"></div>' +
      '<div class="seg" role="group" aria-label="Период" id="cl-period-seg" style="width:360px"></div>' +
      '<input class="inp" id="cl-search" style="width:220px" placeholder="Поиск клиента" aria-label="Поиск клиента">' +
    '</div>' +
    '<div class="ref-layout">' +
      '<div class="ref-main">' +
        '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
          '<div class="row head" style="grid-template-columns:1.8fr 110px 90px 1fr 1fr"><div>Клиент</div><div>Тип</div><div class="r">Заказов</div><div class="r">Объём</div><div class="r">Сумма</div></div>' +
          '<div id="cl-groups"></div>' +
          '<p class="empty-state" id="cl-empty" hidden>Клиентов не найдено.</p>' +
        '</section>' +
        '<p class="hint" style="margin:0">Объём и сумма — по заказам за выбранный период (отменённые не считаются). Клиент с 0 заказов за период всё равно в списке — просто ничего не отгружено именно сейчас.</p>' +
      '</div>' +
      '<aside class="drawer" id="cl-drawer" hidden style="padding:0">' +
        '<div class="drawer-head"><h2 id="cl-drawer-title">Новый клиент</h2><button type="button" class="btn ghost icon" id="cl-drawer-close" aria-label="Закрыть">✕</button></div>' +
        '<form id="cl-form" style="display:flex;flex-direction:column;flex:1;min-height:0">' +
          '<div style="flex:1;overflow:auto">' +
            '<section class="stack g10" style="padding:14px 22px;border-bottom:1px solid var(--border-soft)">' +
              '<span class="sub">Основное</span>' +
              '<div class="field"><label for="cl-f-name">Название</label><input id="cl-f-name" class="inp" required placeholder="ООО или ФИО"></div>' +
              '<div class="grid-2">' +
                '<div class="field"><span class="cl-lbl">Тип</span><div class="seg" role="group" aria-label="Тип" id="cl-f-type-seg"><button type="button" data-type="individual">Физлицо</button><button type="button" data-type="legal">Юрлицо</button></div></div>' +
                '<div class="field"><span class="cl-lbl">НДС</span><div class="seg" role="group" aria-label="НДС" id="cl-f-vat-seg"><button type="button" data-vat="1">С НДС</button><button type="button" data-vat="0">Без НДС</button></div></div>' +
              '</div>' +
              '<label class="cl-swt"><span>Разовые покупатели (без памяти)</span><button type="button" class="tog" id="cl-f-walk-in" aria-pressed="false"><i></i></button></label>' +
              '<p class="hint" id="cl-f-walk-in-note" style="margin:0" hidden>Общий клиент для разовых покупателей: виден на всех заводах, заказы не запоминают ему цену, объект и миксер.</p>' +
              '<div class="field" id="cl-f-plant-field"><span class="cl-lbl">Завод</span><div class="seg" role="group" aria-label="Завод" id="cl-f-plant-seg"></div></div>' +
            '</section>' +
            '<section class="stack g10" id="cl-terms-section" style="padding:14px 22px;border-bottom:1px solid var(--border-soft)">' +
              '<span class="sub">Объект и доставка</span>' +
              '<div style="display:grid;grid-template-columns:minmax(0,1fr) 126px 108px;gap:10px;align-items:end">' +
                '<div class="field"><label for="cl-f-address">Адрес</label><input id="cl-f-address" class="inp" placeholder="Населённый пункт, улица"></div>' +
                '<div class="field"><label for="cl-f-dist">Км в одну сторону</label><div class="unit"><input id="cl-f-dist" class="inp num" inputmode="decimal"><span>км</span></div></div>' +
                '<div class="field"><label for="cl-f-delivery">Цена доставки</label><div class="unit"><input id="cl-f-delivery" class="inp num" inputmode="decimal"><span>₽/м³</span></div></div>' +
              '</div>' +
              '<div class="grid-2">' +
                '<div class="field"><label for="cl-f-mixer">Миксер</label><select id="cl-f-mixer" class="inp"></select></div>' +
                '<div class="field"><label for="cl-f-max-load">Макс. загрузка</label><div class="unit"><input id="cl-f-max-load" class="inp num" inputmode="decimal" placeholder="по вместимости миксера"><span>м³</span></div></div>' +
                '<label class="cl-swt"><span>Соседний город</span><button type="button" class="tog" id="cl-f-nb-city" aria-pressed="false"><i></i></button></label>' +
                '<label class="cl-swt"><span>Самовывоз</span><button type="button" class="tog" id="cl-f-pickup" aria-pressed="false"><i></i></button></label>' +
              '</div>' +
              '<span class="hint num" id="cl-f-terms-updated"></span>' +
            '</section>' +
            '<section class="stack g12" id="cl-prices-section" style="padding:14px 22px 18px">' +
              '<div class="spread"><span class="sub" id="cl-prices-title">Цены</span><button type="button" class="btn ghost sm" id="cl-price-add-btn" style="height:32px;padding:0 10px">+ Добавить цену</button></div>' +
              '<p class="hint" id="cl-prices-note" style="margin:0" hidden></p>' +
              '<div class="cl-prices" id="cl-prices"></div>' +
            '</section>' +
          '</div>' +
          '<div class="drawer-foot">' +
            '<p class="banner" id="cl-form-error" hidden></p>' +
            '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">' +
              '<button type="button" class="btn ghost" id="cl-delete-btn" style="color:#8C2217;border-color:#E3B8B1" hidden>Удалить</button>' +
              '<button type="button" class="btn ghost" id="cl-cancel-btn">Отмена</button>' +
              '<button type="submit" class="btn pri" id="cl-save-btn">Сохранить</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</aside>' +
    '</div>';

  var PERIODS = [
    { id: 'month', label: 'Этот месяц' },
    { id: '30d', label: 'Последние 30 дней' },
    { id: 'all', label: 'Всё время' }
  ];
  var periodValue = 'month';
  var plantFilterValue = 'all'; // 'all' | <plantId>
  var searchValue = '';
  var editingId = null;
  // Черновик карточки — сегменты/тумблеры живут в нём до «Сохранить».
  var draft = { type: 'individual', vatGross: false, plantId: null, nbCity: false, pickup: false, walkIn: false };
  // Строка добавления/правки цены: null | { recipeId, isNew, net }. net —
  // точная цена без НДС из того поля, что правили последним: введённые
  // 10 000 с НДС сохраняются как 10 000 / 1,22, без округления до копеек,
  // и после сохранения снова показываются ровно 10 000,00.
  var priceEdit = null;

  // Свои списки, а не State.data.clients/recipes — те загружены под форму
  // заказа текущего завода; экрану нужны клиенты и рецепты ВСЕХ заводов
  // (GET без ?plantId= у manager+, как у «Персонала»).
  var allClients = [];
  var allRecipes = [];
  async function loadLists() {
    var res = await Promise.allSettled([Api.get('/clients'), Api.get('/recipes')]);
    allClients = res[0].status === 'fulfilled' ? res[0].value : [];
    allRecipes = res[1].status === 'fulfilled' ? res[1].value : [];
  }

  function plants() { return State.data.plants || []; }
  function plantById(id) { return plants().find(function (p) { return p.id === id; }) || null; }
  function clientById(id) { return allClients.find(function (c) { return c.id === id; }) || null; }
  function recipeById(id) { return allRecipes.find(function (r) { return r.id === id; }) || null; }
  function fmtMoney2(n) { return Format.fmtNum(n, 2); }
  function dateLabel(iso) { return new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }); }

  function periodRange() {
    var now = new Date();
    if (periodValue === 'month') {
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
    }
    if (periodValue === '30d') {
      var start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start: start, end: new Date(now.getTime() + 86400000) };
    }
    return { start: new Date(0), end: new Date(now.getTime() + 86400000) };
  }

  function filteredOrders() {
    var range = periodRange();
    return (State.data.orders || []).filter(function (o) {
      if (o.cancelledAt) return false;
      var d = new Date(o.createdAt);
      if (d < range.start || d >= range.end) return false;
      if (plantFilterValue !== 'all' && o.plantId !== plantFilterValue) return false;
      return true;
    });
  }

  function objectLabel(c) {
    if (c.selfPickup) return 'самовывоз';
    var parts = [];
    if (c.siteAddress) parts.push(c.siteAddress);
    if (c.siteDistanceKm != null) parts.push(Format.fmtNum(c.siteDistanceKm, 0, 'км'));
    return parts.join(' · ');
  }

  // Директория (все клиенты, даже без заказов за период) + цифры отчёта за
  // период поверх неё, сгруппировано по заводам (+ «Без завода» — разобрать,
  // + «Без клиента» для заказов, созданных до модуля клиентов).
  function buildGroups() {
    var orders = filteredOrders();
    var statsById = {};
    var legacy = { volume: 0, revenue: 0, count: 0 };
    orders.forEach(function (o) {
      var s = o.clientId ? (statsById[o.clientId] = statsById[o.clientId] || { volume: 0, revenue: 0, count: 0 }) : legacy;
      s.volume += o.saleVolume || 0;
      s.revenue += o.totalRevenue || 0;
      s.count += 1;
    });
    var q = searchValue.trim().toLowerCase();
    function rowsFor(list) {
      var rows = list.map(function (c) {
        var s = statsById[c.id] || { volume: 0, revenue: 0, count: 0 };
        return { client: c, volume: s.volume, revenue: s.revenue, count: s.count };
      });
      rows.sort(function (a, b) {
        if ((a.count === 0) !== (b.count === 0)) return a.count === 0 ? 1 : -1;
        if (b.volume !== a.volume) return b.volume - a.volume;
        return a.client.name.localeCompare(b.client.name, 'ru');
      });
      return rows;
    }
    function group(label, list, opts) {
      var rows = rowsFor(list);
      var totals = rows.reduce(function (t, r) { t.count += r.count; t.volume += r.volume; t.revenue += r.revenue; return t; }, { count: 0, volume: 0, revenue: 0 });
      return Object.assign({ label: label, size: list.length, totals: totals, rows: rows.filter(function (r) { return !q || r.client.name.toLowerCase().indexOf(q) >= 0; }) }, opts);
    }

    var groups = [];
    var visiblePlants = plantFilterValue === 'all' ? plants() : plants().filter(function (p) { return p.id === plantFilterValue; });
    visiblePlants.forEach(function (p) {
      groups.push(group(p.name, allClients.filter(function (c) { return c.plantId === p.id; })));
    });
    if (plantFilterValue === 'all') {
      groups.push(group('Без завода', allClients.filter(function (c) { return !c.plantId && !c.walkIn; }), { noPlant: true }));
    }
    // Разовые покупатели видны на всех заводах — отдельной группой в любом сегменте.
    groups.push(group('Разовые покупатели', allClients.filter(function (c) { return c.walkIn; }), { walkIn: true }));
    groups = groups.filter(function (g) { return g.size > 0; });
    if (legacy.count > 0 && !q) groups.push({ label: 'Без клиента (старые заказы)', legacy: legacy, rows: [], size: 0, totals: legacy });
    return groups;
  }

  function renderPlantSeg() {
    var seg = document.getElementById('cl-plant-seg');
    var buttons = [{ value: 'all', label: 'Все · ' + allClients.length }].concat(plants().map(function (p) {
      return { value: p.id, label: p.name + ' · ' + allClients.filter(function (c) { return c.plantId === p.id; }).length };
    }));
    if (!buttons.some(function (b) { return b.value === plantFilterValue; })) plantFilterValue = 'all';
    seg.innerHTML = buttons.map(function (b) {
      return '<button type="button" style="padding:0 16px;white-space:nowrap" data-value="' + b.value + '" class="' + (b.value === plantFilterValue ? 'on' : '') + '" aria-pressed="' + (b.value === plantFilterValue) + '">' + b.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () { plantFilterValue = btn.dataset.value; renderPlantSeg(); renderTable(); });
    });
  }

  function renderPeriodSeg() {
    var seg = document.getElementById('cl-period-seg');
    seg.innerHTML = PERIODS.map(function (p) {
      return '<button type="button" data-period="' + p.id + '" class="' + (p.id === periodValue ? 'on' : '') + '" aria-pressed="' + (p.id === periodValue) + '">' + p.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () { periodValue = btn.dataset.period; renderPeriodSeg(); renderTable(); });
    });
  }

  var COLS = 'grid-template-columns:1.8fr 110px 90px 1fr 1fr';

  function clientRow(r, noPlant) {
    var c = r.client;
    var obj = c.walkIn ? 'без памяти, на всех заводах' : objectLabel(c);
    return '<div class="row" style="' + COLS + ';min-height:52px;cursor:pointer" data-client-id="' + c.id + '">' +
      '<div class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + c.name + '</span>' +
        (noPlant
          ? '<span><button type="button" class="btn ghost sm" style="height:26px;padding:0 8px;font-size:12px" data-pick-plant="' + c.id + '">Выбрать завод</button></span>'
          : (obj ? '<span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + obj + '</span>' : '')) +
      '</div>' +
      '<div class="hint">' + (c.type === 'legal' ? 'Юрлицо' : 'Физлицо') + '</div>' +
      '<div class="r num hint">' + (r.count || '—') + '</div>' +
      '<div class="r num">' + (r.count ? Format.fmtNum(r.volume, 1, 'м³') : '—') + '</div>' +
      '<div class="r num" style="font-weight:600">' + (r.count ? Format.fmt(r.revenue, 0) : '—') + '</div>' +
    '</div>';
  }

  function renderTable() {
    var groups = buildGroups();
    var container = document.getElementById('cl-groups');
    document.getElementById('cl-empty').hidden = groups.some(function (g) { return g.rows.length > 0 || g.legacy; });
    container.innerHTML = groups.map(function (g) {
      var t = g.totals;
      var head = '<div class="row" style="' + COLS + ';min-height:40px;background:var(--surface-3);border-bottom:1px solid var(--border)">' +
        '<div style="font-weight:600">' + g.label + (g.legacy ? '' : ' · ' + g.size) + (g.noPlant ? ' <span class="chip warn" style="margin-left:6px">разобрать</span>' : '') + '</div><div></div>' +
        '<div class="r num hint">' + (t.count || '—') + '</div>' +
        '<div class="r num hint">' + (t.count ? Format.fmtNum(t.volume, 1, 'м³') : '—') + '</div>' +
        '<div class="r num" style="font-weight:600">' + (t.count ? Format.fmt(t.revenue, 0) : '—') + '</div>' +
      '</div>';
      return head + g.rows.map(function (r) { return clientRow(r, g.noPlant); }).join('');
    }).join('');
    Array.prototype.forEach.call(container.querySelectorAll('[data-client-id]'), function (row) {
      row.addEventListener('click', function () {
        var client = clientById(row.dataset.clientId);
        if (client) openForEdit(client);
      });
    });
    // «Выбрать завод» — открывает карточку с выбором завода в фокусе.
    Array.prototype.forEach.call(container.querySelectorAll('[data-pick-plant]'), function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var client = clientById(btn.dataset.pickPlant);
        if (!client) return;
        openForEdit(client);
        var first = document.querySelector('#cl-f-plant-seg button');
        if (first) first.focus();
      });
    });
  }

  // ---- Карточка (drawer) ----
  function setSeg(id, attr, value) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function (btn) {
      var on = btn.dataset[attr] === String(value);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setTog(id, on) {
    var el = document.getElementById(id);
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderDraftControls() {
    setSeg('cl-f-type-seg', 'type', draft.type);
    setSeg('cl-f-vat-seg', 'vat', draft.vatGross ? '1' : '0');
    var seg = document.getElementById('cl-f-plant-seg');
    seg.innerHTML = plants().map(function (p) {
      var on = p.id === draft.plantId;
      return '<button type="button" data-plant="' + p.id + '" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '">' + p.name + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () { draft.plantId = btn.dataset.plant; renderDraftControls(); });
    });
    setTog('cl-f-nb-city', draft.nbCity);
    setTog('cl-f-pickup', draft.pickup);
    setTog('cl-f-walk-in', draft.walkIn);
    document.getElementById('cl-f-walk-in-note').hidden = !draft.walkIn;
    ['cl-f-plant-field', 'cl-terms-section', 'cl-prices-section'].forEach(function (id) {
      document.getElementById(id).hidden = draft.walkIn;
    });
  }

  function renderMixerSelect(selectedId) {
    var select = document.getElementById('cl-f-mixer');
    select.innerHTML = '<option value="">Любой</option>' + (State.data.mixers || []).map(function (m) {
      return '<option value="' + m.id + '">' + m.name + ' · ' + Format.fmtNum(m.capacity, 0, 'м³') + '</option>';
    }).join('');
    select.value = (State.data.mixers || []).some(function (m) { return m.id === selectedId; }) ? selectedId : '';
  }

  function setNum(id, value) {
    var el = document.getElementById(id);
    if (value == null) el.value = ''; else NumericInput.setFormattedValue(el, value);
  }

  function fillForm(client) {
    document.getElementById('cl-form-error').hidden = true;
    document.getElementById('cl-f-name').value = client ? client.name : '';
    draft = {
      type: client ? client.type : 'individual',
      vatGross: client ? client.vatGross : false,
      plantId: client ? client.plantId : (plantFilterValue !== 'all' ? plantFilterValue : null),
      nbCity: client ? client.siteNeighborCity : false,
      pickup: client ? client.selfPickup : false,
      walkIn: client ? !!client.walkIn : false
    };
    renderDraftControls();
    document.getElementById('cl-f-address').value = client ? client.siteAddress : '';
    setNum('cl-f-dist', client ? client.siteDistanceKm : null);
    setNum('cl-f-delivery', client ? client.deliveryChargePerM3 : null);
    setNum('cl-f-max-load', client ? client.maxLoadM3 : null);
    renderMixerSelect(client ? client.mixerId : null);
    var upd = document.getElementById('cl-f-terms-updated');
    upd.textContent = client && client.termsUpdatedAt
      ? 'обновлено ' + dateLabel(client.termsUpdatedAt) + ' · ' + (client.termsSource === 'crm' ? 'CRM' : 'Заказ' + (plantById(client.plantId) ? ' · ' + plantById(client.plantId).name : ''))
      : '';
    upd.hidden = !upd.textContent;
    priceEdit = null;
    renderPrices();
  }

  function openForCreate() {
    editingId = null;
    document.getElementById('cl-drawer-title').textContent = 'Новый клиент';
    document.getElementById('cl-delete-btn').hidden = true;
    document.getElementById('cl-cancel-btn').hidden = false;
    fillForm(null);
    document.getElementById('cl-drawer').hidden = false;
  }

  function openForEdit(client) {
    editingId = client.id;
    document.getElementById('cl-drawer-title').textContent = client.name;
    document.getElementById('cl-delete-btn').hidden = false;
    document.getElementById('cl-cancel-btn').hidden = true;
    fillForm(client);
    document.getElementById('cl-drawer').hidden = false;
  }

  function closeDrawer() { document.getElementById('cl-drawer').hidden = true; priceEdit = null; }

  // ---- Цены ----
  // Рецепты завода клиента (сохранённого — правка цен идёт сразу в API, до
  // «Сохранить» смена завода в черновике на них не влияет).
  function clientPlantRecipes(client) {
    return allRecipes.filter(function (r) { return client && r.plantId === client.plantId; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
  }

  function priceRow(client, p) {
    var recipe = recipeById(p.recipeId);
    var foreign = recipe && recipe.plantId !== client.plantId;
    var foreignPlant = foreign ? plantById(recipe.plantId) : null;
    var editing = priceEdit && !priceEdit.isNew && priceEdit.recipeId === p.recipeId;
    if (editing) return priceEditRow(client, p.recipeId, p.priceNet);
    return '<div class="cl-pr">' +
      '<span style="font-weight:600">' + (recipe ? recipe.name : '—') + '</span>' +
      '<span class="r num" style="font-weight:500">' + fmtMoney2(p.priceNet) + '</span>' +
      '<span class="r num">' + fmtMoney2(p.priceNet * VAT_MULT) + '</span>' +
      '<span style="display:flex;justify-content:flex-end">' +
        '<button type="button" class="cl-ib" aria-label="Изменить цену" data-price-edit="' + p.recipeId + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>' +
        '<button type="button" class="cl-ib" aria-label="Удалить цену" data-price-del="' + p.recipeId + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>' +
      '</span>' +
      '<span class="hint num" style="grid-column:1/-1">' + dateLabel(p.updatedAt) + ' · ' + (p.sourceLabel || (p.source === 'crm' ? 'CRM' : 'Заказ')) +
        (foreignPlant ? ' <span class="chip mute" style="height:20px;margin-left:4px">рецепт ' + foreignPlant.name + '</span>' : '') + '</span>' +
    '</div>';
  }

  function priceEditRow(client, recipeId, priceNet) {
    var recipeCell;
    if (priceEdit.isNew) {
      var taken = {};
      (client.prices || []).forEach(function (p) { taken[p.recipeId] = true; });
      var options = clientPlantRecipes(client).filter(function (r) { return !taken[r.id]; });
      recipeCell = '<select class="inp" id="cl-price-recipe" style="height:36px;padding:0 8px" aria-label="Рецепт">' +
        options.map(function (r) { return '<option value="' + r.id + '"' + (r.id === recipeId ? ' selected' : '') + '>' + r.name + '</option>'; }).join('') + '</select>';
    } else {
      var recipe = recipeById(recipeId);
      recipeCell = '<span style="font-weight:600">' + (recipe ? recipe.name : '—') + '</span>';
    }
    return '<div class="cl-pr-edit">' + recipeCell +
      '<input class="inp num" id="cl-price-input" style="height:36px;text-align:right" inputmode="decimal" aria-label="Цена без НДС" value="' + (priceNet != null ? Format.fmtNum(priceNet, 2) : '') + '">' +
      '<input class="inp num" id="cl-price-gross" style="height:36px;text-align:right" inputmode="decimal" aria-label="Цена с НДС" value="' + (priceNet != null ? Format.fmtNum(priceNet * VAT_MULT, 2) : '') + '">' +
      '<span style="display:flex;justify-content:flex-end;gap:2px">' +
        '<button type="button" class="cl-ib" style="background:var(--ink);color:#fff" aria-label="Сохранить цену" id="cl-price-ok"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></button>' +
        '<button type="button" class="cl-ib" aria-label="Отмена" id="cl-price-cancel"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</span></div>';
  }

  function renderPrices() {
    var client = editingId ? clientById(editingId) : null;
    var list = document.getElementById('cl-prices');
    var note = document.getElementById('cl-prices-note');
    var addBtn = document.getElementById('cl-price-add-btn');
    var prices = client ? (client.prices || []).slice().sort(function (a, b) {
      var ra = recipeById(a.recipeId), rb = recipeById(b.recipeId);
      return (ra ? ra.name : '').localeCompare(rb ? rb.name : '', 'ru');
    }) : [];
    document.getElementById('cl-prices-title').textContent = prices.length ? 'Цены · ' + prices.length : 'Цены';

    // Рецепты у каждого завода свои — без завода цену не поставить.
    var noPlant = !client || !client.plantId;
    var freeRecipes = client ? clientPlantRecipes(client).filter(function (r) { return !prices.some(function (p) { return p.recipeId === r.id; }); }) : [];
    addBtn.disabled = noPlant || !!priceEdit || !freeRecipes.length;
    if (!client) { note.textContent = 'Цен пока нет — добавить их можно после сохранения клиента.'; note.hidden = false; }
    else if (!client.plantId) { note.textContent = 'Сначала выберите завод — рецепты у каждого завода свои.'; note.hidden = false; }
    else if (!prices.length && !priceEdit) { note.textContent = 'Цен пока нет.'; note.hidden = false; }
    else note.hidden = true;

    if (!prices.length && !priceEdit) { list.innerHTML = ''; list.hidden = true; return; }
    list.hidden = false;
    list.innerHTML = '<div class="cl-pr" style="background:var(--surface-3);padding-top:6px;padding-bottom:6px"><span class="cap" style="font-size:10px">Рецепт</span><span class="cap r" style="font-size:10px">Без НДС</span><span class="cap r" style="font-size:10px">С НДС</span><span></span></div>' +
      prices.map(function (p) {
        if (priceEdit && !priceEdit.isNew && priceEdit.recipeId === p.recipeId && priceEdit.net === undefined) priceEdit.net = p.priceNet;
        return priceRow(client, p);
      }).join('') +
      (priceEdit && priceEdit.isNew ? priceEditRow(client, freeRecipes.length ? freeRecipes[0].id : null, null) : '');

    Array.prototype.forEach.call(list.querySelectorAll('[data-price-edit]'), function (btn) {
      btn.addEventListener('click', function () { priceEdit = { recipeId: btn.dataset.priceEdit, isNew: false }; renderPrices(); });
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-price-del]'), function (btn) {
      btn.addEventListener('click', function () { deletePrice(btn.dataset.priceDel); });
    });
    var input = document.getElementById('cl-price-input');
    if (input) {
      // Правка в обе стороны: что знаешь — то и вводишь, второе пересчитывается.
      var grossInput = document.getElementById('cl-price-gross');
      function readField(el) {
        return el.value.trim() === '' ? null : NumericInput.parseNumber(el.value);
      }
      NumericInput.attach(input);
      NumericInput.attach(grossInput);
      input.addEventListener('input', function () {
        var v = readField(input);
        priceEdit.net = v;
        if (v == null) grossInput.value = ''; else NumericInput.setFormattedValue(grossInput, Math.round(v * VAT_MULT * 100) / 100);
      });
      grossInput.addEventListener('input', function () {
        var v = readField(grossInput);
        priceEdit.net = v == null ? null : v / VAT_MULT;
        if (v == null) input.value = ''; else NumericInput.setFormattedValue(input, Math.round(v / VAT_MULT * 100) / 100);
      });
      [input, grossInput].forEach(function (el) {
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); savePrice(); } });
      });
      input.focus();
      document.getElementById('cl-price-ok').addEventListener('click', savePrice);
      document.getElementById('cl-price-cancel').addEventListener('click', function () { priceEdit = null; renderPrices(); });
    }
  }

  async function refreshAfterChange() {
    await Promise.all([loadLists(), State.loadAll()]);
    renderPlantSeg();
    renderTable();
  }

  async function savePrice() {
    var errorEl = document.getElementById('cl-form-error');
    errorEl.hidden = true;
    var recipeId = priceEdit.isNew ? document.getElementById('cl-price-recipe').value : priceEdit.recipeId;
    var priceNet = priceEdit.net;
    if (!recipeId) { errorEl.textContent = 'Выберите рецепт.'; errorEl.hidden = false; return; }
    if (priceNet == null || !(priceNet >= 0)) { errorEl.textContent = 'Укажите цену — без НДС или с НДС.'; errorEl.hidden = false; return; }
    try {
      await Api.put('/clients/' + editingId + '/prices/' + recipeId, { priceNet: priceNet });
      priceEdit = null;
      await refreshAfterChange();
      renderPrices();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function deletePrice(recipeId) {
    var recipe = recipeById(recipeId);
    if (!confirm('Удалить цену клиента по рецепту «' + (recipe ? recipe.name : '') + '»?')) return;
    try {
      await Api.del('/clients/' + editingId + '/prices/' + recipeId);
      await refreshAfterChange();
      renderPrices();
    } catch (err) {
      alert(err.message);
    }
  }

  function numOrNull(id) {
    var raw = document.getElementById(id).value.trim();
    return raw === '' ? null : NumericInput.parseNumber(raw);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('cl-form-error');
    errorEl.hidden = true;
    var name = document.getElementById('cl-f-name').value.trim();
    if (!name) { errorEl.textContent = 'Укажите название клиента.'; errorEl.hidden = false; return; }
    var payload = {
      name: name, type: draft.type, plantId: draft.plantId, vatGross: draft.vatGross,
      siteAddress: document.getElementById('cl-f-address').value.trim(),
      siteDistanceKm: numOrNull('cl-f-dist'),
      deliveryChargePerM3: numOrNull('cl-f-delivery'),
      maxLoadM3: numOrNull('cl-f-max-load'),
      mixerId: document.getElementById('cl-f-mixer').value || null,
      siteNeighborCity: draft.nbCity, selfPickup: draft.pickup, walkIn: draft.walkIn
    };
    if (draft.walkIn) {
      var current = editingId ? clientById(editingId) : null;
      var hasMemory = current && !current.walkIn && (current.plantId || (current.prices || []).length || current.termsUpdatedAt);
      if (hasMemory && !confirm('Сделать «' + name + '» разовыми покупателями? Завод, условия доставки и цены клиента будут стёрты.')) return;
      payload = { name: name, type: draft.type, walkIn: true };
    }
    try {
      var saved;
      if (editingId) {
        saved = await Api.put('/clients/' + editingId, payload);
      } else {
        // Создание + условия одним «Сохранить»: POST заводит карточку с
        // заводом, PUT дописывает условия, если их заполнили.
        saved = await Api.post('/clients', { name: name, type: draft.type, plantId: draft.walkIn ? null : draft.plantId });
        var hasTerms = payload.walkIn || payload.vatGross || payload.siteAddress || payload.siteDistanceKm != null || payload.deliveryChargePerM3 != null ||
          payload.maxLoadM3 != null || payload.mixerId || payload.siteNeighborCity || payload.selfPickup;
        if (hasTerms) saved = await Api.put('/clients/' + saved.id, payload);
      }
      await refreshAfterChange();
      // Новый клиент остаётся открытым — сразу можно добавить цены по КП.
      openForEdit(clientById(saved.id) || saved);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    var client = clientById(editingId);
    if (!confirm('Удалить клиента «' + (client ? client.name : '') + '»? Его цены и условия тоже удалятся. Прошлые заказы останутся с его именем в снимке, просто отвяжутся от живой карточки.')) return;
    try {
      await Api.del('/clients/' + editingId);
      closeDrawer();
      await refreshAfterChange();
    } catch (err) {
      alert(err.message);
    }
  }

  function render() {
    renderPlantSeg();
    renderTable();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-clients').innerHTML = HTML;
    renderPeriodSeg();
    document.getElementById('cl-add-btn').addEventListener('click', openForCreate);
    document.getElementById('cl-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('cl-cancel-btn').addEventListener('click', closeDrawer);
    document.getElementById('cl-search').addEventListener('input', function () { searchValue = this.value; renderTable(); });
    document.getElementById('cl-form').addEventListener('submit', handleSubmit);
    document.getElementById('cl-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('cl-price-add-btn').addEventListener('click', function () { priceEdit = { isNew: true }; renderPrices(); });
    Array.prototype.forEach.call(document.querySelectorAll('#cl-f-type-seg button'), function (btn) {
      btn.addEventListener('click', function () { draft.type = btn.dataset.type; renderDraftControls(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cl-f-vat-seg button'), function (btn) {
      btn.addEventListener('click', function () { draft.vatGross = btn.dataset.vat === '1'; renderDraftControls(); });
    });
    document.getElementById('cl-f-nb-city').addEventListener('click', function (ev) { ev.preventDefault(); draft.nbCity = !draft.nbCity; renderDraftControls(); });
    document.getElementById('cl-f-pickup').addEventListener('click', function (ev) { ev.preventDefault(); draft.pickup = !draft.pickup; renderDraftControls(); });
    document.getElementById('cl-f-walk-in').addEventListener('click', function (ev) { ev.preventDefault(); draft.walkIn = !draft.walkIn; renderDraftControls(); });
    ['cl-f-dist', 'cl-f-delivery', 'cl-f-max-load'].forEach(function (id) { NumericInput.attach(document.getElementById(id)); });
    initialized = true;
  }

  async function show() {
    if (!initialized) init();
    await loadLists();
    render();
  }

  window.ClientsScreen = { show: show };
})();
