(function () {
  // Список заказов — данные и правила те же, что в frontend/js/tab-orders.js
  // (GET /api/orders уже отдаёт то же самое обеим версиям), но карточки
  // сгруппированы по дню и раскрываются в разбивку по себестоимости, как в
  // макете Orders.dc.html. rentabilityThresholdPercent (подсветка ниже
  // порога) и «Отменить»/«Удалить» — появятся в Фазе 2 вместе со схемой.
  var plantFilterValue = '';
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap" id="o-scope-label">Заказы</span><h1>Заказы</h1></div>' +
      '<div class="page-head-actions"><button class="btn ghost sm" id="o-export-btn">Экспорт в Excel</button><a href="#/main" class="btn pri sm">Новый заказ</a></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<select class="inp" id="o-plant-filter" style="width:200px" aria-label="Завод" hidden></select>' +
    '</div>' +
    '<div class="grid-4" id="o-kpi"></div>' +
    '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
      '<div class="row head" style="grid-template-columns:120px minmax(0,1fr) 140px 170px 70px"><div>Время</div><div>Смесь и маршрут</div><div class="r">К оплате</div><div class="r">Прибыль</div><div class="r">Рент.</div></div>' +
      '<div id="o-list"></div>' +
      '<p class="empty-state" id="o-empty" hidden>Заказов пока нет.</p>' +
    '</section>';

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
    row.className = 'row';
    row.style.gridTemplateColumns = '120px minmax(0,1fr) 140px 170px 70px';
    row.style.cursor = 'pointer';
    var sign = (order.totalProfit || 0) >= 0 ? '#1C1D1B' : '#8C2217';
    row.innerHTML =
      '<div class="num" style="font-size:13px;color:var(--ink-soft)">' + timeLabel(order.createdAt) + '</div>' +
      '<div class="stack" style="gap:2px;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:8px"><span style="font-weight:600">' + order.recipeName + '</span>' + (order.vatApplied ? '<span class="chip act" style="height:20px;font-size:11px">с НДС</span>' : '') + '</div>' +
        '<span class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + order.plantName + ' · ' + Format.fmtNum(order.saleVolume, 1, 'м³') + (order.address ? ' · ' + order.address : '') + '</span>' +
      '</div>' +
      '<div class="r num" style="font-size:15px;font-weight:500">' + Format.fmt(order.totalRevenue, 0) + '</div>' +
      '<div class="r num" style="font-weight:500;color:' + sign + '">' + Format.fmt(order.totalProfit, 0) + '</div>' +
      '<div class="r num" style="font-weight:600;color:' + sign + '">' + Format.fmtNum(order.totalMarginPercent, 1, '%') + '</div>';

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

  function csvEscape(v) { var s = String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csvNum(n) { return (Math.round((n || 0) * 100) / 100).toString().replace('.', ','); }

  function exportToExcel() {
    var orders = filteredOrders();
    if (!orders.length) return;
    var headers = ['Завод', 'Дата', 'Марка', 'Объём (м³)', 'К оплате (₽)', 'Прибыль (₽)', 'Рентабельность (%)'];
    var rows = orders.map(function (o) {
      return [o.plantName, new Date(o.createdAt).toLocaleString('ru-RU'), o.recipeName, csvNum(o.saleVolume), csvNum(o.totalRevenue), csvNum(o.totalProfit), csvNum(o.totalMarginPercent)];
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

  var initialized = false;
  function init() {
    document.getElementById('page-orders').innerHTML = HTML;
    document.getElementById('o-export-btn').addEventListener('click', exportToExcel);
    document.getElementById('o-plant-filter').addEventListener('change', function () { plantFilterValue = this.value; render(); });
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.OrdersScreen = { show: show };
})();
