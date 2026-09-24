(function () {
  // Список заказов — данные и правила те же, что в frontend/js/tab-orders.js
  // (GET /api/orders уже отдаёт то же самое обеим версиям), но карточки
  // сгруппированы по дню и раскрываются в разбивку по себестоимости, как в
  // макете Orders.dc.html.
  var ROW_COLS = '120px minmax(0,1fr) 140px 170px 70px 44px';
  var plantFilterValue = '';
  var openMenuId = null;
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap" id="o-scope-label">Заказы</span><h1>Заказы</h1></div>' +
      '<div class="page-head-actions"><button class="btn ghost sm" id="o-export-btn">Экспорт в Excel</button><a href="#/main" class="btn pri sm">Новый заказ</a></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<select class="inp" id="o-plant-filter" style="width:200px" aria-label="Завод" hidden></select>' +
      '<span class="hint" id="o-rent-hint"></span>' +
    '</div>' +
    '<div class="grid-4" id="o-kpi"></div>' +
    '<section class="card stack g12" id="o-date-panel" style="padding:16px 20px" hidden>' +
      '<div class="spread"><h2 style="font-size:16px;font-weight:600">Изменить дату/завод заказа</h2><button type="button" class="btn ghost icon" id="o-date-close" aria-label="Закрыть">✕</button></div>' +
      '<form id="o-date-form" class="stack g12">' +
        '<div class="grid-2">' +
          '<div class="field"><label for="o-date-input">Дата и время</label><input id="o-date-input" type="datetime-local" class="inp" required></div>' +
          '<div class="field"><label for="o-date-plant">Завод</label><select id="o-date-plant" class="inp"></select></div>' +
        '</div>' +
        '<p class="hint" style="margin:0">Реальный кейс: заказ не успели занести сегодня, заводят задним числом на вчера — либо просто перепутали завод при оформлении.</p>' +
        '<p class="banner" id="o-date-error" hidden></p>' +
        '<button class="btn pri" type="submit" style="align-self:flex-start">Сохранить</button>' +
      '</form>' +
    '</section>' +
    '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
      '<div class="row head" style="grid-template-columns:' + ROW_COLS + '"><div>Время</div><div>Смесь и маршрут</div><div class="r">К оплате</div><div class="r">Прибыль</div><div class="r">Рент.</div><div></div></div>' +
      '<div id="o-list"></div>' +
      '<p class="empty-state" id="o-empty" hidden>Заказов пока нет.</p>' +
    '</section>';

  function closeAllMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('.o-menu'), function (m) { m.hidden = true; });
    openMenuId = null;
  }

  var editingOrderId = null;

  function toDatetimeLocalValue(iso) {
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Дата/завод — единственные поля уже оформленного заказа, которые можно
  // поменять (PUT /api/orders/:id/date, тот же эндпоинт, что и в v1 —
  // frontend/js/tab-orders.js). Реальный кейс: не успели занести сегодня,
  // заводят на вчера, либо перепутали завод при оформлении.
  function openEditDate(order) {
    editingOrderId = order.id;
    document.getElementById('o-date-input').value = toDatetimeLocalValue(order.createdAt);
    var plantSelect = document.getElementById('o-date-plant');
    plantSelect.innerHTML = (State.data.plants || []).map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join('');
    var hasCurrentPlant = (State.data.plants || []).some(function (p) { return p.id === order.plantId; });
    if (!hasCurrentPlant) {
      plantSelect.insertAdjacentHTML('afterbegin', '<option value="' + order.plantId + '">' + order.plantName + '</option>');
    }
    plantSelect.value = order.plantId;
    document.getElementById('o-date-error').hidden = true;
    document.getElementById('o-date-panel').hidden = false;
    document.getElementById('o-date-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEditDate() {
    document.getElementById('o-date-panel').hidden = true;
    editingOrderId = null;
  }

  async function handleEditDateSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('o-date-error');
    errorEl.hidden = true;
    var inputValue = document.getElementById('o-date-input').value;
    var plantId = document.getElementById('o-date-plant').value;
    if (!inputValue || !plantId || !editingOrderId) return;
    try {
      await Api.put('/orders/' + editingOrderId + '/date', { createdAt: new Date(inputValue).toISOString(), plantId: plantId });
      closeEditDate();
      await State.loadAll();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  function allocatedTrips(orderId) {
    return (State.data.waybillEntries || []).filter(function (e) { return e.orderId === orderId; })
      .reduce(function (s, e) { return s + e.tripCount; }, 0);
  }

  async function handleCancel(order) {
    if (!confirm('Отменить заказ от ' + timeLabel(order.createdAt) + '? Бронь материалов будет снята.')) return;
    try {
      await Api.post('/orders/' + order.id + '/cancel', {});
      await State.loadAll();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDelete(order) {
    if (!confirm('Удалить заказ насовсем? Это необратимо, история будет потеряна (в отличие от «Отменить»).')) return;
    try {
      await Api.del('/orders/' + order.id);
      await State.loadAll();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function dayKey(iso) { var d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(iso) {
    var d = new Date(iso), now = new Date();
    var dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diffDays = Math.round((todayStart - dayStart) / 86400000);
    if (diffDays === 0) return 'Сегодня';
    if (diffDays === 1) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { weekday: 'long', day: '2-digit', month: 'long' });
  }
  function timeLabel(iso) { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

  function renderKpi(orders) {
    var volume = orders.reduce(function (s, o) { return s + (o.saleVolume || 0); }, 0);
    var pay = orders.reduce(function (s, o) { return s + (o.totalRevenue || 0); }, 0);
    var profit = orders.reduce(function (s, o) { return s + (o.totalProfit || 0); }, 0);
    var waiting = orders.filter(function (o) {
      var entries = (State.data.waybillEntries || []).filter(function (e) { return e.orderId === o.id; });
      var allocated = entries.reduce(function (s, e) { return s + e.tripCount; }, 0);
      return o.tripCount > 0 && allocated < o.tripCount;
    }).length;
    var kpis = [
      { label: 'Заказов', value: Format.fmtNum(orders.length, 0) },
      { label: 'Объём', value: Format.fmtNum(volume, 1, 'м³') },
      { label: 'К оплате', value: Format.fmt(pay, 0) },
      { label: 'Ждут рейсов', value: waiting + ' заказ(ов)' }
    ];
    document.getElementById('o-kpi').innerHTML = kpis.map(function (k) {
      return '<div class="card stack" style="padding:12px 16px;gap:2px"><span class="cap">' + k.label + '</span><span class="num" style="font-size:21px;font-weight:500">' + k.value + '</span></div>';
    }).join('');
  }

  function buildOrderRow(order) {
    var row = document.createElement('div');
    var threshold = (State.data.config && State.data.config.rentabilityThresholdPercent) || 0;
    var belowThreshold = !order.cancelledAt && threshold > 0 && order.totalMarginPercent < threshold;
    row.className = 'row';
    row.style.gridTemplateColumns = ROW_COLS;
    row.style.cursor = 'pointer';
    if (belowThreshold) row.style.background = 'var(--act-bg)';
    if (order.cancelledAt) row.style.opacity = '.55';
    var sign = (order.totalProfit || 0) >= 0 ? '#1C1D1B' : '#8C2217';
    var allocated = order.tripCount > 0 ? allocatedTrips(order.id) : 0;
    var canCancel = !order.cancelledAt && allocated === 0;
    var canDelete = Auth.isAtLeast('admin');
    var canEditDate = Auth.isAtLeast('manager'); // тот же PUT /api/orders/:id/date, что и в v1 — тоже manager+
    row.innerHTML =
      '<div class="num" style="font-size:13px;color:var(--ink-soft)">' + timeLabel(order.createdAt) + '</div>' +
      '<div class="stack" style="gap:2px;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="font-weight:600">' + order.recipeName + '</span>' +
          (order.vatApplied ? '<span class="chip act" style="height:20px;font-size:11px">с НДС</span>' : '') +
          (order.cancelledAt ? '<span class="chip mute" style="height:20px;font-size:11px">Отменён</span>' : '') +
        '</div>' +
        '<span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + order.plantName + ' · ' + Format.fmtNum(order.saleVolume, 1, 'м³') + (order.address ? ' · ' + order.address : '') + '</span>' +
      '</div>' +
      '<div class="r num" style="font-size:15px;font-weight:500">' + Format.fmt(order.totalRevenue, 0) + '</div>' +
      '<div class="r num" style="font-weight:500;color:' + sign + '">' + Format.fmt(order.totalProfit, 0) + '</div>' +
      '<div class="r num" style="font-weight:600;color:' + sign + '">' + Format.fmtNum(order.totalMarginPercent, 1, '%') + '</div>' +
      '<div style="position:relative;display:flex;justify-content:flex-end">' +
        ((canCancel || canDelete || canEditDate) ? '<button type="button" class="btn ghost icon o-menu-btn" aria-label="Действия" style="width:32px;height:32px"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>' +
          '<div class="card stack g4 o-menu" style="position:absolute;right:0;top:36px;z-index:6;padding:6px;min-width:190px" hidden>' +
            (canEditDate ? '<button type="button" class="btn ghost sm o-edit-date-btn" style="justify-content:flex-start">Изменить дату/завод</button>' : '') +
            (canCancel ? '<button type="button" class="btn ghost sm o-cancel-btn" style="justify-content:flex-start">Отменить заказ</button>' : '') +
            (canDelete ? '<button type="button" class="btn ghost sm o-delete-btn" style="justify-content:flex-start;color:#8C2217">Удалить насовсем</button>' : '') +
          '</div>' : '') +
      '</div>';

    if (canCancel || canDelete || canEditDate) {
      var menuBtn = row.querySelector('.o-menu-btn');
      var menu = row.querySelector('.o-menu');
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var willOpen = menu.hidden;
        closeAllMenus();
        if (willOpen) { menu.hidden = false; openMenuId = order.id; }
      });
      var editDateBtn = row.querySelector('.o-edit-date-btn');
      if (editDateBtn) editDateBtn.addEventListener('click', function (e) { e.stopPropagation(); closeAllMenus(); openEditDate(order); });
      var cancelBtn = row.querySelector('.o-cancel-btn');
      if (cancelBtn) cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); handleCancel(order); });
      var deleteBtn = row.querySelector('.o-delete-btn');
      if (deleteBtn) deleteBtn.addEventListener('click', function (e) { e.stopPropagation(); handleDelete(order); });
    }

    var details = document.createElement('div');
    details.hidden = true;
    details.style.cssText = 'grid-column:1/-1;padding:12px 16px;background:var(--surface-2);border-bottom:1px solid var(--border-soft);font-size:13px';
    var materialsHtml = (order.materials || []).map(function (m) {
      return '<div class="spread"><span>' + m.name + '</span><span class="num">' + Format.fmtNum(m.qty, 2, m.unit) + '</span></div>';
    }).join('');
    details.innerHTML =
      '<div class="grid-2" style="max-width:640px">' +
        '<div class="stack g6"><b>Себестоимость 1 м³</b>' +
          '<div class="spread"><span>Материалы</span><span class="num">' + Format.fmt(order.materialsCost, 2) + '</span></div>' +
          '<div class="spread"><span>ФОТ</span><span class="num">' + Format.fmt(order.payrollCost, 2) + '</span></div>' +
          '<div class="spread"><span>Амортизация</span><span class="num">' + Format.fmt(order.deprCost, 2) + '</span></div>' +
          '<div class="spread"><span>Коммуналка</span><span class="num">' + Format.fmt(order.utilitiesCost, 2) + '</span></div>' +
        '</div>' +
        '<div class="stack g6"><b>Расход материалов (заказ)</b>' + materialsHtml + '</div>' +
      '</div>';
    var wrap = document.createElement('div');
    wrap.style.display = 'contents';
    wrap.appendChild(row);
    wrap.appendChild(details);
    row.addEventListener('click', function () { details.hidden = !details.hidden; });
    return wrap;
  }

  function renderPlantFilter() {
    var select = document.getElementById('o-plant-filter');
    var showFilter = Auth.isAtLeast('manager') && State.data.plants.length > 1;
    select.hidden = !showFilter;
    if (!showFilter) return;
    var prev = plantFilterValue;
    select.innerHTML = '<option value="">Все заводы</option>' + State.data.plants.map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join('');
    var valid = State.data.plants.some(function (p) { return p.id === prev; });
    select.value = valid ? prev : '';
    plantFilterValue = select.value;
  }

  function filteredOrders() {
    var orders = (State.data.orders || []).slice();
    if (plantFilterValue) orders = orders.filter(function (o) { return o.plantId === plantFilterValue; });
    return orders;
  }

  // Экспорт — тот же полный 33-колоночный формат, что и в v1
  // (frontend/js/tab-orders.js::exportToExcel), просто на данных из v2-шного
  // filteredOrders(); поля в объекте заказа одни и те же (один и тот же
  // backend/handlers/orders.js::ORDER_COLUMNS для обеих версий), только тут
  // раньше был обрезанный до 7 колонок вариант — по просьбе пользователя
  // ("экспорт... возьми из первой, она куда более информативна").
  function csvEscape(v) { var s = String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csvNum(n) { return (Math.round((n || 0) * 100) / 100).toString().replace('.', ','); }
  function csvDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function exportToExcel() {
    var orders = filteredOrders();
    if (!orders.length) return;

    var headers = [
      'Завод', 'Дата', 'Марка', 'Миксер', 'Адрес доставки', 'Объём (м³)', 'Расстояние (км)', 'Рейс в другой город',
      'Материалы (₽/м³)', 'ФОТ (₽/м³)', 'Амортизация завода (₽/м³)', 'Коммуналка (₽/м³)', 'Себестоимость 1м³ (₽)',
      'Себестоимость смеси (₽)', 'Цена (₽/м³)', 'Выручка со смеси (₽)', 'Прибыль от смеси (₽)', 'Рентабельность смеси (%)',
      'Пробег за рейс (км)', 'Топливо за рейс (₽)', 'Амортизация техники за рейс (₽)', 'Доплата водителю (₽)', 'Рейсов',
      'Расход на доставку (₽)', 'Доход от доставки (₽)', 'Прибыль от доставки (₽)', 'Рентабельность доставки (%)',
      'Выручка всего (₽)', 'С НДС', 'в т.ч. НДС 22% (₽)', 'Чистая прибыль (₽)', 'Прибыль на 1м³ (₽)', 'Рентабельность сделки (%)', 'Расход материалов'
    ];

    var rows = orders.map(function (o) {
      var materialsText = (o.materials || []).map(function (m) {
        return m.name + ': ' + csvNum(m.qty) + ' ' + m.unit;
      }).join(', ');
      // НДС в заказе — не всегда: тумблер "Цена указана с НДС" на Главной
      // определяет сделку целиком (см. o.vatApplied). Извлекаем 22/122 из
      // totalRevenue только когда сделка реально была с НДС.
      var ndsAmount = o.vatApplied ? (o.totalRevenue || 0) * 22 / 122 : 0;
      return [
        o.plantName, csvDate(o.createdAt), o.recipeName, o.mixerName, o.address || '', csvNum(o.saleVolume), csvNum(o.distanceKm), o.neighborCity ? 'да' : 'нет',
        csvNum(o.materialsCost), csvNum(o.payrollCost), csvNum(o.deprCost), csvNum(o.utilitiesCost), csvNum(o.costPerM3),
        csvNum(o.mixCost), csvNum(o.salePrice), csvNum(o.mixRevenue), csvNum(o.mixProfit), csvNum(o.mixMarginPercent),
        csvNum(o.roundTripKm), csvNum(o.fuelCostPerTrip), csvNum(o.amortCostPerTrip), csvNum(o.surchargePerTrip), csvNum(o.tripCount),
        csvNum(o.deliveryCostTotal), csvNum(o.deliveryRevenue), csvNum(o.deliveryProfit), csvNum(o.deliveryMarginPercent),
        csvNum(o.totalRevenue), o.vatApplied ? 'да' : 'нет', csvNum(ndsAmount), csvNum(o.totalProfit), csvNum(o.profitPerM3), csvNum(o.totalMarginPercent), materialsText
      ];
    });

    var csv = '﻿' + [headers].concat(rows).map(function (r) { return r.map(csvEscape).join(';'); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'zakazy-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function render() {
    renderPlantFilter();
    var threshold = (State.data.config && State.data.config.rentabilityThresholdPercent) || 0;
    document.getElementById('o-rent-hint').textContent = threshold > 0
      ? 'Оранжевым — заказы с рентабельностью ниже ' + Format.fmtNum(threshold, 1, '%')
      : '';
    var orders = filteredOrders();
    renderKpi(orders);
    var list = document.getElementById('o-list');
    list.innerHTML = '';
    document.getElementById('o-empty').hidden = orders.length > 0;
    var lastDay = null;
    orders.forEach(function (order) {
      var key = dayKey(order.createdAt);
      if (key !== lastDay) {
        var sep = document.createElement('div');
        sep.style.cssText = 'padding:8px 16px;background:var(--surface-3);font-weight:600;font-size:13px;border-bottom:1px solid var(--border)';
        sep.textContent = dayLabel(order.createdAt);
        list.appendChild(sep);
        lastDay = key;
      }
      list.appendChild(buildOrderRow(order));
    });
  }

  function init() {
    document.getElementById('page-orders').innerHTML = HTML;
    document.getElementById('o-export-btn').addEventListener('click', exportToExcel);
    document.getElementById('o-plant-filter').addEventListener('change', function () { plantFilterValue = this.value; render(); });
    document.getElementById('o-date-close').addEventListener('click', closeEditDate);
    document.getElementById('o-date-form').addEventListener('submit', handleEditDateSubmit);
    document.addEventListener('click', function () { if (openMenuId) closeAllMenus(); });
  }

  // renderedMode: см. комментарий в screen-main.js — desktop-контроллер сам
  // решает, чья разметка (своя или mobile-orders.js) сейчас в #page-orders,
  // и пересобирает DOM только при первом показе/переходе через брейкпоинт.
  var renderedMode = null;
  function show() {
    if (window.Viewport && Viewport.isMobile()) {
      if (renderedMode !== 'mobile') { MobileOrdersScreen.init(); renderedMode = 'mobile'; }
      MobileOrdersScreen.render();
      return;
    }
    if (renderedMode !== 'desktop') { init(); renderedMode = 'desktop'; }
    render();
  }

  window.OrdersScreen = { show: show };
})();
