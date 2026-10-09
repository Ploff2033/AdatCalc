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
    // Фильтр типа рейса — сужает и очередь нераспределённых, и список записей
    // одновременно (см. sourceFilterValue), чтобы не листать вперемешку
    // доставки бетона и поступления инертных, когда нужно только одно из двух.
    '<div class="seg" role="group" aria-label="Тип рейсов" id="wb-source-filter-seg" style="width:400px"></div>' +
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
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="wb-range-toggle"> Распределить на несколько дней подряд — максимум рейсов в день, пока не закончится источник или диапазон</label>' +
            '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end" id="wb-fields-row">' +
              '<div class="field" style="flex:1;min-width:140px"><label for="wb-date">Дата</label><input id="wb-date" type="date" class="inp"></div>' +
              '<div class="field" style="flex:1;min-width:140px" id="wb-date-to-field" hidden><label for="wb-date-to">по (включительно)</label><input id="wb-date-to" type="date" class="inp"></div>' +
              '<div class="field" style="flex:1.3;min-width:160px"><label for="wb-driver">Водитель</label><select id="wb-driver" class="inp"></select></div>' +
              '<div class="field" style="flex:1.3;min-width:160px"><label for="wb-mixer" id="wb-mixer-label">Миксер</label><select id="wb-mixer" class="inp"></select></div>' +
              '<div class="field" style="flex:1;min-width:140px"><label for="wb-trailer">Прицеп (необязательно)</label><select id="wb-trailer" class="inp"></select></div>' +
              '<div class="field" style="flex:0.7;min-width:90px" id="wb-trips-field"><label for="wb-trips">Рейсов</label><input id="wb-trips" class="inp num" inputmode="numeric"></div>' +
              '<button type="button" class="btn ghost sm" id="wb-max-btn">MAX</button>' +
            '</div>' +
            '<p class="hint" id="wb-hint" style="margin:0"></p>' +
            '<p class="banner" id="wb-error" hidden></p>' +
            '<p class="banner ok" id="wb-range-summary" hidden></p>' +
            '<button class="btn pri" type="submit" id="wb-submit-btn">Сохранить запись</button>' +
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
  var sourceFilterValue = 'all'; // 'all' | 'order' | 'receipt' — сужает очередь и список записей одновременно

  function entries() { return State.data.waybillEntries || []; }
  function cfgLimits() { return WaybillCalc.cfgLimits(State.data.config); }
  function tripHours(distanceKm, cfg) { return WaybillCalc.tripHours(distanceKm, cfg); }
  function driverUsedHours(driverId, date, excludeId) { return WaybillCalc.driverUsedHours(entries(), State.data.config, driverId, date, excludeId); }
  function mixerUsedHours(mixerId, date, excludeId) { return WaybillCalc.mixerUsedHours(entries(), State.data.config, mixerId, date, excludeId); }

  // Единая очередь (заказы + поступления, см. WaybillCalc.queueItems) —
  // каждый пункт помечен kind, форма читает remaining/distanceKm/label
  // одинаково для обоих источников.
  function queue() {
    var items = WaybillCalc.queueItems(State.data.orders || [], State.data.materialReceipts || [], entries());
    return sourceFilterValue === 'all' ? items : items.filter(function (it) { return it.kind === sourceFilterValue; });
  }

  function renderSourceFilterSeg() {
    var seg = document.getElementById('wb-source-filter-seg');
    var buttons = [
      { value: 'all', label: 'Все' },
      { value: 'order', label: 'Доставки бетона' },
      { value: 'receipt', label: 'Поступления инертных' }
    ];
    seg.innerHTML = buttons.map(function (b) {
      return '<button type="button" data-value="' + b.value + '" class="' + (b.value === sourceFilterValue ? 'on' : '') + '" aria-pressed="' + (b.value === sourceFilterValue) + '">' + b.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        sourceFilterValue = btn.dataset.value;
        renderSourceFilterSeg();
        renderQueue();
        renderEntries();
      });
    });
  }

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

  // Прицеп — по просьбе пользователя, необязательный, один общий список
  // (не переключается по типу рейса, в отличие от wb-mixer — прицеп может
  // таскаться и миксером, и инертовозом).
  function populateTrailerSelect() {
    var select = document.getElementById('wb-trailer');
    var prev = select.value;
    select.innerHTML = '<option value="">Без прицепа</option>' + (State.data.trailers || []).slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .map(function (t) { return '<option value="' + t.id + '">' + t.name + (t.licensePlate ? ' (' + t.licensePlate + ')' : '') + '</option>'; }).join('');
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
    return { kind: 'receipt', id: id, raw: receipt, distanceKm: receipt.distanceKm, tripCount: receipt.tripCount, remaining: WaybillCalc.remainingForReceipt(entries(), receipt), createdAt: receipt.receiptDate };
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
    // Промежуточный итог по топливу — по просьбе пользователя ("не понятно,
    // сколько израсходовано на доставку этой закупки", позже уточнено "а
    // можешь в количестве считать" — литры, не только рубли): сумма уже
    // потраченного на УЖЕ разнесённые рейсы этого поступления, не проекция
    // на весь объём — видно прямо в форме, пока распределяешь очередной день.
    if (src && src.kind === 'receipt') {
      var fuelSoFar = WaybillCalc.fuelForReceipt(entries(), src.id);
      if (fuelSoFar.cost > 0) parts.push('Топливо на доставку уже потрачено: ' + Format.fmtNum(fuelSoFar.liters, 0, 'л') + ' · ' + Format.fmtNum(fuelSoFar.cost, 0, '₽'));
    }
    if (driverId && date) parts.push('Водитель занят: ' + Format.fmtNum(driverUsedHours(driverId, date, null), 1) + ' из ' + Format.fmtNum(cfg.driverShiftHours, 1) + ' ч');
    if (mixerId && date) parts.push((src && src.kind === 'receipt' ? 'Инертовоз' : 'Машина') + ' занят(а): ' + Format.fmtNum(mixerUsedHours(mixerId, date, null), 1) + ' из ' + Format.fmtNum(cfg.vehicleShiftHours, 1) + ' ч');
    document.getElementById('wb-hint').textContent = parts.join(' · ');
  }

  // Диапазон дат — по просьбе пользователя ("и так понятно, что он ближайшие
  // N дней будет возить этот груз"): вместо ручного набора даты на каждый
  // день, один и тот же водитель+машина+источник получают по MAX рейсов в
  // день на весь диапазон разом (см. handleRangeSubmit). Поле "Рейсов" и
  // кнопка MAX тут не нужны — число рейсов в день считается заново для
  // каждой даты (дневные лимиты часов могут отличаться день ото дня, если
  // на кого-то уже что-то распределено).
  function applyRangeModeVisibility() {
    var on = document.getElementById('wb-range-toggle').checked;
    document.getElementById('wb-date-to-field').hidden = !on;
    document.getElementById('wb-trips-field').hidden = on;
    document.getElementById('wb-max-btn').hidden = on;
    document.getElementById('wb-submit-btn').textContent = on ? 'Распределить по дням' : 'Сохранить запись';
    document.getElementById('wb-range-summary').hidden = true;
    document.getElementById('wb-error').hidden = true;
  }

  function isoDate(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtShortDate(iso) { return iso.split('-').reverse().join('.'); }

  async function handleRangeSubmit() {
    var errorEl = document.getElementById('wb-error');
    var summaryEl = document.getElementById('wb-range-summary');
    errorEl.hidden = true;
    summaryEl.hidden = true;
    var src = currentSource();
    var startDateStr = document.getElementById('wb-date').value;
    var endDateStr = document.getElementById('wb-date-to').value;
    var driverId = document.getElementById('wb-driver').value;
    var mixerId = document.getElementById('wb-mixer').value;
    var trailerId = document.getElementById('wb-trailer').value;
    if (!src || !startDateStr || !endDateStr || !driverId || !mixerId) {
      errorEl.textContent = 'Заполните заказ/поступление, обе даты диапазона, водителя и машину.';
      errorEl.hidden = false;
      return;
    }
    if (endDateStr < startDateStr) {
      errorEl.textContent = 'Дата "по" не может быть раньше даты "с".';
      errorEl.hidden = false;
      return;
    }
    var start = new Date(startDateStr + 'T00:00:00');
    var end = new Date(endDateStr + 'T00:00:00');
    var dayCount = Math.round((end - start) / 86400000) + 1;
    if (dayCount > 366) {
      errorEl.textContent = 'Слишком большой диапазон дат — не больше года за раз.';
      errorEl.hidden = false;
      return;
    }

    var driver = State.data.employees.find(function (e) { return e.id === driverId; });
    var vehicleList = src.kind === 'receipt' ? State.data.aggregateTrucks : State.data.mixers;
    var mixer = vehicleList.find(function (m) { return m.id === mixerId; });

    // Локальная симуляция: остаток источника и занятость водителя/машины по
    // дням меняются по ходу распределения, но незачем перезагружать
    // State.loadAll() после каждого дня — копим уже созданные записи тут же
    // и считаем следующий день по этому локальному списку.
    var localEntries = entries().slice();
    var createdDays = [];
    var skippedDays = [];
    var submitBtn = document.getElementById('wb-submit-btn');
    submitBtn.disabled = true;

    try {
      for (var i = 0; i < dayCount; i++) {
        var dateStr = isoDate(new Date(start.getTime() + i * 86400000));

        // Период работы водителя проверяем локально (данные уже загружены
        // в driver.workPeriods) — не тратим запрос на заведомо невозможный
        // день и не заспамим пользователя ошибкой по каждому такому дню.
        var inPeriod = (driver.workPeriods || []).some(function (p) { return p.startDate <= dateStr && (!p.endDate || p.endDate >= dateStr); });
        if (!inPeriod) { skippedDays.push({ date: dateStr, reason: 'вне периода работы водителя' }); continue; }

        var maxResult = src.kind === 'receipt'
          ? WaybillCalc.maxTripsForReceipt(src.raw, localEntries, State.data.config, driverId, mixerId, dateStr)
          : WaybillCalc.maxTrips(src.raw, localEntries, State.data.config, driverId, mixerId, dateStr);

        if (!(maxResult.max > 0)) {
          if (maxResult.remaining === 0) { skippedDays.push({ date: dateStr, reason: 'источник уже полностью распределён' }); break; }
          var reason = maxResult.maxByDriver <= 0 ? 'у водителя не осталось времени в этот день' : 'у машины не осталось времени в этот день';
          skippedDays.push({ date: dateStr, reason: reason });
          continue;
        }

        var body = {
          tripDate: dateStr, driverId: driver.id, driverName: driver.name,
          driverLicenseNumber: driver.licenseNumber || '', mixerId: mixer.id, mixerName: mixer.name,
          mixerPlate: mixer.licensePlate || '', distanceKm: src.distanceKm, tripCount: maxResult.max,
          trailerId: trailerId || null
        };
        if (src.kind === 'receipt') body.receiptId = src.id; else body.orderId = src.id;

        try {
          var created = await Api.post('/waybill-entries', body);
          localEntries.push(created);
          createdDays.push({ date: dateStr, trips: maxResult.max });
        } catch (err) {
          skippedDays.push({ date: dateStr, reason: err.message });
        }
      }
    } finally {
      submitBtn.disabled = false;
    }

    await State.loadAll();
    render();

    if (!createdDays.length) {
      errorEl.textContent = 'Не удалось создать ни одной записи за весь диапазон' + (skippedDays[0] ? ' — ' + skippedDays[0].reason + '.' : '.');
      errorEl.hidden = false;
      return;
    }
    var totalTrips = createdDays.reduce(function (s, d) { return s + d.trips; }, 0);
    var text = 'Создано записей: ' + createdDays.length + ' (' + fmtShortDate(createdDays[0].date) + ' — ' + fmtShortDate(createdDays[createdDays.length - 1].date) + '), всего рейсов: ' + totalTrips + '.';
    if (skippedDays.length) {
      text += ' Пропущено дней: ' + skippedDays.length + ' (' +
        skippedDays.slice(0, 3).map(function (s) { return fmtShortDate(s.date) + ' — ' + s.reason; }).join('; ') +
        (skippedDays.length > 3 ? '…' : '') + ').';
    }
    summaryEl.textContent = text;
    summaryEl.hidden = false;
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
    if (document.getElementById('wb-range-toggle').checked) return handleRangeSubmit();
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
    var trailerId = document.getElementById('wb-trailer').value;
    var body = {
      tripDate: date, driverId: driver.id, driverName: driver.name,
      driverLicenseNumber: driver.licenseNumber || '', mixerId: mixer.id, mixerName: mixer.name,
      mixerPlate: mixer.licensePlate || '', distanceKm: src.distanceKm, tripCount: trips,
      trailerId: trailerId || null
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
    // stillExisting считается по ПОЛНОМУ списку (не отфильтрованному) — иначе
    // переключение фильтра "Доставки"/"Поступления" молча стирало бы отметки
    // выбора на записях, которые просто временно не видны, а не удалены.
    var allEntries = (State.data.waybillEntries || []);
    var stillExisting = {};
    allEntries.forEach(function (e) { stillExisting[e.id] = true; if (!(e.id in selectedEntryIds)) selectedEntryIds[e.id] = true; });
    Object.keys(selectedEntryIds).forEach(function (id) { if (!stillExisting[id]) delete selectedEntryIds[id]; });

    var entries = allEntries
      .filter(function (e) { return sourceFilterValue === 'all' || (sourceFilterValue === 'order' ? !!e.orderId : !!e.receiptId); })
      .slice()
      .sort(function (a, b) {
        if (a.tripDate !== b.tripDate) return b.tripDate < a.tripDate ? -1 : 1;
        return a.driverName.localeCompare(b.driverName, 'ru');
      });
    var container = document.getElementById('wb-entries');
    document.getElementById('wb-entries-empty').hidden = entries.length > 0;
    var cfg = cfgLimits();

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
        '<div class="stack" style="gap:1px"><span style="font-weight:500">' + entry.driverName + ' · ' + entry.mixerName + (entry.trailerName ? ' + ' + entry.trailerName : '') + '</span><span class="hint">' + entry.plantName + sourceLabel + '</span></div>' +
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
    renderSourceFilterSeg();
    populateSourceSelect();
    populateDriverSelect();
    populateVehicleSelect();
    populateTrailerSelect();
    renderQueue();
    renderEntries();
    renderHint();
  }

  function init() {
    document.getElementById('page-waybills').innerHTML = HTML;
    document.getElementById('wb-add-form').addEventListener('submit', handleSubmit);
    document.getElementById('wb-max-btn').addEventListener('click', handleMax);
    document.getElementById('wb-source').addEventListener('change', onSourceChange);
    document.getElementById('wb-range-toggle').addEventListener('change', applyRangeModeVisibility);
    ['wb-date', 'wb-driver', 'wb-mixer'].forEach(function (id) { document.getElementById(id).addEventListener('change', renderHint); });
    applyRangeModeVisibility();
    document.getElementById('wb-select-all').addEventListener('change', function () {
      // Только видимые (по текущему фильтру источника) — иначе "все" в
      // отфильтрованном на "Доставки" виде молча выделило бы и скрытые
      // записи поступлений тоже.
      var checked = this.checked;
      (State.data.waybillEntries || [])
        .filter(function (e) { return sourceFilterValue === 'all' || (sourceFilterValue === 'order' ? !!e.orderId : !!e.receiptId); })
        .forEach(function (e) { selectedEntryIds[e.id] = checked; });
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
