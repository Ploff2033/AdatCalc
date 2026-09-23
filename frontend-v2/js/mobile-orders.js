(function () {
  // Мобильный экран «Заказы» (макет MobileOrders.dc.html) — карточки вместо
  // таблицы, отфильтровано по текущему заводу (мобильный вид — это менеджер
  // или ЛПР на конкретной площадке, а не сводка по всем заводам сразу).
  var filter = '7d'; // '7d' | 'waiting' | 'today'
  var HTML =
    '<div class="mobile-page">' +
      '<div class="seg" role="group" aria-label="Фильтр">' +
        '<button type="button" data-f="7d" class="on" style="height:44px">7 дней</button>' +
        '<button type="button" data-f="waiting" style="height:44px">Ждут рейсов</button>' +
        '<button type="button" data-f="today" style="height:44px">Сегодня</button>' +
      '</div>' +
      '<div id="mo-list" class="stack g12"></div>' +
      '<p class="empty-state" id="mo-empty" hidden>Заказов нет.</p>' +
    '</div>';

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
    if (!order.tripCount) return { cls: 'ok', label: 'Самовывоз', pct: 100 };
    var allocated = WaybillCalc.allocatedForOrder(State.data.waybillEntries || [], order.id);
    var pct = order.tripCount > 0 ? Math.round((allocated / order.tripCount) * 100) : 0;
    if (allocated === 0) return { cls: 'act', label: 'Ждёт рейсов', pct: pct };
    if (allocated < order.tripCount) return { cls: 'warn', label: 'Частично', pct: pct };
    return { cls: 'ok', label: 'Отгружен', pct: pct };
  }

  function render() {
    var orders = filteredOrders();
    document.getElementById('mo-empty').hidden = orders.length > 0;
    var container = document.getElementById('mo-list');
    container.innerHTML = orders.map(function (o) {
      var st = statusFor(o);
      var remaining = o.tripCount ? WaybillCalc.remainingForOrder(State.data.waybillEntries || [], o) : 0;
      var allocated = o.tripCount ? WaybillCalc.allocatedForOrder(State.data.waybillEntries || [], o.id) : 0;
      var time = new Date(o.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      var meta = [Format.fmtNum(o.saleVolume, 1, 'м³'), Format.fmtNum(o.distanceKm, 0, 'км')];
      if (o.neighborCity) meta.push('соседний город');
      if (o.vatApplied) meta.push('с НДС');
      var rentColor = (o.totalMarginPercent || 0) >= 0 ? '#1C1D1B' : '#8C2217';
      return '<article class="card stack g8" style="padding:12px 14px" data-order-id="' + o.id + '">' +
        '<div class="spread" style="align-items:center;gap:8px"><span style="font-weight:600">' + o.recipeName + ' <span class="num hint" style="font-weight:400">' + time + '</span></span><span class="chip ' + st.cls + '">' + st.label + '</span></div>' +
        '<span class="hint">' + meta.join(' · ') + '</span>' +
        '<div style="display:grid;grid-template-columns:1.5fr 1fr auto;gap:8px;padding-top:8px;border-top:1px solid var(--border-soft)">' +
          '<div class="stack"><span class="cap" style="font-size:10px">К оплате</span><span class="num" style="font-size:15px;font-weight:600;white-space:nowrap">' + Format.fmt(o.totalRevenue, 0) + '</span></div>' +
          '<div class="stack"><span class="cap" style="font-size:10px">Прибыль</span><span class="num" style="font-size:14px;font-weight:600;white-space:nowrap">' + Format.fmt(o.totalProfit, 0) + '</span></div>' +
          '<div class="stack" style="align-items:flex-end"><span class="cap" style="font-size:10px">Рент.</span><span class="num" style="font-size:14px;font-weight:600;color:' + rentColor + '">' + Format.fmtNum(o.totalMarginPercent, 1, '%') + '</span></div>' +
        '</div>' +
        (o.tripCount ? '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><span style="width:' + st.pct + '%;background:var(--ink)"></span></div><span class="num hint">' + allocated + ' из ' + o.tripCount + ' рейс(ов)</span></div>' : '') +
        (o.tripCount && remaining > 0 ? '<a href="#/waybills" class="btn sm" style="height:44px">Распределить рейсы</a>' : '') +
      '</article>';
    }).join('');
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
  }

  window.MobileOrdersScreen = { init: init, render: render };
})();
