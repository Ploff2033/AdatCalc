(function () {
  // Дашборд — та же математика точки безубыточности, что в
  // frontend/js/tab-dashboard.js (Calc.fixedCostsBreakdown, накопленный
  // вклад заказов по текущему месяцу) плюс то, чего не было ни в v1, ни в
  // первой версии этого экрана: сводка остатков по складам всех заводов и
  // график динамики остатка одного материала (по просьбе пользователя —
  // "это моё основное окно"). Полное управление заводами теперь в
  // Настройках v2 (см. screen-settings.js), ссылка на "прежний интерфейс"
  // из первой версии этого экрана снята как устаревшая.
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap" id="d-scope">Все заводы · только администратор</span><h1 id="d-title">Дашборд</h1></div>' +
      '<div class="page-head-actions"><a href="#/settings" class="btn ghost sm" data-route="settings">Настройки заводов</a></div>' +
    '</div>' +
    '<div class="grid-4" id="d-kpi"></div>' +
    '<div class="grid-2" id="d-plants" style="gap:16px"></div>' +
    '<div class="page-head" style="padding-top:8px"><h2 style="font-size:18px;font-weight:600">Остатки на складах</h2></div>' +
    '<div class="grid-2" id="d-stock" style="gap:16px"></div>' +
    '<section class="card stack g14" style="padding:20px">' +
      '<div class="spread" style="align-items:center;flex-wrap:wrap;gap:10px">' +
        '<h2 style="font-size:18px;font-weight:600">Динамика остатка</h2>' +
        '<select class="inp" id="d-chart-material" style="width:280px" aria-label="Материал"></select>' +
      '</div>' +
      '<p class="hint" id="d-chart-hint" style="margin:0"></p>' +
      '<div style="overflow-x:auto"><svg id="d-chart-svg" viewBox="0 0 800 220" style="width:100%;height:220px;min-width:520px" role="img" aria-label="График остатка материала по дням"></svg></div>' +
      '<div style="display:flex;gap:18px;font-size:12px;color:var(--ink-soft)">' +
        '<span style="display:flex;gap:6px;align-items:center"><i style="width:10px;height:10px;background:var(--ink);border-radius:2px;display:inline-block"></i>На складе</span>' +
        '<span style="display:flex;gap:6px;align-items:center"><i style="width:10px;height:2px;background:var(--accent);display:inline-block"></i>В брони</span>' +
      '</div>' +
      '<p class="empty-state" id="d-chart-empty" hidden>Движений по этому материалу за последние 30 дней не было.</p>' +
    '</section>';

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

  // Дашборд — сводка по ВСЕМ заводам сразу (см. cap "Все заводы" выше), а
  // State.data.materials плант-скопирован под текущий выбор в сайдбаре (см.
  // shared/state.js::withPlantFilter — это нужно Waybills для driver/
  // material-select текущего завода). Тот же приём, что и в
  // screen-personnel.js для сотрудников: свой отдельный, ничем не
  // ограниченный запрос вместо общего State.data.materials.
  var allMaterials = [];
  async function loadMaterials() {
    try { allMaterials = await Api.get('/materials'); }
    catch (err) { allMaterials = []; }
  }

  function plantMaterials(plantId) {
    return allMaterials.filter(function (m) { return m.plantId === plantId && !m.stockUnlimited; });
  }

  function renderStockSection() {
    var plants = State.data.plants || [];
    var container = document.getElementById('d-stock');
    container.innerHTML = plants.map(function (plant) {
      var materials = plantMaterials(plant.id);
      var deficit = [], warn = [];
      materials.forEach(function (m) {
        var avail = m.stockOnHand - m.stockReserved;
        if (avail < 0) deficit.push(m);
        else if (avail < m.stockThreshold) warn.push(m);
      });
      var critical = deficit.concat(warn).slice(0, 4);
      var stateChip = deficit.length ? '<span class="chip bad">' + deficit.length + ' в дефиците</span>'
        : (warn.length ? '<span class="chip warn">' + warn.length + ' ниже порога</span>' : '<span class="chip ok">Всё в норме</span>');
      return '<section class="card stack g12" style="padding:18px 20px">' +
        '<div class="spread" style="align-items:baseline"><h3 style="font-size:16px;font-weight:600">' + plant.name + '</h3>' + stateChip + '</div>' +
        '<span class="hint">' + materials.length + ' материал(ов) на учёте' + (allMaterials.some(function (m) { return m.plantId === plant.id && m.stockUnlimited; }) ? ' + без учёта остатка' : '') + '</span>' +
        (critical.length
          ? '<div class="stack g8">' + critical.map(function (m) {
              var avail = m.stockOnHand - m.stockReserved;
              var isDeficit = avail < 0;
              return '<div class="spread" style="font-size:13px"><span>' + m.name + '</span><span class="num" style="font-weight:600;color:' + (isDeficit ? '#8C2217' : '#6E4700') + '">' + Format.fmtNum(avail, 1, m.unit) + ' из ' + Format.fmtNum(m.stockThreshold, 0, m.unit) + '</span></div>';
            }).join('') + '</div>'
          : '<p class="hint" style="margin:0">Дефицитных и близких к порогу материалов нет.</p>') +
        '<a href="#/stock" class="btn ghost sm" data-route="stock" style="align-self:flex-start">Открыть Остатки →</a>' +
      '</section>';
    }).join('') || '<p class="empty-state">Заводов ещё нет — добавьте в <a href="#/settings" data-route="settings">Настройках</a>.</p>';
  }

  // ---- График динамики остатка (SVG от руки, тот же приём, что и в v1
  // tab-dashboard.js::renderBreakevenChart — createElementNS, без внешних
  // библиотек) ----
  var svgNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(svgNS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function renderChart(materialId) {
    var svg = document.getElementById('d-chart-svg');
    var hintEl = document.getElementById('d-chart-hint');
    var emptyEl = document.getElementById('d-chart-empty');
    svg.innerHTML = '';
    if (!materialId) { hintEl.textContent = ''; emptyEl.hidden = true; return; }

    Api.get('/stock-movements/daily?materialId=' + encodeURIComponent(materialId) + '&days=30').then(function (data) {
      var days = data.days || [];
      var hasMovements = days.some(function (d) { return d.movements > 0; });
      emptyEl.hidden = hasMovements;
      if (!days.length) { hintEl.textContent = ''; return; }

      var first = days[0], last = days[days.length - 1];
      var trend = last.onHand - first.onHand;
      var trendLabel = trend === 0 ? 'без изменений' : (trend > 0 ? '+' + Format.fmtNum(trend, 1, data.unit) : Format.fmtNum(trend, 1, data.unit));
      hintEl.textContent = 'Сейчас: ' + Format.fmtNum(last.onHand, 1, data.unit) + ' на складе, ' + Format.fmtNum(last.reserved, 1, data.unit) + ' в брони · за 30 дней: ' + trendLabel;

      var W = 800, H = 220, padL = 52, padR = 12, padT = 12, padB = 24;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      var maxVal = days.reduce(function (m, d) { return Math.max(m, d.onHand, d.reserved); }, 0);
      var yMax = maxVal > 0 ? maxVal * 1.15 : 1;

      function x(i) { return padL + (days.length > 1 ? i / (days.length - 1) : 0) * plotW; }
      function y(v) { return padT + plotH - Math.max(0, Math.min(1, v / yMax)) * plotH; }

      [0, yMax / 2, yMax].forEach(function (v) {
        svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: 'var(--border)', 'stroke-width': 1, opacity: 0.5 }));
        var label = svgEl('text', { x: 4, y: y(v) + 3, fill: 'var(--muted)', 'font-size': 10 });
        label.textContent = Format.fmtNum(v, 0);
        svg.appendChild(label);
      });
      [0, Math.floor((days.length - 1) / 2), days.length - 1].forEach(function (i) {
        var d = new Date(days[i].date);
        var label = svgEl('text', {
          x: x(i), y: H - 4, fill: 'var(--muted)', 'font-size': 10,
          'text-anchor': i === 0 ? 'start' : (i === days.length - 1 ? 'end' : 'middle')
        });
        label.textContent = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        svg.appendChild(label);
      });

      var onHandPoints = days.map(function (d, i) { return x(i) + ',' + y(d.onHand); }).join(' ');
      var areaPath = 'M ' + x(0) + ',' + y(0) + ' L ' + onHandPoints + ' L ' + x(days.length - 1) + ',' + y(0) + ' Z';
      svg.appendChild(svgEl('path', { d: areaPath, fill: 'var(--ink)', opacity: 0.08 }));
      svg.appendChild(svgEl('polyline', { points: onHandPoints, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

      var reservedPoints = days.map(function (d, i) { return x(i) + ',' + y(d.reserved); }).join(' ');
      svg.appendChild(svgEl('polyline', { points: reservedPoints, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4,3', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }).catch(function () { hintEl.textContent = ''; });
  }

  var chartMaterialId = '';
  function renderChartSection() {
    var select = document.getElementById('d-chart-material');
    var plants = State.data.plants || [];
    var prev = chartMaterialId || select.value;
    select.innerHTML = plants.map(function (plant) {
      var materials = plantMaterials(plant.id);
      if (!materials.length) return '';
      return '<optgroup label="' + plant.name + '">' + materials.map(function (m) {
        return '<option value="' + m.id + '">' + m.name + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    // Материалы без учёта остатка (stockUnlimited) в select вообще не
    // попадают (plantMaterials их исключает) — по ним нечего показывать на
    // графике, поэтому и запасной вариант ниже выбирается только среди
    // остальных.
    var trackedMaterials = allMaterials.filter(function (m) { return !m.stockUnlimited; });
    var validPrev = trackedMaterials.some(function (m) { return m.id === prev; });
    if (!validPrev) {
      // По умолчанию — самый проблемный материал (дефицит/ниже порога),
      // если такой есть, иначе просто первый попавшийся.
      var critical = trackedMaterials.find(function (m) { return (m.stockOnHand - m.stockReserved) < m.stockThreshold; });
      prev = (critical || trackedMaterials[0] || {}).id || '';
    }
    select.value = prev;
    chartMaterialId = select.value;
    renderChart(chartMaterialId);
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
    }).join('') || '<p class="empty-state">Заводов ещё нет — добавьте в <a href="#/settings" data-route="settings">Настройках</a>.</p>';

    renderStockSection();
    renderChartSection();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-dashboard').innerHTML = HTML;
    // #/settings-ссылки внутри этого экрана — обычные внутренние переходы,
    // но роутер вешает обработчик только на ссылки внутри nav.nav (см.
    // router.js::init) — тут просто добавляем свой.
    document.getElementById('page-dashboard').addEventListener('click', function (e) {
      var link = e.target.closest('a[data-route]');
      if (!link) return;
      e.preventDefault();
      location.hash = '/' + link.dataset.route;
    });
    document.getElementById('d-chart-material').addEventListener('change', function () {
      chartMaterialId = this.value;
      renderChart(chartMaterialId);
    });
    initialized = true;
  }
  function show() {
    if (!initialized) init();
    render();
    loadMaterials().then(function () { renderStockSection(); renderChartSection(); });
  }

  window.DashboardScreen = { show: show };
})();
