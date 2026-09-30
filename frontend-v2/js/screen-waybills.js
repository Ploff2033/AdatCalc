(function () {
  // Порт логики из frontend/js/tab-waybills.js (лимиты часов/рейсов — та же
  // формула, что и на бэкенде, см. backend/handlers/waybill-entries.js) под
  // макет Waybills.dc.html: очередь нераспределённых слева, форма
  // распределения с тремя проверками + список по водителям справа.
  //
  // Поступления инертных (см. документ "AdatBeton Calc v2 — архитектура
  // модулей", обновление 30.09.2026) добавлены в ТОТ ЖЕ экран, не отдельным
  // рядом — документ прямо требует "никакой отдельной ветки кода на
  // распределение". Источник ("wb-source") — один select и на заказы, и на
  // поступления сразу (значение вида "order:<id>"/"receipt:<id>"), техника
  // ("wb-mixer") переключается между миксерами и инертовозами в зависимости
  // от выбранного источника — см. currentSource()/populateVehicleSelect().
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
            '<div class="field"><label for="wb-source">Заказ / поступление</label><select id="wb-source" class="inp"></select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1.3fr 1.3fr 0.7fr auto;gap:12px;align-items:end">' +
              '<div class="field"><label for="wb-date">Дата</label><input id="wb-date" type="date" class="inp"></div>' +
              '<div class="field"><label for="wb-driver">Водитель</label><select id="wb-driver" class="inp"></select></div>' +
              '<div class="field"><label for="wb-mixer" id="wb-mixer-label">Миксер</label><select id="wb-mixer" class="inp"></select></div>' +
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

  function entries() { return State.data.waybillEntries || []; }
  function cfgLimits() { return WaybillCalc.cfgLimits(State.data.config); }
  function tripHours(distanceKm, cfg) { return WaybillCalc.tripHours(distanceKm, cfg); }
  function driverUsedHours(driverId, date, excludeId) { return WaybillCalc.driverUsedHours(entries(), State.data.config, driverId, date, excludeId); }
  function mixerUsedHours(mixerId, date, excludeId) { return WaybillCalc.mixerUsedHours(entries(), State.data.config, mixerId, date, excludeId); }

  // Единая очередь (заказы + поступления, см. WaybillCalc.queueItems) —
  // каждый пункт помечен kind, форма читает remaining/distanceKm/label
  // одинаково для обоих источников.
  function queue() { return WaybillCalc.queueItems(State.data.orders || [], State.data.materialReceipts || [], entries()); }

  function renderQueue() {
    var items = queue();
    document.getElementById('wb-queue-count').textContent = items.length;
    document.getElementById('wb-queue-empty').hidden = items.length > 0;
    var container = document.getElementById('wb-queue');
    container.innerHTML = items.map(function (it) {
      var d = new Date(it.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      return '<div class="stack g6" style="padding:14px 18px;border-bottom:1px solid var(--border-soft)" data-kind="' + it.kind + '" data-item-id="' + it.id + '">' +
        '<div class="spread" style="align-items:baseline"><span style="font-weight:600">' + it.label + '</span><span class="num hint">' + d + '</span></div>' +
        '<span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + it.sub + (it.kind === 'receipt' ? ' · поступление' : '') + '</span>' +
        '<div class="spread"><span class="num" style="font-size:13px">осталось <b>' + it.remaining + '</b> из ' + it.tripCount + '</span><button type="button" class="btn ghost sm wb-goto-btn" style="height:32px">Распределить</button></div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(container.querySelectorAll('.wb-goto-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var wrap = btn.closest('[data-item-id]');
        document.getElementById('wb-source').value = wrap.dataset.kind + ':' + wrap.dataset.itemId;
        onSourceChange();
      });
    });
  }

  function populateSourceSelect() {
    var select = document.getElementById('wb-source');
    var prev = select.value;
    var items = queue();
    select.innerHTML = '<option value="">— выберите —</option>' +
      (items.length ? '<optgroup label="Заказы на бетон">' : '') +
      items.filter(function (it) { return it.kind === 'order'; }).map(function (it) {
        var d = new Date(it.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return '<option value="order:' + it.id + '">' + it.sub + ' · ' + d + ' · ' + it.label + ' — осталось ' + it.remaining + '</option>';
      }).join('') +
      (items.length ? '</optgroup><optgroup label="Поступления инертных">' : '') +
      items.filter(function (it) { return it.kind === 'receipt'; }).map(function (it) {
        var d = new Date(it.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return '<option value="receipt:' + it.id + '">' + it.sub.replace(' · приход', '') + ' · ' + d + ' · ' + it.label + ' — осталось ' + it.remaining + '</option>';
      }).join('') +
      (items.length ? '</optgroup>' : '');
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
  // Техника переключается между миксерами (заказы на бетон) и инертовозами
  // (поступления инертных) в зависимости от того, что выбрано в источнике —
  // концентробетон возит миксер, инертное сырьё возит инертовоз, это не
  // взаимозаменяемая техника.
  function populateVehicleSelect() {
    var src = currentSource();
    var isReceipt = src && src.kind === 'receipt';
    document.getElementById('wb-mixer-label').textContent = isReceipt ? 'Инертовоз' : 'Миксер';
    var list = (isReceipt ? State.data.aggregateTrucks : State.data.mixers) || [];
    var select = document.getElementById('wb-mixer');
    var prev = select.value;
    select.innerHTML = '<option value="">— выберите —</option>' + list.slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .map(function (m) { return '<option value="' + m.id + '">' + m.name + (m.licensePlate ? ' (' + m.licensePlate + ')' : '') + '</option>'; }).join('');
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) select.value = prev;
  }

  // Разбирает "order:<id>"/"receipt:<id>" из select в единый объект —
  // remaining/distanceKm/tripCount читаются одинаково дальше по коду,
  // независимо от того, заказ это или поступление.
  function currentSource() {
    var val = document.getElementById('wb-source').value;
    if (!val) return null;
    var i = val.indexOf(':');
    var kind = val.slice(0, i), id = val.slice(i + 1);
    if (kind === 'order') {
      var order = (State.data.orders || []).find(function (o) { return o.id === id; });
      if (!order) return null;
      return { kind: 'order', id: id, raw: order, distanceKm: order.distanceKm, tripCount: order.tripCount, remaining: WaybillCalc.remainingForOrder(entries(), order), createdAt: order.createdAt };
    }
    var receipt = (State.data.materialReceipts || []).find(function (r) { return r.id === id; });
    if (!receipt) return null;
    return { kind: 'receipt', id: id, raw: receipt, distanceKm: receipt.distanceKm, tripCount: receipt.tripCount, remaining: WaybillCalc.remainingForReceipt(entries(), receipt), createdAt: receipt.createdAt };
  }

  function onSourceChange() {
    var src = currentSource();
    var dateInput = document.getElementById('wb-date');
    if (src && !dateInput.value) dateInput.value = new Date(src.createdAt).toISOString().slice(0, 10);
    populateVehicleSelect();
    renderHint();
  }

  function renderHint() {
    var src = currentSource();
    var date = document.getElementById('wb-date').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    var cfg = cfgLimits();
    var parts = [];
    if (src) parts.push((src.kind === 'receipt' ? 'По поступлению' : 'По заказу') + ' осталось: ' + src.remaining + ' из ' + src.tripCount);
    if (driverId && date) parts.push('Водитель занят: ' + Format.fmtNum(driverUsedHours(driverId, date, null), 1) + ' из ' + Format.fmtNum(cfg.driverShiftHours, 1) + ' ч');
    if (mixerId && date) parts.push((src && src.kind === 'receipt' ? 'Инертовоз' : 'Машина') + ' занят(а): ' + Format.fmtNum(mixerUsedHours(mixerId, date, null), 1) + ' из ' + Format.fmtNum(cfg.vehicleShiftHours, 1) + ' ч');
    document.getElementById('wb-hint').textContent = parts.join(' · ');
  }

  function handleMax() {
    var errorEl = document.getElementById('wb-error');
    errorEl.hidden = true;
    var src = currentSource();
    var date = document.getElementById('wb-date').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    if (!src || !date || !driverId || !mixerId) {
      errorEl.textContent = 'Сначала выберите заказ/поступление, дату, водителя и машину.';
      errorEl.hidden = false;
      return;
    }
    var r = src.kind === 'receipt'
      ? WaybillCalc.maxTripsForReceipt(src.raw, entries(), State.data.config, driverId, mixerId, date)
      : WaybillCalc.maxTrips(src.raw, entries(), State.data.config, driverId, mixerId, date);
    document.getElementById('wb-trips').value = r.max || '';
    if (r.max === 0) {
      var reason = r.remaining === 0 ? 'у источника больше не осталось рейсов' : (r.maxByDriver <= 0 ? 'у водителя не осталось времени в этот день' : 'у машины не осталось времени в этот день');
      errorEl.textContent = 'MAX = 0 — ' + reason + '.';
      errorEl.hidden = false;
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('wb-error');
    errorEl.hidden = true;
    var src = currentSource();
    var date = document.getElementById('wb-date').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    var trips = parseInt(document.getElementById('wb-trips').value, 10);
    if (!src || !date || !driverId || !mixerId || !(trips > 0)) {
      errorEl.textContent = 'Заполните все поля: заказ/поступление, дата, водитель, машина и число рейсов больше нуля.';
      errorEl.hidden = false;
      return;
    }
    var driver = State.data.employees.find(function (e) { return e.id === driverId; });
    var vehicleList = src.kind === 'receipt' ? State.data.aggregateTrucks : State.data.mixers;
    var mixer = vehicleList.find(function (m) { return m.id === mixerId; });
    var body = {
      tripDate: date, driverId: driver.id, driverName: driver.name,
      driverLicenseNumber: driver.licenseNumber || '', mixerId: mixer.id, mixerName: mixer.name,
      mixerPlate: mixer.licensePlate || '', distanceKm: src.distanceKm, tripCount: trips
    };
    if (src.kind === 'receipt') body.receiptId = src.id; else body.orderId = src.id;
    try {
      await Api.post('/waybill-entries', body);
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
      var sourceLabel = '';
      if (entry.orderId) {
        var order = State.data.orders.find(function (o) { return o.id === entry.orderId; });
        if (order) sourceLabel = ' · ' + order.recipeName;
      } else if (entry.receiptId) {
        var receipt = (State.data.materialReceipts || []).find(function (r) { return r.id === entry.receiptId; });
        if (receipt) sourceLabel = ' · ' + receipt.materialName + ' (приход)';
      }
      var hours = entry.tripCount * tripHours(entry.distanceKm, cfg);
      var row = document.createElement('div');
      row.className = 'row';
      row.style.gridTemplateColumns = '28px 100px minmax(0,1fr) 140px 70px 70px 32px';
      row.innerHTML =
        '<div><input type="checkbox" class="wb-check"></div>' +
        '<div class="num" style="font-size:13px">' + entry.tripDate + '</div>' +
        '<div class="stack" style="gap:1px"><span style="font-weight:500">' + entry.driverName + ' · ' + entry.mixerName + '</span><span class="hint">' + entry.plantName + sourceLabel + '</span></div>' +
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
    populateSourceSelect();
    populateDriverSelect();
    populateVehicleSelect();
    renderQueue();
    renderEntries();
    renderHint();
  }

  function init() {
    document.getElementById('page-waybills').innerHTML = HTML;
    document.getElementById('wb-add-form').addEventListener('submit', handleSubmit);
    document.getElementById('wb-max-btn').addEventListener('click', handleMax);
    document.getElementById('wb-source').addEventListener('change', onSourceChange);
    ['wb-date', 'wb-driver', 'wb-mixer'].forEach(function (id) { document.getElementById(id).addEventListener('change', renderHint); });
    document.getElementById('wb-select-all').addEventListener('change', function () {
      var checked = this.checked;
      State.data.waybillEntries.forEach(function (e) { selectedEntryIds[e.id] = checked; });
      renderEntries();
    });
    document.getElementById('wb-download-btn').addEventListener('click', handleDownload);
  }

  // renderedMode: см. комментарий в screen-main.js.
  var renderedMode = null;
  function show() {
    if (window.Viewport && Viewport.isMobile()) {
      if (renderedMode !== 'mobile') { MobileWaybillsScreen.init(); renderedMode = 'mobile'; }
      MobileWaybillsScreen.render();
      return;
    }
    if (renderedMode !== 'desktop') { init(); renderedMode = 'desktop'; }
    render();
  }

  window.WaybillsScreen = { show: show };
})();
