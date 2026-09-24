(function () {
  // Мобильный экран «Заказы» (макет MobileOrders.dc.html) — карточки вместо
  // таблицы, отфильтровано по текущему заводу (мобильный вид — это менеджер
  // или ЛПР на конкретной площадке, а не сводка по всем заводам сразу).
  var filter = '7d'; // '7d' | 'waiting' | 'today'
  var editingOrderId = null;
  var HTML =
    '<div class="mobile-page">' +
      '<div class="seg" role="group" aria-label="Фильтр">' +
        '<button type="button" data-f="7d" class="on" style="height:44px">7 дней</button>' +
        '<button type="button" data-f="waiting" style="height:44px">Ждут рейсов</button>' +
        '<button type="button" data-f="today" style="height:44px">Сегодня</button>' +
      '</div>' +
      '<section class="card stack g12" id="mo-date-panel" style="padding:14px" hidden>' +
        '<div class="spread"><span style="font-weight:600">Изменить дату/завод</span><button type="button" class="btn ghost icon" id="mo-date-close" aria-label="Закрыть">✕</button></div>' +
        '<form id="mo-date-form" class="stack g12">' +
          '<div class="field"><label for="mo-date-input">Дата и время</label><input id="mo-date-input" type="datetime-local" class="inp" style="height:48px" required></div>' +
          '<div class="field"><label for="mo-date-plant">Завод</label><select id="mo-date-plant" class="inp" style="height:48px"></select></div>' +
          '<p class="banner" id="mo-date-error" hidden></p>' +
          '<button class="btn pri" type="submit" style="height:48px">Сохранить</button>' +
        '</form>' +
      '</section>' +
      '<div id="mo-list" class="stack g12"></div>' +
      '<p class="empty-state" id="mo-empty" hidden>Заказов нет.</p>' +
    '</div>';

  function toDatetimeLocalValue(iso) {
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Реальный кейс: не успели занести заказ сегодня, заводят на вчера — тот
  // же PUT /api/orders/:id/date, что и на десктопе (screen-orders.js) и в v1.
  function openEditDate(order) {
    editingOrderId = order.id;
    document.getElementById('mo-date-input').value = toDatetimeLocalValue(order.createdAt);
    var plantSelect = document.getElementById('mo-date-plant');
    plantSelect.innerHTML = (State.data.plants || []).map(function (p) {
      return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join('');
    var hasCurrentPlant = (State.data.plants || []).some(function (p) { return p.id === order.plantId; });
    if (!hasCurrentPlant) {
      plantSelect.insertAdjacentHTML('afterbegin', '<option value="' + order.plantId + '">' + order.plantName + '</option>');
    }
    plantSelect.value = order.plantId;
    document.getElementById('mo-date-error').hidden = true;
    document.getElementById('mo-date-panel').hidden = false;
    document.getElementById('mo-date-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEditDate() {
    document.getElementById('mo-date-panel').hidden = true;
    editingOrderId = null;
  }

  async function handleEditDateSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('mo-date-error');
    errorEl.hidden = true;
    var inputValue = document.getElementById('mo-date-input').value;
    var plantId = document.getElementById('mo-date-plant').value;
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

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  function filteredOrders() {
    var plantId = Plant.currentPlantId();
    var orders = (State.data.orders || []).filter(function (o) { return !plantId || o.plantId === plantId; });
    if (filter === 'today') {
      var today = startOfDay(new Date());
      orders = orders.filter(function (o) { return new Date(o.createdAt) >= today; });
    } else if (filter === '7d') {
      var from = new Date();
      from.setDate(from.getDate() - 6);
      from = startOfDay(from);
      orders = orders.filter(function (o) { return new Date(o.createdAt) >= from; });
    } else if (filter === 'waiting') {
      orders = orders.filter(function (o) {
        var remaining = WaybillCalc.remainingForOrder(State.data.waybillEntries || [], o);
        return o.tripCount > 0 && remaining > 0;
      });
    }
    return orders.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  function statusFor(order) {
    if (order.cancelledAt) return { cls: 'mute', label: 'Отменён', pct: 0 };
    if (!order.tripCount) return { cls: 'ok', label: 'Самовывоз', pct: 100 };
    var allocated = WaybillCalc.allocatedForOrder(State.data.waybillEntries || [], order.id);
    var pct = order.tripCount > 0 ? Math.round((allocated / order.tripCount) * 100) : 0;
    if (allocated === 0) return { cls: 'act', label: 'Ждёт рейсов', pct: pct };
    if (allocated < order.tripCount) return { cls: 'warn', label: 'Частично', pct: pct };
    return { cls: 'ok', label: 'Отгружен', pct: pct };
  }

  async function handleCancel(orderId) {
    if (!confirm('Отменить заказ? Бронь материалов будет снята.')) return;
    try {
      await Api.post('/orders/' + orderId + '/cancel', {});
      await State.loadAll();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function render() {
    var orders = filteredOrders();
    document.getElementById('mo-empty').hidden = orders.length > 0;
    var container = document.getElementById('mo-list');
    var threshold = (State.data.config && State.data.config.rentabilityThresholdPercent) || 0;
    container.innerHTML = orders.map(function (o) {
      var st = statusFor(o);
      var remaining = o.tripCount ? WaybillCalc.remainingForOrder(State.data.waybillEntries || [], o) : 0;
      var allocated = o.tripCount ? WaybillCalc.allocatedForOrder(State.data.waybillEntries || [], o.id) : 0;
      var canCancel = !o.cancelledAt && allocated === 0;
      var canEditDate = Auth.isAtLeast('manager');
      var belowThreshold = !o.cancelledAt && threshold > 0 && o.totalMarginPercent < threshold;
      var time = new Date(o.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      var meta = [Format.fmtNum(o.saleVolume, 1, 'м³'), Format.fmtNum(o.distanceKm, 0, 'км')];
      if (o.neighborCity) meta.push('соседний город');
      if (o.vatApplied) meta.push('с НДС');
      var rentColor = (o.totalMarginPercent || 0) >= 0 ? '#1C1D1B' : '#8C2217';
      return '<article class="card stack g8" style="padding:12px 14px;' + (belowThreshold ? 'background:var(--act-bg);' : '') + (o.cancelledAt ? 'opacity:.6;' : '') + '" data-order-id="' + o.id + '">' +
        '<div class="spread" style="align-items:center;gap:8px"><span style="font-weight:600">' + o.recipeName + ' <span class="num hint" style="font-weight:400">' + time + '</span></span><span class="chip ' + st.cls + '">' + st.label + '</span></div>' +
        '<span class="hint">' + meta.join(' · ') + '</span>' +
        '<div style="display:grid;grid-template-columns:1.5fr 1fr auto;gap:8px;padding-top:8px;border-top:1px solid var(--border-soft)">' +
          '<div class="stack"><span class="cap" style="font-size:10px">К оплате</span><span class="num" style="font-size:15px;font-weight:600;white-space:nowrap">' + Format.fmt(o.totalRevenue, 0) + '</span></div>' +
          '<div class="stack"><span class="cap" style="font-size:10px">Прибыль</span><span class="num" style="font-size:14px;font-weight:600;white-space:nowrap">' + Format.fmt(o.totalProfit, 0) + '</span></div>' +
          '<div class="stack" style="align-items:flex-end"><span class="cap" style="font-size:10px">Рент.</span><span class="num" style="font-size:14px;font-weight:600;color:' + rentColor + '">' + Format.fmtNum(o.totalMarginPercent, 1, '%') + '</span></div>' +
        '</div>' +
        (o.tripCount && !o.cancelledAt ? '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><span style="width:' + st.pct + '%;background:var(--ink)"></span></div><span class="num hint">' + allocated + ' из ' + o.tripCount + ' рейс(ов)</span></div>' : '') +
        ((remaining > 0 || canCancel || canEditDate) ? '<div style="display:grid;grid-template-columns:repeat(' + [remaining > 0, canCancel, canEditDate].filter(Boolean).length + ',1fr);gap:8px">' +
          (remaining > 0 ? '<a href="#/waybills" class="btn sm" style="height:44px">Распределить рейсы</a>' : '') +
          (canEditDate ? '<button type="button" class="btn ghost sm o-date-btn" style="height:44px">Дата</button>' : '') +
          (canCancel ? '<button type="button" class="btn ghost sm o-cancel-btn" style="height:44px;color:#8C2217;border-color:#E3B8B1">Отменить</button>' : '') +
        '</div>' : '') +
      '</article>';
    }).join('');

    Array.prototype.forEach.call(container.querySelectorAll('.o-cancel-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var orderId = btn.closest('[data-order-id]').dataset.orderId;
        handleCancel(orderId);
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll('.o-date-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var orderId = btn.closest('[data-order-id]').dataset.orderId;
        var order = orders.find(function (o) { return o.id === orderId; });
        if (order) openEditDate(order);
      });
    });
  }

  function init() {
    document.getElementById('page-orders').innerHTML = HTML;
    Array.prototype.forEach.call(document.querySelectorAll('[data-f]'), function (btn) {
      btn.addEventListener('click', function () {
        filter = btn.dataset.f;
        Array.prototype.forEach.call(document.querySelectorAll('[data-f]'), function (b) { b.classList.toggle('on', b === btn); });
        render();
      });
    });
    document.getElementById('mo-date-close').addEventListener('click', closeEditDate);
    document.getElementById('mo-date-form').addEventListener('submit', handleEditDateSubmit);
  }

  window.MobileOrdersScreen = { init: init, render: render };
})();
