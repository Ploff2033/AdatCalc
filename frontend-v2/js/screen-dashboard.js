(function () {
  // Дашборд — та же математика точки безубыточности, что в
  // frontend/js/tab-dashboard.js (Calc.fixedCostsBreakdown, накопленный
  // вклад заказов по текущему месяцу), но без линейного графика и без
  // редактирования заводов/ссылок — в макете Dashboard.dc.html это сводные
  // карточки, полное управление заводами остаётся в прежнем интерфейсе.
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap" id="d-scope">Все заводы · только администратор</span><h1 id="d-title">Дашборд</h1></div>' +
      '<div class="page-head-actions"><a href="/" class="btn ghost sm">Управление заводами</a></div>' +
    '</div>' +
    '<div class="grid-4" id="d-kpi"></div>' +
    '<div class="grid-2" id="d-plants" style="gap:16px"></div>';

  var MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  function monthRange() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { start: start, end: end, lastDay: now.getDate(), daysInMonth: daysInMonth, label: MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear() };
  }

  function contributionInRange(orders, plantId, range) {
    var total = 0;
    orders.forEach(function (o) {
      if (plantId && o.plantId !== plantId) return;
      var d = new Date(o.createdAt);
      if (d < range.start || d >= range.end) return;
      total += Calc.orderContribution(o);
    });
    return total;
  }

  function render() {
    var plants = State.data.plants || [];
    var orders = State.data.orders || [];
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };
    var range = monthRange();
    document.getElementById('d-title').textContent = 'Дашборд · ' + range.label;

    var totalOutput = plants.reduce(function (s, p) { return s + (p.targetOutput || 0); }, 0);
    var totalRevenue = orders.reduce(function (s, o) { return s + (o.totalRevenue || 0); }, 0);
    var totalProfit = orders.reduce(function (s, o) { return s + (o.totalProfit || 0); }, 0);
    var totalVolume = orders.reduce(function (s, o) { return s + (o.saleVolume || 0); }, 0);

    document.getElementById('d-kpi').innerHTML = [
      { label: 'Выработка', value: Format.fmtNum(totalVolume, 0, 'м³'), sub: plants.length + ' завод(ов)' },
      { label: 'Заказов', value: Format.fmtNum(orders.length, 0), sub: '' },
      { label: 'Выручка', value: Format.fmt(totalRevenue, 0), sub: 'смесь + доставка' },
      { label: 'Чистая прибыль', value: Format.fmt(totalProfit, 0), sub: 'после постоянных затрат' }
    ].map(function (k) {
      return '<div class="card stack g6" style="padding:16px 18px"><span class="cap">' + k.label + '</span><span class="num" style="font-size:26px;font-weight:500">' + k.value + '</span><span class="hint">' + k.sub + '</span></div>';
    }).join('');

    document.getElementById('d-plants').innerHTML = plants.map(function (plant) {
      var fixed = Calc.fixedCostsBreakdown(plant, plants, summary);
      var contribution = contributionInRange(orders, plant.id, range);
      // Водопад покрытия, как в v1 (tab-dashboard.js): накопленный вклад
      // заказов сначала закрывает ФОТ, остаток — амортизацию+коммуналку.
      // payrollPct/deprUtilPct — % от СВОЕГО бюджета (для подписей),
      // *Amount — доля от общего бюджета (для сегментов полосы).
      var payrollCoveredAmount = Math.min(Math.max(0, contribution), fixed.payroll);
      var payrollPct = fixed.payroll > 0 ? (payrollCoveredAmount / fixed.payroll) * 100 : (contribution > 0 ? 100 : 0);
      var remainderAfterPayroll = Math.max(0, contribution - fixed.payroll);
      var deprUtilCoveredAmount = Math.min(remainderAfterPayroll, fixed.deprUtilities);
      var deprUtilPct = fixed.deprUtilities > 0 ? (deprUtilCoveredAmount / fixed.deprUtilities) * 100 : (remainderAfterPayroll > 0 ? 100 : 0);
      var payrollBarPct = fixed.total > 0 ? (payrollCoveredAmount / fixed.total) * 100 : 0;
      var deprUtilBarPct = fixed.total > 0 ? (deprUtilCoveredAmount / fixed.total) * 100 : 0;
      var plantOrders = orders.filter(function (o) { return o.plantId === plant.id; });
      var plantVolume = plantOrders.reduce(function (s, o) { return s + (o.saleVolume || 0); }, 0);
      var plantRevenue = plantOrders.reduce(function (s, o) { return s + (o.totalRevenue || 0); }, 0);
      var plantProfit = plantOrders.reduce(function (s, o) { return s + (o.totalProfit || 0); }, 0);
      var breakevenPassed = contribution >= fixed.total && fixed.total > 0;
      var stateLabel = breakevenPassed ? 'Безубыточность пройдена' : (payrollPct >= 100 ? 'Покрыт ФОТ и часть аморт.' : 'Не покрыт ФОТ');
      var stateCls = breakevenPassed ? 'ok' : (payrollPct >= 100 ? 'warn' : 'bad');

      return '<section class="card stack g16" style="padding:20px">' +
        '<div class="spread" style="align-items:baseline"><h2 style="font-size:22px;font-weight:600">' + plant.name + '</h2><span class="chip ' + stateCls + '">' + stateLabel + '</span></div>' +
        '<div class="stack g8">' +
          '<div class="spread"><span>Покрытие постоянных расходов</span><span class="num">' + Format.fmt(contribution, 0) + ' из ' + Format.fmt(fixed.total, 0) + '</span></div>' +
          '<div class="bar lg"><span style="width:' + Math.round(payrollBarPct) + '%;background:var(--ink)"></span><span style="width:' + Math.round(deprUtilBarPct) + '%;background:#6B6E66"></span></div>' +
          '<div style="display:flex;gap:16px;font-size:12px;color:var(--ink-soft)">' +
            '<span style="display:flex;gap:6px;align-items:center"><i style="width:10px;height:10px;background:var(--ink);border-radius:2px;display:inline-block"></i>ФОТ ' + Format.fmtNum(payrollPct, 0, '%') + '</span>' +
            '<span style="display:flex;gap:6px;align-items:center"><i style="width:10px;height:10px;background:#6B6E66;border-radius:2px;display:inline-block"></i>Аморт.+комм. ' + Format.fmtNum(deprUtilPct, 0, '%') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="grid-4" style="padding-top:14px;border-top:1px solid var(--border-soft)">' +
          '<div class="stack" style="gap:2px"><span class="cap">Выработка</span><span class="num" style="font-size:17px">' + Format.fmtNum(plantVolume, 0, 'м³') + '</span></div>' +
          '<div class="stack" style="gap:2px"><span class="cap">Выручка</span><span class="num" style="font-size:17px">' + Format.fmt(plantRevenue, 0) + '</span></div>' +
          '<div class="stack" style="gap:2px"><span class="cap">Чистая прибыль</span><span class="num" style="font-size:17px">' + Format.fmt(plantProfit, 0) + '</span></div>' +
          '<div class="stack" style="gap:2px"><span class="cap">ФОТ + аморт./мес</span><span class="num" style="font-size:17px">' + Format.fmt(fixed.total, 0) + '</span></div>' +
        '</div>' +
      '</section>';
    }).join('') || '<p class="empty-state">Заводов ещё нет — создайте в <a href="/">прежнем интерфейсе</a>.</p>';
  }

  var initialized = false;
  function init() {
    document.getElementById('page-dashboard').innerHTML = HTML;
    initialized = true;
  }
  function show() { if (!initialized) init(); render(); }

  window.DashboardScreen = { show: show };
})();
