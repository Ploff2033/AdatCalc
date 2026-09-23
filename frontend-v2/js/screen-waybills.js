(function () {
  // Порт логики из frontend/js/tab-waybills.js (лимиты часов/рейсов — та же
  // формула, что и на бэкенде, см. backend/handlers/waybill-entries.js) под
  // макет Waybills.dc.html: очередь нераспределённых слева, форма
  // распределения с тремя проверками + список по водителям справа.
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap">Распределение рейсов</span><h1>Путевые листы</h1></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:340px minmax(0,1fr);gap:20px;flex:1;min-height:0" class="wb-grid">' +
      '<section class="card stack" style="overflow:hidden">' +
        '<div class="spread" style="padding:16px 18px;border-bottom:1px solid var(--border-soft)"><h2 style="font-size:17px;font-weight:600">Нераспределённые рейсы</h2><span class="chip act num" id="wb-queue-count">0</span></div>' +
        '<div id="wb-queue" style="overflow-y:auto"></div>' +
        '<p class="empty-state" id="wb-queue-empty" hidden>Все рейсы распределены.</p>' +
      '</section>' +
      '<div class="stack g16">' +
        '<section class="card stack g12" style="padding:16px 18px;border-color:var(--accent)">' +
          '<div class="spread"><h2 style="font-size:17px;font-weight:600">Новая запись</h2><span class="hint">Проверки идут до сохранения</span></div>' +
          '<form id="wb-add-form" class="stack g12">' +
            '<div class="field"><label for="wb-order">Заказ</label><select id="wb-order" class="inp"></select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1.3fr 1.3fr 0.7fr auto;gap:12px;align-items:end">' +
              '<div class="field"><label for="wb-date">Дата</label><input id="wb-date" type="date" class="inp"></div>' +
              '<div class="field"><label for="wb-driver">Водитель</label><select id="wb-driver" class="inp"></select></div>' +
              '<div class="field"><label for="wb-mixer">Миксер</label><select id="wb-mixer" class="inp"></select></div>' +
              '<div class="field"><label for="wb-trips">Рейсов</label><input id="wb-trips" class="inp num" inputmode="numeric"></div>' +
              '<button type="button" class="btn ghost sm" id="wb-max-btn">MAX</button>' +
            '</div>' +
            '<p class="hint" id="wb-hint" style="margin:0"></p>' +
            '<p class="banner" id="wb-error" hidden></p>' +
            '<button class="btn pri" type="submit">Сохранить запись</button>' +
          '</form>' +
        '</section>' +
        '<section class="card stack" style="overflow:hidden;flex:1">' +
          '<div class="spread" style="padding:16px 18px;border-bottom:1px solid var(--border-soft)">' +
            '<h2 style="font-size:17px;font-weight:600">Записи путевых листов</h2>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="wb-select-all"> все</label>' +
              '<button class="btn ghost sm" id="wb-download-btn" disabled>Скачать 4-С</button>' +
            '</div>' +
          '</div>' +
          '<div class="row head" style="grid-template-columns:28px 100px minmax(0,1fr) 140px 70px 70px 32px"><div></div><div>Дата</div><div>Заказ / водитель / машина</div><div class="r">км</div><div class="r">рейсов</div><div class="r">часов</div><div></div></div>' +
          '<div id="wb-entries"></div>' +
          '<p class="empty-state" id="wb-entries-empty" hidden>Записей ещё нет.</p>' +
          '<p class="hint" id="wb-entries-summary" style="margin:8px 18px"></p>' +
        '</section>' +
      '</div>' +
    '</div>';

  var selectedEntryIds = {};

  function cfgLimits() {
    var c = State.data.config || {};
    return { driverShiftHours: c.driverShiftHours || 0, vehicleShiftHours: c.vehicleShiftHours || 0, avgSpeedKmh: c.avgSpeedKmh || 0, unloadMinutes: c.unloadMinutes || 0 };
  }
  function tripHours(distanceKm, cfg) {
    var roundTrip = (distanceKm || 0) * 2;
    var drivingHours = cfg.avgSpeedKmh > 0 ? roundTrip / cfg.avgSpeedKmh : 0;
    return drivingHours + (cfg.unloadMinutes || 0) / 60;
  }
  function entriesForOrder(orderId) { return (State.data.waybillEntries || []).filter(function (e) { return e.orderId === orderId; }); }
  function allocatedForOrder(orderId) { return entriesForOrder(orderId).reduce(function (s, e) { return s + e.tripCount; }, 0); }
  function remainingForOrder(order) { return Math.max(0, (order.tripCount || 0) - allocatedForOrder(order.id)); }
  function deliveryOrders() { return (State.data.orders || []).filter(function (o) { return o.tripCount > 0; }); }
  function unallocatedOrders() {
    return deliveryOrders().filter(function (o) { return remainingForOrder(o) > 0; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }
  function driverUsedHours(driverId, date, excludeId) {
    var cfg = cfgLimits();
    return (State.data.waybillEntries || []).filter(function (e) { return e.driverId === driverId && e.tripDate === date && e.id !== excludeId; })
      .reduce(function (s, e) { return s + e.tripCount * tripHours(e.distanceKm, cfg); }, 0);
  }
  function mixerUsedHours(mixerId, date, excludeId) {
    var cfg = cfgLimits();
    return (State.data.waybillEntries || []).filter(function (e) { return e.mixerId === mixerId && e.tripDate === date && e.id !== excludeId; })
      .reduce(function (s, e) { return s + e.tripCount * tripHours(e.distanceKm, cfg); }, 0);
  }

  function renderQueue() {
    var orders = unallocatedOrders();
    document.getElementById('wb-queue-count').textContent = orders.length;
    document.getElementById('wb-queue-empty').hidden = orders.length > 0;
    var container = document.getElementById('wb-queue');
    container.innerHTML = orders.map(function (o) {
      var d = new Date(o.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      return '<div class="stack g6" style="padding:14px 18px;border-bottom:1px solid var(--border-soft)" data-order-id="' + o.id + '">' +
        '<div class="spread" style="align-items:baseline"><span style="font-weight:600">' + o.recipeName + '</span><span class="num hint">' + d + '</span></div>' +
        '<span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (o.address || o.plantName) + '</span>' +
        '<div class="spread"><span class="num" style="font-size:13px">осталось <b>' + remainingForOrder(o) + '</b> из ' + o.tripCount + '</span><button type="button" class="btn ghost sm wb-goto-btn" style="height:32px">Распределить</button></div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(container.querySelectorAll('.wb-goto-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.closest('[data-order-id]').dataset.orderId;
        document.getElementById('wb-order').value = id;
        onOrderChange();
      });
    });
  }

  function populateOrderSelect() {
    var select = document.getElementById('wb-order');
    var prev = select.value;
    select.innerHTML = '<option value="">— выберите заказ —</option>' + deliveryOrders().slice()
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
      .map(function (o) {
        var d = new Date(o.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return '<option value="' + o.id + '">' + o.plantName + ' · ' + d + ' · ' + o.recipeName + ' — осталось ' + remainingForOrder(o) + '</option>';
      }).join('');
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) select.value = prev;
  }
  function populateDriverSelect() {
    var select = document.getElementById('wb-driver');
    var prev = select.value;
    select.innerHTML = '<option value="">— выберите —</option>' + (State.data.employees || [])
      .filter(function (e) { return e.isDriver; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .map(function (e) { return '<option value="' + e.id + '">' + e.name + '</option>'; }).join('');
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) select.value = prev;
  }
  function populateMixerSelect() {
    var select = document.getElementById('wb-mixer');
    var prev = select.value;
    select.innerHTML = '<option value="">— выберите —</option>' + (State.data.mixers || []).slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .map(function (m) { return '<option value="' + m.id + '">' + m.name + (m.licensePlate ? ' (' + m.licensePlate + ')' : '') + '</option>'; }).join('');
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) select.value = prev;
  }

  function currentOrder() { return (State.data.orders || []).find(function (o) { return o.id === document.getElementById('wb-order').value; }) || null; }

  function onOrderChange() {
    var order = currentOrder();
    var dateInput = document.getElementById('wb-date');
    if (order && !dateInput.value) dateInput.value = new Date(order.createdAt).toISOString().slice(0, 10);
    renderHint();
  }

  function renderHint() {
    var order = currentOrder();
    var date = document.getElementById('wb-date').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    var cfg = cfgLimits();
    var parts = [];
    if (order) parts.push('По заказу осталось: ' + remainingForOrder(order) + ' из ' + order.tripCount);
    if (driverId && date) parts.push('Водитель занят: ' + Format.fmtNum(driverUsedHours(driverId, date, null), 1) + ' из ' + Format.fmtNum(cfg.driverShiftHours, 1) + ' ч');
    if (mixerId && date) parts.push('Машина занята: ' + Format.fmtNum(mixerUsedHours(mixerId, date, null), 1) + ' из ' + Format.fmtNum(cfg.vehicleShiftHours, 1) + ' ч');
    document.getElementById('wb-hint').textContent = parts.join(' · ');
  }

  function handleMax() {
    var errorEl = document.getElementById('wb-error');
    errorEl.hidden = true;
    var order = currentOrder();
    var date = document.getElementById('wb-date').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    if (!order || !date || !driverId || !mixerId) {
      errorEl.textContent = 'Сначала выберите заказ, дату, водителя и машину.';
      errorEl.hidden = false;
      return;
    }
    var cfg = cfgLimits();
    var perTripHours = tripHours(order.distanceKm, cfg);
    var remaining = remainingForOrder(order);
    var driverLeft = cfg.driverShiftHours - driverUsedHours(driverId, date, null);
    var mixerLeft = cfg.vehicleShiftHours - mixerUsedHours(mixerId, date, null);
    var maxByDriver = perTripHours > 0 ? Math.floor(driverLeft / perTripHours + 1e-9) : remaining;
    var maxByMixer = perTripHours > 0 ? Math.floor(mixerLeft / perTripHours + 1e-9) : remaining;
    var max = Math.max(0, Math.min(remaining, maxByDriver, maxByMixer));
    document.getElementById('wb-trips').value = max || '';
    if (max === 0) {
      var reason = remaining === 0 ? 'по заказу больше не осталось рейсов' : (maxByDriver <= 0 ? 'у водителя не осталось времени в этот день' : 'у машины не осталось времени в этот день');
      errorEl.textContent = 'MAX = 0 — ' + reason + '.';
      errorEl.hidden = false;
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('wb-error');
    errorEl.hidden = true;
    var order = currentOrder();
    var date = document.getElementById('wb-date').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    var trips = parseInt(document.getElementById('wb-trips').value, 10);
    if (!order || !date || !driverId || !mixerId || !(trips > 0)) {
      errorEl.textContent = 'Заполните все поля: заказ, дата, водитель, машина и число рейсов больше нуля.';
      errorEl.hidden = false;
      return;
    }
    var driver = State.data.employees.find(function (e) { return e.id === driverId; });
    var mixer = State.data.mixers.find(function (m) { return m.id === mixerId; });
    try {
      await Api.post('/waybill-entries', {
        orderId: order.id, tripDate: date, driverId: driver.id, driverName: driver.name,
        driverLicenseNumber: driver.licenseNumber || '', mixerId: mixer.id, mixerName: mixer.name,
        mixerPlate: mixer.licensePlate || '', distanceKm: order.distanceKm, tripCount: trips
      });
      document.getElementById('wb-trips').value = '';
      await State.loadAll();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDeleteEntry(entry) {
    if (!confirm('Удалить запись: ' + entry.driverName + ' / ' + entry.mixerName + ' / ' + entry.tripDate + '?')) return;
    try {
      await Api.del('/waybill-entries/' + entry.id);
      delete selectedEntryIds[entry.id];
      await State.loadAll();
      render();
    } catch (err) { alert(err.message); }
  }

  function selectedIds() { return Object.keys(selectedEntryIds).filter(function (id) { return selectedEntryIds[id]; }); }

  function renderEntries() {
    var entries = (State.data.waybillEntries || []).slice().sort(function (a, b) {
      if (a.tripDate !== b.tripDate) return b.tripDate < a.tripDate ? -1 : 1;
      return a.driverName.localeCompare(b.driverName, 'ru');
    });
    var container = document.getElementById('wb-entries');
    document.getElementById('wb-entries-empty').hidden = entries.length > 0;
    var cfg = cfgLimits();
    var stillExisting = {};
    entries.forEach(function (e) { stillExisting[e.id] = true; if (!(e.id in selectedEntryIds)) selectedEntryIds[e.id] = true; });
    Object.keys(selectedEntryIds).forEach(function (id) { if (!stillExisting[id]) delete selectedEntryIds[id]; });

    container.innerHTML = '';
    entries.forEach(function (entry) {
      var order = State.data.orders.find(function (o) { return o.id === entry.orderId; });
      var hours = entry.tripCount * tripHours(entry.distanceKm, cfg);
      var row = document.createElement('div');
      row.className = 'row';
      row.style.gridTemplateColumns = '28px 100px minmax(0,1fr) 140px 70px 70px 32px';
      row.innerHTML =
        '<div><input type="checkbox" class="wb-check"></div>' +
        '<div class="num" style="font-size:13px">' + entry.tripDate + '</div>' +
        '<div class="stack" style="gap:1px"><span style="font-weight:500">' + entry.driverName + ' · ' + entry.mixerName + '</span><span class="hint">' + entry.plantName + (order ? ' · ' + order.recipeName : '') + '</span></div>' +
        '<div class="r num">' + Format.fmtNum(entry.distanceKm, 1) + '</div>' +
        '<div class="r num">' + Format.fmtNum(entry.tripCount, 0) + '</div>' +
        '<div class="r num">' + Format.fmtNum(hours, 1) + '</div>' +
        '<div><button type="button" class="btn ghost icon wb-del-btn" title="Удалить">✕</button></div>';
      var checkbox = row.querySelector('.wb-check');
      checkbox.checked = !!selectedEntryIds[entry.id];
      checkbox.addEventListener('change', function () { selectedEntryIds[entry.id] = checkbox.checked; updateDownloadBtn(); });
      row.querySelector('.wb-del-btn').addEventListener('click', function () { handleDeleteEntry(entry); });
      container.appendChild(row);
    });

    var WAYBILL_4S_MAX_TRIPS = 3;
    var summaryEl = document.getElementById('wb-entries-summary');
    if (entries.length) {
      var tripsByKey = {};
      entries.forEach(function (e) { var k = e.driverId + '|' + e.mixerId + '|' + e.tripDate; tripsByKey[k] = (tripsByKey[k] || 0) + e.tripCount; });
      var docs = Object.keys(tripsByKey).reduce(function (s, k) { return s + Math.ceil(tripsByKey[k] / WAYBILL_4S_MAX_TRIPS); }, 0);
      summaryEl.textContent = 'Всего записей: ' + entries.length + ' → путевых листов при скачивании: ' + docs + '.';
    } else {
      summaryEl.textContent = '';
    }
    var selectAll = document.getElementById('wb-select-all');
    selectAll.checked = entries.length > 0 && entries.every(function (e) { return selectedEntryIds[e.id]; });
    updateDownloadBtn();
  }

  function updateDownloadBtn() { document.getElementById('wb-download-btn').disabled = selectedIds().length === 0; }

  async function handleDownload() {
    var ids = selectedIds();
    if (!ids.length) return;
    try { await Waybill.downloadEntries(ids); } catch (err) { alert(err.message); }
  }

  function render() {
    populateOrderSelect();
    populateDriverSelect();
    populateMixerSelect();
    renderQueue();
    renderEntries();
    renderHint();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-waybills').innerHTML = HTML;
    document.getElementById('wb-add-form').addEventListener('submit', handleSubmit);
    document.getElementById('wb-max-btn').addEventListener('click', handleMax);
    document.getElementById('wb-order').addEventListener('change', onOrderChange);
    ['wb-date', 'wb-driver', 'wb-mixer'].forEach(function (id) { document.getElementById(id).addEventListener('change', renderHint); });
    document.getElementById('wb-select-all').addEventListener('change', function () {
      var checked = this.checked;
      State.data.waybillEntries.forEach(function (e) { selectedEntryIds[e.id] = checked; });
      renderEntries();
    });
    document.getElementById('wb-download-btn').addEventListener('click', handleDownload);
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.WaybillsScreen = { show: show };
})();
