(function () {
  // Мобильный экран «Путевые листы» (макет MobileWaybills.dc.html) —
  // однодневный, "полевой" сценарий: выбрать день → заказ → водителя →
  // миксер → рейсы, с теми же тремя проверками, что и на десктопе
  // (см. waybill-calc.js — общая с screen-waybills.js логика, поэтому лимиты
  // не могут разойтись между версиями).
  var selectedDate = new Date().toISOString().slice(0, 10);
  var selectedOrderId = '';
  var selectedDriverId = '';
  var selectedMixerId = '';
  var tripsValue = 1;

  var HTML =
    '<div class="mobile-page">' +
      '<div class="seg" role="group" aria-label="День" id="mw-day-seg"></div>' +
      '<section class="card stack g6" style="padding:14px 16px">' +
        '<div class="spread"><span class="sub">Заказ</span></div>' +
        '<select id="mw-order" class="inp" style="height:44px"></select>' +
        '<div id="mw-order-meta" class="hint"></div>' +
        '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><span id="mw-order-bar" style="background:var(--ink)"></span></div><span class="num" id="mw-order-bar-label" style="font-size:12px"></span></div>' +
      '</section>' +
      '<section class="card stack g8" style="padding:14px 16px">' +
        '<span class="sub">Водитель</span>' +
        '<div id="mw-drivers" class="stack g8"></div>' +
      '</section>' +
      '<section class="card stack g8" style="padding:14px 16px">' +
        '<span class="sub">Миксер</span>' +
        '<div id="mw-mixers" class="stack g8"></div>' +
      '</section>' +
      '<section class="card stack g12" style="padding:14px 16px">' +
        '<div class="spread">' +
          '<span class="sub">Рейсов</span>' +
          '<div style="display:grid;grid-template-columns:44px 56px 44px;gap:6px">' +
            '<button type="button" class="btn ghost" id="mw-trips-minus" style="height:44px;padding:0;font-size:18px">−</button>' +
            '<input id="mw-trips" class="inp num" style="height:44px;text-align:center;font-size:17px;padding:0">' +
            '<button type="button" class="btn ghost" id="mw-trips-plus" style="height:44px;padding:0;font-size:18px">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="stack g6" id="mw-validation" style="font-size:13px"></div>' +
        '<p class="hint" id="mw-warning" style="margin:0;color:#8C2217"></p>' +
        '<button class="btn pri" id="mw-save-btn" style="height:52px" disabled>Сохранить запись</button>' +
      '</section>' +
      '<section class="card stack g8" style="padding:14px 16px">' +
        '<div class="spread"><span class="sub" id="mw-done-label">Распределено</span><span class="num hint" id="mw-done-count"></span></div>' +
        '<div id="mw-done-list" class="stack"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:4px">' +
          '<button type="button" class="btn ghost sm" id="mw-dl-4p" style="height:44px">Бланки 4-П</button>' +
          '<button type="button" class="btn ghost sm" id="mw-dl-4s" style="height:44px">Бланки 4-С</button>' +
        '</div>' +
      '</section>' +
    '</div>';

  function dateLabel(d) { return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }); }

  function renderDaySeg() {
    var base = new Date(selectedDate + 'T00:00:00');
    var days = [-1, 0, 1].map(function (offset) { var d = new Date(base); d.setDate(d.getDate() + offset); return d; });
    var seg = document.getElementById('mw-day-seg');
    seg.innerHTML = days.map(function (d) {
      var iso = d.toISOString().slice(0, 10);
      return '<button type="button" data-date="' + iso + '" class="' + (iso === selectedDate ? 'on' : '') + '" style="height:44px">' + dateLabel(d) + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('[data-date]'), function (btn) {
      btn.addEventListener('click', function () { selectedDate = btn.dataset.date; render(); });
    });
  }

  function currentOrder() { return (State.data.orders || []).find(function (o) { return o.id === selectedOrderId; }) || null; }

  function renderOrderPicker() {
    var select = document.getElementById('mw-order');
    var plantId = Plant.currentPlantId();
    var orders = WaybillCalc.deliveryOrders(State.data.orders || []).filter(function (o) { return !plantId || o.plantId === plantId; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var prev = selectedOrderId;
    select.innerHTML = '<option value="">— выберите заказ —</option>' + orders.map(function (o) {
      var d = new Date(o.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      var remaining = WaybillCalc.remainingForOrder(State.data.waybillEntries || [], o);
      return '<option value="' + o.id + '">' + o.recipeName + ' · ' + Format.fmtNum(o.saleVolume, 1, 'м³') + ' · ' + d + ' — осталось ' + remaining + '</option>';
    }).join('');
    if (orders.some(function (o) { return o.id === prev; })) select.value = prev;
    else if (!selectedOrderId && orders.length) select.value = orders[0].id;
    selectedOrderId = select.value;
  }

  function renderOrderMeta() {
    var order = currentOrder();
    var meta = document.getElementById('mw-order-meta');
    var barLabel = document.getElementById('mw-order-bar-label');
    var bar = document.getElementById('mw-order-bar');
    if (!order) { meta.textContent = ''; barLabel.textContent = ''; bar.style.width = '0%'; return; }
    var cfg = WaybillCalc.cfgLimits(State.data.config);
    var hours = WaybillCalc.tripHours(order.distanceKm, cfg);
    meta.textContent = Format.fmtNum(order.distanceKm, 0, 'км') + (order.neighborCity ? ' · соседний город' : '') + ' · рейс ≈ ' + Format.fmtNum(hours, 1, 'ч');
    var allocated = WaybillCalc.allocatedForOrder(State.data.waybillEntries || [], order.id);
    var remaining = WaybillCalc.remainingForOrder(State.data.waybillEntries || [], order);
    var pct = order.tripCount > 0 ? Math.round((allocated / order.tripCount) * 100) : 0;
    bar.style.width = pct + '%';
    barLabel.innerHTML = '<b>' + remaining + '</b> из ' + order.tripCount + ' рейсов не распределены';
  }

  function renderPickList(containerId, items, selectedId, onPick, extraFn) {
    var container = document.getElementById(containerId);
    container.innerHTML = items.map(function (it) {
      var cls = it.id === selectedId ? 'on' : (it.disabled ? 'off' : '');
      return '<label class="pick ' + cls + '" data-id="' + it.id + '">' +
        '<input type="radio" style="width:18px;height:18px" ' + (it.id === selectedId ? 'checked' : '') + (it.disabled ? ' disabled' : '') + '>' +
        '<span class="stack g4" style="min-width:0"><span style="font-weight:500">' + it.name + '</span><span class="bar" style="width:100%"><span style="width:' + it.pct + '%;background:' + it.barColor + '"></span></span></span>' +
        '<span class="num" style="font-size:12px;text-align:right;color:' + it.textColor + '">' + it.label + '</span>' +
      '</label>';
    }).join('');
    Array.prototype.forEach.call(container.querySelectorAll('.pick'), function (el) {
      var id = el.dataset.id;
      var item = items.find(function (i) { return i.id === id; });
      if (item.disabled) return;
      el.addEventListener('click', function () { onPick(id); render(); });
    });
  }

  function renderDriversAndMixers() {
    var order = currentOrder();
    var cfg = WaybillCalc.cfgLimits(State.data.config);
    var perTripHours = order ? WaybillCalc.tripHours(order.distanceKm, cfg) : 0;

    var drivers = (State.data.employees || []).filter(function (e) { return e.isDriver; }).map(function (e) {
      var used = WaybillCalc.driverUsedHours(State.data.waybillEntries || [], State.data.config, e.id, selectedDate, null);
      var canFit = cfg.driverShiftHours <= 0 || !order || (used + perTripHours) <= cfg.driverShiftHours + 1e-9;
      var pct = cfg.driverShiftHours > 0 ? Math.min(100, Math.round((used / cfg.driverShiftHours) * 100)) : 0;
      return {
        id: e.id, name: e.name, disabled: !canFit && e.id !== selectedDriverId,
        pct: pct, barColor: pct >= 90 ? '#8A5A00' : '#1C1D1B', textColor: pct >= 90 ? '#6E4700' : '#1C1D1B',
        label: Format.fmtNum(used, 1) + ' / ' + Format.fmtNum(cfg.driverShiftHours, 0) + ' ч' + (canFit ? '' : ' · не успеет рейс')
      };
    });
    if (selectedDriverId && !drivers.some(function (d) { return d.id === selectedDriverId; })) selectedDriverId = '';
    renderPickList('mw-drivers', drivers, selectedDriverId, function (id) { selectedDriverId = id; });

    var mixers = (State.data.mixers || []).map(function (m) {
      var used = WaybillCalc.mixerUsedHours(State.data.waybillEntries || [], State.data.config, m.id, selectedDate, null);
      var canFit = cfg.vehicleShiftHours <= 0 || !order || (used + perTripHours) <= cfg.vehicleShiftHours + 1e-9;
      var pct = cfg.vehicleShiftHours > 0 ? Math.min(100, Math.round((used / cfg.vehicleShiftHours) * 100)) : 0;
      return {
        id: m.id, name: m.name + (m.licensePlate ? ' (' + m.licensePlate + ')' : ''), disabled: !canFit && m.id !== selectedMixerId,
        pct: pct, barColor: pct >= 90 ? '#8A5A00' : '#1C1D1B', textColor: pct >= 90 ? '#6E4700' : '#1C1D1B',
        label: Format.fmtNum(used, 1) + ' / ' + Format.fmtNum(cfg.vehicleShiftHours, 0) + ' ч' + (canFit ? '' : ' · не успеет рейс')
      };
    });
    if (selectedMixerId && !mixers.some(function (m) { return m.id === selectedMixerId; })) selectedMixerId = '';
    renderPickList('mw-mixers', mixers, selectedMixerId, function (id) { selectedMixerId = id; });
  }

  function renderTripsAndValidation() {
    var order = currentOrder();
    var saveBtn = document.getElementById('mw-save-btn');
    var validationEl = document.getElementById('mw-validation');
    var warningEl = document.getElementById('mw-warning');
    document.getElementById('mw-trips').value = tripsValue;

    if (!order || !selectedDriverId || !selectedMixerId) {
      validationEl.innerHTML = '';
      warningEl.textContent = '';
      saveBtn.disabled = true;
      return;
    }
    var r = WaybillCalc.maxTrips(order, State.data.waybillEntries || [], State.data.config, selectedDriverId, selectedMixerId, selectedDate);
    var cfg = WaybillCalc.cfgLimits(State.data.config);
    var driverUsed = WaybillCalc.driverUsedHours(State.data.waybillEntries || [], State.data.config, selectedDriverId, selectedDate, null);
    var mixerUsed = WaybillCalc.mixerUsedHours(State.data.waybillEntries || [], State.data.config, selectedMixerId, selectedDate, null);
    var perTripHours = WaybillCalc.tripHours(order.distanceKm, cfg);

    function line(label, ok, valueText) {
      return '<div class="spread" style="padding:8px 10px;border-radius:4px;background:' + (ok ? '#DCEBE2' : '#F6DCD8') + ';color:' + (ok ? '#1F5239' : '#8C2217') + '"><span>' + label + '</span><span class="num">' + valueText + '</span></div>';
    }
    var okOrder = tripsValue <= r.remaining;
    var okDriver = (driverUsed + tripsValue * perTripHours) <= cfg.driverShiftHours + 1e-9;
    var okMixer = (mixerUsed + tripsValue * perTripHours) <= cfg.vehicleShiftHours + 1e-9;
    validationEl.innerHTML =
      line('Рейсы заказа', okOrder, tripsValue + ' из ' + r.remaining) +
      line('Водитель за день', okDriver, Format.fmtNum(driverUsed + tripsValue * perTripHours, 1) + ' из ' + Format.fmtNum(cfg.driverShiftHours, 0) + ' ч') +
      line('Машина за день', okMixer, Format.fmtNum(mixerUsed + tripsValue * perTripHours, 1) + ' из ' + Format.fmtNum(cfg.vehicleShiftHours, 0) + ' ч');

    var valid = tripsValue > 0 && okOrder && okDriver && okMixer;
    if (!valid) {
      warningEl.textContent = !okOrder ? 'Превышен остаток рейсов заказа.' : (!okDriver ? 'Водитель не успеет — уменьшите число рейсов.' : (!okMixer ? 'Машина не успеет — уменьшите число рейсов.' : ''));
    } else {
      warningEl.textContent = '';
    }
    saveBtn.disabled = !valid;
  }

  function renderDoneList() {
    var plantId = Plant.currentPlantId();
    var entries = (State.data.waybillEntries || []).filter(function (e) { return e.tripDate === selectedDate && (!plantId || e.plantId === plantId); });
    var label = document.getElementById('mw-done-label');
    var d = new Date(selectedDate + 'T00:00:00');
    label.textContent = 'Распределено на ' + dateLabel(d);
    document.getElementById('mw-done-count').textContent = entries.length + ' запис(ей)';
    var cfg = WaybillCalc.cfgLimits(State.data.config);
    document.getElementById('mw-done-list').innerHTML = entries.map(function (e) {
      var order = State.data.orders.find(function (o) { return o.id === e.orderId; });
      var hours = e.tripCount * WaybillCalc.tripHours(e.distanceKm, cfg);
      return '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:8px 0;border-top:1px solid var(--border-soft)">' +
        '<span style="font-weight:500;font-size:13px">' + e.driverName + ' · ' + e.mixerName + '</span><span class="num" style="font-size:13px">' + e.tripCount + ' рейс(ов)</span>' +
        '<span class="hint">' + (order ? order.recipeName + ' · ' + Format.fmtNum(order.saleVolume, 1, 'м³') : e.plantName) + '</span><span class="num hint">' + Format.fmtNum(hours, 1, 'ч') + '</span>' +
      '</div>';
    }).join('');
  }

  function render() {
    renderDaySeg();
    renderOrderPicker();
    renderOrderMeta();
    renderDriversAndMixers();
    renderTripsAndValidation();
    renderDoneList();
  }

  async function handleSave() {
    var order = currentOrder();
    var driver = State.data.employees.find(function (e) { return e.id === selectedDriverId; });
    var mixer = State.data.mixers.find(function (m) { return m.id === selectedMixerId; });
    if (!order || !driver || !mixer) return;
    var saveBtn = document.getElementById('mw-save-btn');
    saveBtn.disabled = true;
    try {
      await Api.post('/waybill-entries', {
        orderId: order.id, tripDate: selectedDate, driverId: driver.id, driverName: driver.name,
        driverLicenseNumber: driver.licenseNumber || '', mixerId: mixer.id, mixerName: mixer.name,
        mixerPlate: mixer.licensePlate || '', distanceKm: order.distanceKm, tripCount: tripsValue
      });
      tripsValue = 1;
      await State.loadAll();
      render();
    } catch (err) {
      alert(err.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function handleDownload4p() {
    var order = currentOrder();
    if (!order) return;
    try { await Waybill.download([order]); } catch (err) { alert(err.message); }
  }
  async function handleDownload4s() {
    var plantId = Plant.currentPlantId();
    var ids = (State.data.waybillEntries || []).filter(function (e) { return e.tripDate === selectedDate && (!plantId || e.plantId === plantId); }).map(function (e) { return e.id; });
    if (!ids.length) return;
    try { await Waybill.downloadEntries(ids); } catch (err) { alert(err.message); }
  }

  function init() {
    document.getElementById('page-waybills').innerHTML = HTML;
    document.getElementById('mw-order').addEventListener('change', function () { selectedOrderId = this.value; tripsValue = 1; render(); });
    document.getElementById('mw-trips').addEventListener('input', function () { tripsValue = parseInt(this.value, 10) || 0; renderTripsAndValidation(); });
    document.getElementById('mw-trips-minus').addEventListener('click', function () { tripsValue = Math.max(0, tripsValue - 1); renderTripsAndValidation(); });
    document.getElementById('mw-trips-plus').addEventListener('click', function () { tripsValue = tripsValue + 1; renderTripsAndValidation(); });
    document.getElementById('mw-save-btn').addEventListener('click', handleSave);
    document.getElementById('mw-dl-4p').addEventListener('click', handleDownload4p);
    document.getElementById('mw-dl-4s').addEventListener('click', handleDownload4s);
  }

  window.MobileWaybillsScreen = { init: init, render: render };
})();
