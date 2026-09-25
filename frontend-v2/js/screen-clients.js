(function () {
  // Клиенты — новый модуль от 25.09.2026 (запрошен Капланом, см. документ
  // "AdatBeton Calc v2 — архитектура модулей"). Справочник НЕ привязан к
  // заводу (один клиент может заказывать с разных заводов, см. schema.sql),
  // поэтому в отличие от Материалов/Смесей/Техники тут нет per-plant
  // фильтрации списка — вместо этого фильтр по заводу/периоду у самого
  // ОТЧЁТА (какие заказы считать в объём/сумму), как и просил документ:
  // "сводный объём и сумма по каждому клиенту за период, с фильтром по заводу".
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap">Все заводы</span><h1>Клиенты</h1></div><div class="page-head-actions"><button class="btn pri sm" id="cl-add-btn">Новый клиент</button></div></div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<div class="seg" role="group" aria-label="Период" id="cl-period-seg" style="width:360px"></div>' +
      '<select class="inp" id="cl-plant-filter" style="width:200px" aria-label="Завод"></select>' +
      '<input class="inp" id="cl-search" style="width:220px" placeholder="Поиск клиента" aria-label="Поиск клиента">' +
    '</div>' +
    '<div class="ref-layout">' +
      '<div class="ref-main">' +
        '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
          '<div class="row head" style="grid-template-columns:1.8fr 110px 90px 1fr 1fr"><div>Клиент</div><div>Тип</div><div class="r">Заказов</div><div class="r">Объём</div><div class="r">Сумма</div></div>' +
          '<div id="cl-rows"></div>' +
          '<p class="empty-state" id="cl-empty" hidden>Клиентов не найдено.</p>' +
        '</section>' +
        '<p class="hint" style="margin:0">Объём и сумма — по заказам за выбранный период (отменённые не считаются). Клиент с 0 заказов за период всё равно в списке — просто ничего не отгружено именно сейчас.</p>' +
      '</div>' +
      '<aside class="drawer" id="cl-drawer" hidden>' +
        '<div class="drawer-head"><h2 id="cl-drawer-title">Новый клиент</h2><button type="button" class="btn ghost icon" id="cl-drawer-close" aria-label="Закрыть">✕</button></div>' +
        '<form id="cl-form">' +
          '<div class="drawer-body">' +
            '<div class="field"><label for="cl-f-name">Название</label><input id="cl-f-name" class="inp" required placeholder="ФИО или организация"></div>' +
            '<div class="field"><span style="font-size:12px;color:var(--ink-soft);font-weight:500">Тип</span><div class="seg" role="group" aria-label="Тип"><button type="button" data-type="individual" class="on" aria-pressed="true">Физлицо</button><button type="button" data-type="legal" aria-pressed="false">Юрлицо</button></div></div>' +
          '</div>' +
          '<div class="drawer-foot">' +
            '<p class="banner" id="cl-form-error" hidden></p>' +
            '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">' +
              '<button type="button" class="btn ghost" id="cl-delete-btn" style="color:#8C2217;border-color:#E3B8B1" hidden>Удалить</button>' +
              '<button type="submit" class="btn pri" id="cl-save-btn">Добавить клиента</button>' +
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
  var plantFilterValue = '';
  var searchValue = '';
  var editingId = null;
  var draftType = 'individual';

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
      if (plantFilterValue && o.plantId !== plantFilterValue) return false;
      return true;
    });
  }

  // Директория (все клиенты, даже без единого заказа за период) + цифры
  // отчёта за период поверх неё + отдельная строка "Без клиента" для заказов
  // без clientId (созданы до модуля клиентов, см. миграцию в schema.sql) —
  // не кликабельна, это не настоящая карточка клиента.
  function aggregateByClient() {
    var orders = filteredOrders();
    var statsById = {};
    var legacy = { volume: 0, revenue: 0, count: 0 };
    orders.forEach(function (o) {
      if (!o.clientId) {
        legacy.volume += o.saleVolume || 0;
        legacy.revenue += o.totalRevenue || 0;
        legacy.count += 1;
        return;
      }
      if (!statsById[o.clientId]) statsById[o.clientId] = { volume: 0, revenue: 0, count: 0 };
      statsById[o.clientId].volume += o.saleVolume || 0;
      statsById[o.clientId].revenue += o.totalRevenue || 0;
      statsById[o.clientId].count += 1;
    });
    var q = searchValue.trim().toLowerCase();
    var rows = (State.data.clients || [])
      .filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) >= 0; })
      .map(function (c) {
        var s = statsById[c.id] || { volume: 0, revenue: 0, count: 0 };
        return { id: c.id, name: c.name, type: c.type, volume: s.volume, revenue: s.revenue, count: s.count };
      });
    rows.sort(function (a, b) {
      if ((a.count === 0) !== (b.count === 0)) return a.count === 0 ? 1 : -1;
      if (b.volume !== a.volume) return b.volume - a.volume;
      return a.name.localeCompare(b.name, 'ru');
    });
    if (legacy.count > 0 && !q) rows.push({ id: null, name: 'Без клиента (старые заказы)', type: '', volume: legacy.volume, revenue: legacy.revenue, count: legacy.count, legacy: true });
    return rows;
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

  function renderPlantFilter() {
    var select = document.getElementById('cl-plant-filter');
    var plants = State.data.plants || [];
    var prev = plantFilterValue;
    select.innerHTML = '<option value="">Все заводы</option>' + plants.map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join('');
    select.value = plants.some(function (p) { return p.id === prev; }) ? prev : '';
    plantFilterValue = select.value;
  }

  function renderTable() {
    var rows = aggregateByClient();
    document.getElementById('cl-empty').hidden = rows.length > 0;
    document.getElementById('cl-rows').innerHTML = rows.map(function (r) {
      var typeLabel = r.legacy ? '—' : (r.type === 'legal' ? 'Юрлицо' : 'Физлицо');
      return '<div class="row' + (r.legacy ? '' : '') + '" style="grid-template-columns:1.8fr 110px 90px 1fr 1fr;min-height:52px' + (r.legacy ? '' : ';cursor:pointer') + (r.legacy ? ';opacity:.7' : '') + '"' + (r.legacy ? '' : ' data-client-id="' + r.id + '"') + '>' +
        '<div style="font-weight:600">' + r.name + '</div>' +
        '<div class="hint">' + typeLabel + '</div>' +
        '<div class="r num hint">' + r.count + '</div>' +
        '<div class="r num">' + Format.fmtNum(r.volume, 1, 'м³') + '</div>' +
        '<div class="r num" style="font-weight:600">' + Format.fmt(r.revenue, 0) + '</div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#cl-rows [data-client-id]'), function (row) {
      row.addEventListener('click', function () {
        var client = (State.data.clients || []).find(function (c) { return c.id === row.dataset.clientId; });
        if (client) openForEdit(client);
      });
    });
  }

  function setDraftType(type) {
    draftType = type === 'legal' ? 'legal' : 'individual';
    Array.prototype.forEach.call(document.querySelectorAll('#cl-drawer [data-type]'), function (btn) {
      btn.classList.toggle('on', btn.dataset.type === draftType);
      btn.setAttribute('aria-pressed', btn.dataset.type === draftType ? 'true' : 'false');
    });
  }

  function openForCreate() {
    editingId = null;
    document.getElementById('cl-drawer-title').textContent = 'Новый клиент';
    document.getElementById('cl-save-btn').textContent = 'Добавить клиента';
    document.getElementById('cl-delete-btn').hidden = true;
    document.getElementById('cl-form-error').hidden = true;
    document.getElementById('cl-f-name').value = '';
    setDraftType('individual');
    document.getElementById('cl-drawer').hidden = false;
  }

  function openForEdit(client) {
    editingId = client.id;
    document.getElementById('cl-drawer-title').textContent = 'Изменить клиента';
    document.getElementById('cl-save-btn').textContent = 'Сохранить';
    document.getElementById('cl-delete-btn').hidden = false;
    document.getElementById('cl-form-error').hidden = true;
    document.getElementById('cl-f-name').value = client.name;
    setDraftType(client.type);
    document.getElementById('cl-drawer').hidden = false;
  }

  function closeDrawer() { document.getElementById('cl-drawer').hidden = true; }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('cl-form-error');
    errorEl.hidden = true;
    var payload = { name: document.getElementById('cl-f-name').value.trim(), type: draftType };
    if (!payload.name) { errorEl.textContent = 'Укажите название клиента.'; errorEl.hidden = false; return; }
    try {
      if (editingId) await Api.put('/clients/' + editingId, payload);
      else await Api.post('/clients', payload);
      await State.loadAll();
      closeDrawer();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    var client = (State.data.clients || []).find(function (c) { return c.id === editingId; });
    if (!confirm('Удалить клиента «' + (client ? client.name : '') + '»? Прошлые заказы останутся с его именем в снимке, просто отвяжутся от живой карточки.')) return;
    try {
      await Api.del('/clients/' + editingId);
      await State.loadAll();
      closeDrawer();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function render() {
    renderPlantFilter();
    renderTable();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-clients').innerHTML = HTML;
    renderPeriodSeg();
    document.getElementById('cl-add-btn').addEventListener('click', openForCreate);
    document.getElementById('cl-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('cl-plant-filter').addEventListener('change', function () { plantFilterValue = this.value; renderTable(); });
    document.getElementById('cl-search').addEventListener('input', function () { searchValue = this.value; renderTable(); });
    document.getElementById('cl-form').addEventListener('submit', handleSubmit);
    document.getElementById('cl-delete-btn').addEventListener('click', handleDelete);
    Array.prototype.forEach.call(document.querySelectorAll('#cl-drawer [data-type]'), function (btn) {
      btn.addEventListener('click', function () { setDraftType(btn.dataset.type); });
    });
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.ClientsScreen = { show: show };
})();
