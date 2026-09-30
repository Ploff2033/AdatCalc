(function () {
  // Поступления инертных — новый модуль (см. документ "AdatBeton Calc v2 —
  // архитектура модулей", обновление 30.09.2026): сырьё, приходящее НА
  // завод, а не отгрузка клиенту. Рейсы по записи разносятся тем же
  // экраном "Путевые листы", что и заказы на бетон (см. screen-waybills.js,
  // receiptId вместо orderId) — здесь только сама запись поступления:
  // материал + объём + техника (для подсчёта числа рейсов) + расстояние.
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap" id="rc-scope">Все заводы</span><h1>Поступления инертных</h1></div><div class="page-head-actions"><button class="btn pri sm" id="rc-add-btn">Новое поступление</button></div></div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<select class="inp" id="rc-plant-filter" style="width:200px" aria-label="Завод" hidden></select>' +
    '</div>' +
    '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
      '<div class="row head" style="grid-template-columns:100px 1fr 140px 1fr 100px 140px 44px"><div>Дата</div><div>Материал</div><div class="r">Объём</div><div>Техника</div><div class="r">Рейсов</div><div>Статус</div><div></div></div>' +
      '<div id="rc-rows"></div>' +
      '<p class="empty-state" id="rc-empty" hidden>Поступлений пока нет.</p>' +
    '</section>' +
    '<aside class="drawer" id="rc-drawer" hidden>' +
      '<div class="drawer-head"><h2>Новое поступление</h2><button type="button" class="btn ghost icon" id="rc-drawer-close" aria-label="Закрыть">✕</button></div>' +
      '<form id="rc-form">' +
        '<div class="drawer-body">' +
          '<div class="field" id="rc-f-plant-field"><label for="rc-f-plant">Завод</label><select id="rc-f-plant" class="inp"></select></div>' +
          '<div class="field"><label for="rc-f-date">Дата поступления</label><input id="rc-f-date" type="date" class="inp"></div>' +
          '<div class="field"><label for="rc-f-material">Материал</label><select id="rc-f-material" class="inp"></select></div>' +
          '<div class="field"><label for="rc-f-qty">Объём</label><div class="unit"><input id="rc-f-qty" class="inp num" inputmode="decimal"><span id="rc-f-qty-unit">т</span></div></div>' +
          '<div class="field"><label for="rc-f-truck">Техника (для расчёта числа рейсов)</label><select id="rc-f-truck" class="inp"></select></div>' +
          '<div class="field"><label for="rc-f-dist">Расстояние (туда)</label><div class="unit"><input id="rc-f-dist" class="inp num" inputmode="decimal"><span>км</span></div></div>' +
          '<div class="field"><label for="rc-f-address">Адрес поставщика</label><input id="rc-f-address" class="inp" placeholder="Откуда везли — для путевого листа"></div>' +
          '<div class="field"><label for="rc-f-trips">Рейсов</label><input id="rc-f-trips" class="inp num" inputmode="numeric"></div>' +
          '<p class="hint" id="rc-f-trips-preview" style="margin:0"></p>' +
        '</div>' +
        '<div class="drawer-foot">' +
          '<p class="banner" id="rc-form-error" hidden></p>' +
          '<button type="submit" class="btn pri" id="rc-save-btn">Добавить поступление</button>' +
        '</div>' +
      '</form>' +
    '</aside>';

  var plantFilterValue = '';
  var tripsFieldTouched = false; // true — пользователь сам поправил "Рейсов", больше не перезаписываем авторасчётом

  // Москва на +3: см. тот же приём в screen-cash.js — new Date().toISOString()
  // сдвигает календарную дату назад в окне полуночь-3ч МСК.
  function localDateStr(d) {
    d = d || new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    return parts.length === 3 ? parts[2] + '.' + parts[1] + '.' + parts[0] : iso;
  }

  function receipts() { return State.data.materialReceipts || []; }

  function statusFor(r) {
    if (r.cancelledAt) return { cls: 'mute', label: 'Отменено' };
    var allocated = WaybillCalc.allocatedForReceipt(State.data.waybillEntries || [], r.id);
    if (allocated === 0) return { cls: 'act', label: 'Ждёт рейсов' };
    if (allocated < r.tripCount) return { cls: 'warn', label: 'Частично' };
    return { cls: 'ok', label: 'Разнесено' };
  }

  // Топливо, уже потраченное на доставку ЭТОЙ закупки — сумма по всем уже
  // разнесённым рейсам (waybill_entries.receiptId === r.id), а не расчёт на
  // весь объём поступления: пока распределена только часть рейсов, это и
  // есть фактически израсходованное на сегодня, без домыслов о будущем.
  // fuelCostPerTrip — стоимость ОДНОГО рейса (см. validateAndBuild в
  // backend/handlers/waybill-entries.js), поэтому умножаем на tripCount.
  function fuelCostFor(receiptId) {
    return (State.data.waybillEntries || [])
      .filter(function (e) { return e.receiptId === receiptId; })
      .reduce(function (s, e) { return s + e.tripCount * (e.fuelCostPerTrip || 0); }, 0);
  }

  function renderFilters() {
    var plants = State.data.plants || [];
    var select = document.getElementById('rc-plant-filter');
    select.hidden = !(plants.length > 1);
    if (plants.length > 1) {
      select.innerHTML = '<option value="">Все заводы</option>' + plants.map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
      select.value = plantFilterValue;
    }
    document.getElementById('rc-scope').textContent = plantFilterValue ? (plants.find(function (p) { return p.id === plantFilterValue; }) || {}).name || 'Завод' : 'Все заводы';
  }

  function filteredReceipts() {
    var list = receipts().slice();
    if (plantFilterValue) list = list.filter(function (r) { return r.plantId === plantFilterValue; });
    // Сортировка по дате поступления (бухгалтерский смысл — когда реально
    // пришла машина), а не по created_at (когда запись завели в системе) —
    // это разные даты, если приход оформили задним числом. created_at —
    // только разрыв ничьей, если даты поступления совпадают.
    return list.sort(function (a, b) {
      if (a.receiptDate !== b.receiptDate) return a.receiptDate < b.receiptDate ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function renderRows() {
    var list = filteredReceipts();
    document.getElementById('rc-empty').hidden = list.length > 0;
    document.getElementById('rc-rows').innerHTML = list.map(function (r) {
      var st = statusFor(r);
      var allocated = WaybillCalc.allocatedForReceipt(State.data.waybillEntries || [], r.id);
      var canCancel = !r.cancelledAt && allocated === 0;
      var fuelCost = fuelCostFor(r.id);
      return '<div class="row" style="grid-template-columns:100px 1fr 140px 1fr 100px 140px 44px;opacity:' + (r.cancelledAt ? '.6' : '1') + '">' +
        '<div class="num hint">' + fmtDate(r.receiptDate) + '</div>' +
        '<div class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + r.materialName + '</span><span class="hint">' + r.plantName + '</span></div>' +
        '<div class="r num">' + Format.fmtNum(r.qty, 2, r.unit) + '</div>' +
        '<div class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + r.truckName + ' · ' + Format.fmtNum(r.distanceKm, 0, 'км') + (r.address ? ' · ' + r.address : '') + '</div>' +
        '<div class="stack" style="gap:1px;align-items:flex-end"><span class="r num">' + allocated + ' из ' + Format.fmtNum(r.tripCount, 0) + '</span>' +
          (fuelCost > 0 ? '<span class="hint num" style="font-size:11px;white-space:nowrap">' + Format.fmtNum(fuelCost, 0, '₽ топл.') + '</span>' : '') +
        '</div>' +
        '<div><span class="chip ' + st.cls + '">' + st.label + '</span></div>' +
        '<div style="display:flex;justify-content:flex-end">' +
          (canCancel ? '<button type="button" class="btn ghost icon rc-cancel-btn" aria-label="Отменить" title="Отменить" data-receipt-id="' + r.id + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.rc-cancel-btn'), function (btn) {
      btn.addEventListener('click', function () { handleCancel(btn.dataset.receiptId); });
    });
  }

  async function handleCancel(id) {
    if (!confirm('Отменить поступление? Действие нельзя отменить обратно (только заново создать запись).')) return;
    try {
      await Api.post('/material-receipts/' + id + '/cancel', {});
      await State.loadAll();
      render();
    } catch (err) { alert(err.message); }
  }

  function renderPlantSelect() {
    var select = document.getElementById('rc-f-plant');
    var plants = State.data.plants || [];
    document.getElementById('rc-f-plant-field').hidden = plants.length <= 1;
    select.innerHTML = plants.map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
    select.value = plantFilterValue && plants.some(function (p) { return p.id === plantFilterValue; }) ? plantFilterValue : (Plant.currentPlantId() || (plants[0] && plants[0].id) || '');
  }

  function renderMaterialSelect() {
    var plantId = document.getElementById('rc-f-plant').value;
    var select = document.getElementById('rc-f-material');
    var prev = select.value;
    var mats = (State.data.materials || []).filter(function (m) { return m.plantId === plantId; });
    select.innerHTML = mats.map(function (m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) select.value = prev;
    document.getElementById('rc-f-qty-unit').textContent = (mats.find(function (m) { return m.id === select.value; }) || {}).unit || '';
  }

  function renderTruckSelect() {
    var select = document.getElementById('rc-f-truck');
    var prev = select.value;
    select.innerHTML = (State.data.aggregateTrucks || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); })
      .map(function (t) { return '<option value="' + t.id + '">' + t.name + (t.licensePlate ? ' (' + t.licensePlate + ')' : '') + ' — ' + Format.fmtNum(t.capacity, 1) + '</option>'; }).join('');
    if (Array.prototype.some.call(select.options, function (o) { return o.value === prev; })) select.value = prev;
  }

  // Число рейсов — редактируемое поле, а не просто вывод расчёта: техника
  // не всегда возит полную загрузку, фактическое число рейсов может
  // отличаться от округления объём/грузоподъёмность. Подсказка продолжает
  // показывать расчётное значение и автоматически подставляется в поле,
  // пока пользователь сам его не поправил (tripsFieldTouched) — дальше поле
  // живёт своей жизнью, чтобы случайная правка объёма/техники после этого
  // не затёрла то, что человек уже вписал вручную.
  function suggestedTripCount() {
    var qty = NumericInput.parseNumber(document.getElementById('rc-f-qty').value) || 0;
    var truck = (State.data.aggregateTrucks || []).find(function (t) { return t.id === document.getElementById('rc-f-truck').value; });
    if (!(qty > 0) || !truck || !(truck.capacity > 0)) return null;
    return { trips: Math.max(1, Math.ceil(qty / truck.capacity)), truck: truck };
  }

  function updateTripsPreview() {
    var preview = document.getElementById('rc-f-trips-preview');
    var s = suggestedTripCount();
    if (!s) { preview.textContent = ''; return; }
    preview.textContent = 'Расчётное число рейсов: ' + s.trips + ' (по грузоподъёмности ' + Format.fmtNum(s.truck.capacity, 1) + '); можно поправить вручную, если по факту было иначе.';
    if (!tripsFieldTouched) document.getElementById('rc-f-trips').value = s.trips;
  }

  function openForCreate() {
    document.getElementById('rc-form-error').hidden = true;
    tripsFieldTouched = false;
    renderPlantSelect();
    renderMaterialSelect();
    renderTruckSelect();
    document.getElementById('rc-f-date').value = localDateStr();
    document.getElementById('rc-f-address').value = '';
    document.getElementById('rc-f-trips').value = '';
    NumericInput.setFormattedValue(document.getElementById('rc-f-qty'), '');
    NumericInput.setFormattedValue(document.getElementById('rc-f-dist'), '');
    updateTripsPreview();
    document.getElementById('rc-drawer').hidden = false;
  }

  function closeDrawer() { document.getElementById('rc-drawer').hidden = true; }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('rc-form-error');
    errorEl.hidden = true;
    var payload = {
      plantId: document.getElementById('rc-f-plant').value,
      receiptDate: document.getElementById('rc-f-date').value,
      materialId: document.getElementById('rc-f-material').value,
      qty: NumericInput.parseNumber(document.getElementById('rc-f-qty').value) || 0,
      truckId: document.getElementById('rc-f-truck').value,
      distanceKm: NumericInput.parseNumber(document.getElementById('rc-f-dist').value) || 0,
      address: document.getElementById('rc-f-address').value.trim(),
      tripCount: parseInt(document.getElementById('rc-f-trips').value, 10)
    };
    if (!payload.plantId || !payload.receiptDate || !payload.materialId || !(payload.qty > 0) || !payload.truckId || !(payload.distanceKm > 0)) {
      errorEl.textContent = 'Заполните завод, дату поступления, материал, объём больше нуля, технику и расстояние больше нуля.';
      errorEl.hidden = false;
      return;
    }
    if (!(payload.tripCount > 0)) {
      errorEl.textContent = 'Число рейсов должно быть больше нуля.';
      errorEl.hidden = false;
      return;
    }
    try {
      await Api.post('/material-receipts', payload);
      closeDrawer();
      await State.loadAll();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  function render() {
    renderFilters();
    renderRows();
  }

  function init() {
    document.getElementById('page-receipts').innerHTML = HTML;
    document.getElementById('rc-add-btn').addEventListener('click', openForCreate);
    document.getElementById('rc-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('rc-form').addEventListener('submit', handleSubmit);
    document.getElementById('rc-plant-filter').addEventListener('change', function () { plantFilterValue = this.value; render(); });
    document.getElementById('rc-f-plant').addEventListener('change', renderMaterialSelect);
    document.getElementById('rc-f-material').addEventListener('change', updateTripsPreview);
    document.getElementById('rc-f-truck').addEventListener('change', updateTripsPreview);
    document.getElementById('rc-f-qty').addEventListener('input', updateTripsPreview);
    document.getElementById('rc-f-trips').addEventListener('input', function () { tripsFieldTouched = true; });
    NumericInput.attach(document.getElementById('rc-f-qty'));
    NumericInput.attach(document.getElementById('rc-f-dist'));
  }

  var initialized = false;
  function show() {
    if (!initialized) { init(); initialized = true; }
    render();
  }

  window.MaterialReceiptsScreen = { show: show };
})();
