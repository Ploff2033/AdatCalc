(function () {
  // Заказ остаётся единственным источником истины по числу рейсов — здесь
  // мы только разносим их по конкретным (водитель, машина, день). "Осталось"
  // считается на лету как tripCount минус сумма уже внесённых записей, а не
  // хранится отдельным флагом на заказе, чтобы не рассинхронизироваться.
  var selectedEntryIds = {}; // id записи -> true, для чекбоксов скачивания/выбора

  function cfgLimits() {
    var c = State.data.config || {};
    return {
      driverShiftHours: c.driverShiftHours || 0,
      vehicleShiftHours: c.vehicleShiftHours || 0,
      avgSpeedKmh: c.avgSpeedKmh || 0,
      unloadMinutes: c.unloadMinutes || 0
    };
  }

  // Та же формула, что на бэкенде (backend/handlers/waybill-entries.js) —
  // расстояние туда-обратно / средняя скорость + время разгрузки.
  function tripHours(distanceKm, cfg) {
    var roundTrip = (distanceKm || 0) * 2;
    var drivingHours = cfg.avgSpeedKmh > 0 ? roundTrip / cfg.avgSpeedKmh : 0;
    return drivingHours + (cfg.unloadMinutes || 0) / 60;
  }

  function entriesForOrder(orderId) {
    return State.data.waybillEntries.filter(function (e) { return e.orderId === orderId; });
  }

  function allocatedForOrder(orderId) {
    return entriesForOrder(orderId).reduce(function (sum, e) { return sum + e.tripCount; }, 0);
  }

  function remainingForOrder(order) {
    return Math.max(0, (order.tripCount || 0) - allocatedForOrder(order.id));
  }

  function deliveryOrders() {
    return State.data.orders.filter(function (o) { return o.tripCount > 0; });
  }

  function unallocatedOrders() {
    return deliveryOrders()
      .filter(function (o) { return remainingForOrder(o) > 0; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  // Занятость водителя/машины в конкретный день — сумма часов по ВСЕМ его
  // записям в этот день, независимо от заказа/другой стороны пары
  // (см. обсуждение с пользователем — это два независимых бюджета времени).
  function driverUsedHours(driverId, date, excludeId) {
    var cfg = cfgLimits();
    return State.data.waybillEntries
      .filter(function (e) { return e.driverId === driverId && e.tripDate === date && e.id !== excludeId; })
      .reduce(function (sum, e) { return sum + e.tripCount * tripHours(e.distanceKm, cfg); }, 0);
  }

  function mixerUsedHours(mixerId, date, excludeId) {
    var cfg = cfgLimits();
    return State.data.waybillEntries
      .filter(function (e) { return e.mixerId === mixerId && e.tripDate === date && e.id !== excludeId; })
      .reduce(function (sum, e) { return sum + e.tripCount * tripHours(e.distanceKm, cfg); }, 0);
  }

  function formatOrderLabel(order) {
    var d = new Date(order.createdAt);
    var dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return order.plantName + ' · ' + dateStr + ' · ' + order.recipeName + ' (' + Format.fmtNum(order.tripCount, 0, 'рейс(ов)') + ')';
  }

  // ---- "Настройки" (лимиты для расчёта путевых листов) ----
  var driverShiftHoursInput = document.getElementById('driver-shift-hours');
  var driverShiftHoursSaveTimer = null;

  function scheduleDriverShiftHoursSave() {
    clearTimeout(driverShiftHoursSaveTimer);
    driverShiftHoursSaveTimer = setTimeout(saveDriverShiftHours, 500);
  }

  async function saveDriverShiftHours() {
    try {
      await Api.put('/config', { driverShiftHours: parseFloat(driverShiftHoursInput.value) || 0 });
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить дневной лимит водителя: ' + err.message);
    }
  }

  function renderDriverShiftHours() {
    if (document.activeElement === driverShiftHoursInput) return;
    driverShiftHoursInput.value = State.data.config.driverShiftHours || 0;
  }

  var vehicleShiftHoursInput = document.getElementById('vehicle-shift-hours');
  var vehicleShiftHoursSaveTimer = null;

  function scheduleVehicleShiftHoursSave() {
    clearTimeout(vehicleShiftHoursSaveTimer);
    vehicleShiftHoursSaveTimer = setTimeout(saveVehicleShiftHours, 500);
  }

  async function saveVehicleShiftHours() {
    try {
      await Api.put('/config', { vehicleShiftHours: parseFloat(vehicleShiftHoursInput.value) || 0 });
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить дневной лимит машины: ' + err.message);
    }
  }

  function renderVehicleShiftHours() {
    if (document.activeElement === vehicleShiftHoursInput) return;
    vehicleShiftHoursInput.value = State.data.config.vehicleShiftHours || 0;
  }

  var avgSpeedInput = document.getElementById('avg-speed-kmh');
  var avgSpeedSaveTimer = null;

  function scheduleAvgSpeedSave() {
    clearTimeout(avgSpeedSaveTimer);
    avgSpeedSaveTimer = setTimeout(saveAvgSpeed, 500);
  }

  async function saveAvgSpeed() {
    try {
      await Api.put('/config', { avgSpeedKmh: parseFloat(avgSpeedInput.value) || 0 });
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить среднюю скорость: ' + err.message);
    }
  }

  function renderAvgSpeed() {
    if (document.activeElement === avgSpeedInput) return;
    avgSpeedInput.value = State.data.config.avgSpeedKmh || 0;
  }

  var unloadMinutesInput = document.getElementById('unload-minutes');
  var unloadMinutesSaveTimer = null;

  function scheduleUnloadMinutesSave() {
    clearTimeout(unloadMinutesSaveTimer);
    unloadMinutesSaveTimer = setTimeout(saveUnloadMinutes, 500);
  }

  async function saveUnloadMinutes() {
    try {
      await Api.put('/config', { unloadMinutes: parseFloat(unloadMinutesInput.value) || 0 });
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить время разгрузки: ' + err.message);
    }
  }

  function renderUnloadMinutes() {
    if (document.activeElement === unloadMinutesInput) return;
    unloadMinutesInput.value = State.data.config.unloadMinutes || 0;
  }

  // ---- "01 Не распределено" ----

  function renderUnallocatedTable() {
    var tbody = document.getElementById('wb-unallocated-table-body');
    var emptyHint = document.getElementById('wb-unallocated-empty-hint');
    var orders = unallocatedOrders();
    tbody.innerHTML = '';
    emptyHint.hidden = orders.length > 0;
    orders.forEach(function (order) {
      var remaining = remainingForOrder(order);
      var allocated = allocatedForOrder(order.id);
      var tr = document.createElement('tr');
      var d = new Date(order.createdAt);
      var dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
      tr.innerHTML =
        '<td>' + order.recipeName + ' · ' + dateStr + '</td>' +
        '<td>' + order.plantName + '</td>' +
        '<td>' + Format.fmtNum(order.tripCount, 0) + '</td>' +
        '<td>' + Format.fmtNum(allocated, 0) + '</td>' +
        '<td>' + Format.fmtNum(remaining, 0) + '</td>' +
        '<td><button type="button" class="wb-goto-btn">Разнести</button></td>';
      tr.querySelector('.wb-goto-btn').addEventListener('click', function () {
        document.getElementById('wb-add-order').value = order.id;
        onOrderChange();
        document.getElementById('wb-add-date').focus();
      });
      tbody.appendChild(tr);
    });
  }

  // ---- "02 Разнести рейсы" ----

  function populateOrderSelect() {
    var select = document.getElementById('wb-add-order');
    var prev = select.value;
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— выберите заказ —';
    select.appendChild(placeholder);
    // В списке — все заказы с доставкой, а не только нераспределённые: заказ
    // мог быть разнесён частично, и к нему ещё возвращаются доразнести остаток.
    deliveryOrders()
      .slice()
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
      .forEach(function (order) {
        var opt = document.createElement('option');
        opt.value = order.id;
        opt.textContent = formatOrderLabel(order) + ' — осталось ' + remainingForOrder(order);
        select.appendChild(opt);
      });
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) {
      select.value = prev;
    }
  }

  function populateDriverSelect() {
    var select = document.getElementById('wb-add-driver');
    var prev = select.value;
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— выберите —';
    select.appendChild(placeholder);
    State.data.employees
      .filter(function (e) { return e.isDriver; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .forEach(function (emp) {
        var opt = document.createElement('option');
        opt.value = emp.id;
        opt.textContent = emp.name;
        select.appendChild(opt);
      });
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) {
      select.value = prev;
    }
  }

  function populateMixerSelect() {
    var select = document.getElementById('wb-add-mixer');
    var prev = select.value;
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— выберите —';
    select.appendChild(placeholder);
    State.data.mixers
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .forEach(function (mixer) {
        var opt = document.createElement('option');
        opt.value = mixer.id;
        opt.textContent = mixer.name + (mixer.licensePlate ? ' (' + mixer.licensePlate + ')' : '');
        select.appendChild(opt);
      });
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) {
      select.value = prev;
    }
  }

  function currentOrder() {
    var id = document.getElementById('wb-add-order').value;
    return State.data.orders.find(function (o) { return o.id === id; }) || null;
  }

  // При выборе заказа подставляем его дату как отправную точку — обычно
  // рейсы едут в тот же день, но это просто предзаполнение, не ограничение.
  function onOrderChange() {
    var order = currentOrder();
    var dateInput = document.getElementById('wb-add-date');
    if (order && !dateInput.value) {
      dateInput.value = new Date(order.createdAt).toISOString().slice(0, 10);
    }
    renderAddHint();
  }

  function renderAddHint() {
    var hintEl = document.getElementById('wb-add-hint');
    var order = currentOrder();
    var date = document.getElementById('wb-add-date').value;
    var driverId = document.getElementById('wb-add-driver').value;
    var mixerId = document.getElementById('wb-add-mixer').value;
    var cfg = cfgLimits();

    var parts = [];
    if (order) {
      parts.push('По заказу осталось: ' + Format.fmtNum(remainingForOrder(order), 0) + ' из ' + Format.fmtNum(order.tripCount, 0));
    }
    if (driverId && date) {
      var dUsed = driverUsedHours(driverId, date, null);
      parts.push('Водитель занят в этот день: ' + Format.fmtNum(dUsed, 1) + ' из ' + Format.fmtNum(cfg.driverShiftHours, 1) + ' ч');
    }
    if (mixerId && date) {
      var mUsed = mixerUsedHours(mixerId, date, null);
      parts.push('Машина занята в этот день: ' + Format.fmtNum(mUsed, 1) + ' из ' + Format.fmtNum(cfg.vehicleShiftHours, 1) + ' ч');
    }
    hintEl.textContent = parts.join(' · ');
  }

  function handleMaxClick() {
    var errorEl = document.getElementById('wb-add-error');
    errorEl.hidden = true;
    var order = currentOrder();
    var date = document.getElementById('wb-add-date').value;
    var driverId = document.getElementById('wb-add-driver').value;
    var mixerId = document.getElementById('wb-add-mixer').value;
    if (!order || !date || !driverId || !mixerId) {
      errorEl.textContent = 'Сначала выберите заказ, дату, водителя и машину — MAX считает лимит именно для этой комбинации.';
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
    document.getElementById('wb-add-trips').value = max || '';
    if (max === 0) {
      var reason = remaining === 0 ? 'по заказу больше не осталось рейсов'
        : (maxByDriver <= 0 ? 'у водителя не осталось времени в этот день' : 'у машины не осталось времени в этот день');
      errorEl.textContent = 'MAX = 0 — ' + reason + '.';
      errorEl.hidden = false;
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('wb-add-error');
    errorEl.hidden = true;
    var order = currentOrder();
    var date = document.getElementById('wb-add-date').value;
    var driverId = document.getElementById('wb-add-driver').value;
    var mixerId = document.getElementById('wb-add-mixer').value;
    var trips = parseInt(document.getElementById('wb-add-trips').value, 10);
    if (!order || !date || !driverId || !mixerId || !(trips > 0)) {
      errorEl.textContent = 'Заполните все поля: заказ, дата, водитель, машина и число рейсов больше нуля.';
      errorEl.hidden = false;
      return;
    }
    var driver = State.data.employees.find(function (e) { return e.id === driverId; });
    var mixer = State.data.mixers.find(function (m) { return m.id === mixerId; });
    var payload = {
      orderId: order.id,
      tripDate: date,
      driverId: driver.id,
      driverName: driver.name,
      driverLicenseNumber: driver.licenseNumber || '',
      mixerId: mixer.id,
      mixerName: mixer.name,
      mixerPlate: mixer.licensePlate || '',
      distanceKm: order.distanceKm,
      tripCount: trips
    };
    try {
      await Api.post('/waybill-entries', payload);
      document.getElementById('wb-add-trips').value = '';
      await State.loadAll();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  // ---- "03 Записи путевых листов" ----

  // Столько же документов реально сформируется при скачивании (форма №4-С,
  // см. buildWaybill4sDocuments в backend/router.js): строки с одинаковым
  // водителем+машиной+днём схлопываются в один документ, НО в бланке 4-С
  // под журнал поездок на обороте есть место только на 3 ездки — если у
  // связки водитель+машина+день поездок больше, документ режется на
  // несколько (10 поездок = 4 документа: 3+3+3+1, не 1).
  var WAYBILL_4S_MAX_TRIPS = 3;
  function countWaybillDocs(entries) {
    var tripsByKey = {};
    entries.forEach(function (e) {
      var key = e.driverId + '|' + e.mixerId + '|' + e.tripDate;
      tripsByKey[key] = (tripsByKey[key] || 0) + e.tripCount;
    });
    return Object.keys(tripsByKey).reduce(function (sum, key) {
      return sum + Math.ceil(tripsByKey[key] / WAYBILL_4S_MAX_TRIPS);
    }, 0);
  }

  async function handleDeleteEntry(entry) {
    if (!confirm('Удалить запись: ' + entry.driverName + ' / ' + entry.mixerName + ' / ' + entry.tripDate + '?')) return;
    try {
      await Api.del('/waybill-entries/' + entry.id);
      delete selectedEntryIds[entry.id];
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function selectedIds() {
    return Object.keys(selectedEntryIds).filter(function (id) { return selectedEntryIds[id]; });
  }

  async function handleDownload() {
    var ids = selectedIds();
    if (!ids.length) return;
    try {
      await Waybill.downloadEntries(ids);
    } catch (err) {
      alert(err.message);
    }
  }

  function renderEntriesTable() {
    var tbody = document.getElementById('wb-entries-table-body');
    var emptyHint = document.getElementById('wb-entries-empty-hint');
    var entries = State.data.waybillEntries.slice().sort(function (a, b) {
      if (a.tripDate !== b.tripDate) return b.tripDate < a.tripDate ? -1 : 1;
      return a.driverName.localeCompare(b.driverName, 'ru');
    });
    tbody.innerHTML = '';
    emptyHint.hidden = entries.length > 0;
    var cfg = cfgLimits();

    // Чекбоксы переживают перерисовку (после State.loadAll) только для тех
    // id, что ещё существуют — иначе накапливался бы мусор от удалённых записей.
    // Новая запись (её ещё нет в selectedEntryIds) по умолчанию отмечена —
    // обычно нужно скачать всё, а не искать галочку для только что добавленной строки.
    var stillExisting = {};
    entries.forEach(function (e) {
      stillExisting[e.id] = true;
      if (!(e.id in selectedEntryIds)) selectedEntryIds[e.id] = true;
    });
    Object.keys(selectedEntryIds).forEach(function (id) { if (!stillExisting[id]) delete selectedEntryIds[id]; });

    entries.forEach(function (entry) {
      var order = State.data.orders.find(function (o) { return o.id === entry.orderId; });
      var hours = entry.tripCount * tripHours(entry.distanceKm, cfg);
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="checkbox" class="wb-row-check"></td>' +
        '<td>' + entry.tripDate + '</td>' +
        '<td>' + entry.plantName + (order ? ' · ' + order.recipeName : '') + '</td>' +
        '<td>' + entry.driverName + '</td>' +
        '<td>' + entry.mixerName + (entry.mixerPlate ? ' (' + entry.mixerPlate + ')' : '') + '</td>' +
        '<td>' + Format.fmtNum(entry.distanceKm, 1, 'км') + '</td>' +
        '<td>' + Format.fmtNum(entry.tripCount, 0) + '</td>' +
        '<td>' + Format.fmtNum(hours, 1, 'ч') + '</td>' +
        '<td><button type="button" class="wb-row-del-btn">✕</button></td>';
      var checkbox = tr.querySelector('.wb-row-check');
      checkbox.checked = !!selectedEntryIds[entry.id];
      checkbox.addEventListener('change', function () {
        selectedEntryIds[entry.id] = checkbox.checked;
        updateDownloadButton();
      });
      tr.querySelector('.wb-row-del-btn').addEventListener('click', function () { handleDeleteEntry(entry); });
      tbody.appendChild(tr);
    });

    var summaryEl = document.getElementById('wb-entries-summary');
    if (entries.length) {
      summaryEl.textContent = 'Всего записей: ' + entries.length + ' → путевых листов при скачивании: ' + countWaybillDocs(entries) + '.';
    } else {
      summaryEl.textContent = '';
    }

    var selectAll = document.getElementById('wb-select-all');
    selectAll.checked = entries.length > 0 && entries.every(function (e) { return selectedEntryIds[e.id]; });
    updateDownloadButton();
  }

  function updateDownloadButton() {
    document.getElementById('wb-download-btn').disabled = selectedIds().length === 0;
  }

  function handleSelectAll() {
    var checked = document.getElementById('wb-select-all').checked;
    State.data.waybillEntries.forEach(function (e) { selectedEntryIds[e.id] = checked; });
    renderEntriesTable();
  }

  function init() {
    driverShiftHoursInput.addEventListener('input', scheduleDriverShiftHoursSave);
    vehicleShiftHoursInput.addEventListener('input', scheduleVehicleShiftHoursSave);
    avgSpeedInput.addEventListener('input', scheduleAvgSpeedSave);
    unloadMinutesInput.addEventListener('input', scheduleUnloadMinutesSave);
    document.getElementById('wb-add-form').addEventListener('submit', handleAddSubmit);
    document.getElementById('wb-add-max-btn').addEventListener('click', handleMaxClick);
    document.getElementById('wb-add-order').addEventListener('change', onOrderChange);
    ['wb-add-date', 'wb-add-driver', 'wb-add-mixer'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', renderAddHint);
    });
    document.getElementById('wb-select-all').addEventListener('change', handleSelectAll);
    document.getElementById('wb-download-btn').addEventListener('click', handleDownload);
  }

  function render() {
    renderDriverShiftHours();
    renderVehicleShiftHours();
    renderAvgSpeed();
    renderUnloadMinutes();
    populateOrderSelect();
    populateDriverSelect();
    populateMixerSelect();
    renderUnallocatedTable();
    renderEntriesTable();
    renderAddHint();
  }

  window.WaybillsTab = { init: init, render: render };
})();
