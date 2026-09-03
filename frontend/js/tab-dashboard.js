(function () {
  var dialog = document.getElementById('plant-dialog');
  var form = document.getElementById('plant-form');
  var errorEl = document.getElementById('plant-dialog-error');
  var titleEl = document.getElementById('plant-dialog-title');
  var idInput = document.getElementById('plant-id');
  var nameInput = document.getElementById('plant-name');
  var submitBtn = document.getElementById('plant-form-submit');

  function plantLink(plant) {
    return location.origin + location.pathname + '?token=' + encodeURIComponent(plant.accessToken);
  }

  async function copyPlantLink(plant, btn) {
    var url = plantLink(plant);
    var originalText = btn.textContent;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Скопировано!';
      setTimeout(function () { btn.textContent = originalText; }, 2000);
    } catch (err) {
      // Clipboard API недоступен без HTTPS (пока сайт на голом HTTP) — запасной
      // способ: показываем ссылку в диалоге, откуда можно скопировать вручную.
      window.prompt('Скопируйте ссылку (Ctrl+C):', url);
    }
  }

  // Генерирует новый токен — старая ссылка перестаёт работать немедленно —
  // и сразу копирует новую (та же реакция, что у обычной кнопки "Ссылка").
  async function reissuePlantLink(plant, btn) {
    if (!confirm('Перевыпустить ссылку для «' + plant.name + '»? Старая ссылка перестанет работать немедленно.')) return;
    try {
      var updated = await Api.post('/plants/' + plant.id + '/reissue-token', {});
      await State.loadAll();
      await copyPlantLink(updated, btn);
    } catch (err) {
      alert(err.message);
    }
  }

  function openForCreate() {
    titleEl.textContent = 'Новый завод';
    idInput.value = '';
    nameInput.value = '';
    submitBtn.textContent = 'Создать';
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openForEdit(plant) {
    titleEl.textContent = 'Изменить завод';
    idInput.value = plant.id;
    nameInput.value = plant.name;
    submitBtn.textContent = 'Сохранить';
    errorEl.hidden = true;
    dialog.showModal();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    try {
      if (idInput.value) {
        await Api.put('/plants/' + idInput.value, { name: nameInput.value });
      } else {
        var created = await Api.post('/plants', { name: nameInput.value });
        Plant.setCurrent(created.id);
      }
      dialog.close();
      await State.loadAll();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete(plant) {
    if (!confirm('Удалить завод «' + plant.name + '»?')) return;
    try {
      await Api.del('/plants/' + plant.id);
      if (Plant.currentPlantId() === plant.id) {
        var remaining = State.data.plants.find(function (p) { return p.id !== plant.id; });
        if (remaining) Plant.setCurrent(remaining.id);
      }
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderPlantTiles() {
    var container = document.getElementById('dashboard-plant-tiles');
    container.innerHTML = '';
    State.data.plants.forEach(function (plant) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML =
        '<div class="tile-title"></div>' +
        '<div class="tile-meta"></div>' +
        '<div class="tile-meta tile-meta-access"></div>' +
        '<div class="tile-actions">' +
          '<button type="button" class="edit-btn">Изменить</button>' +
          '<button type="button" class="link-btn">Ссылка для работника</button>' +
          '<button type="button" class="reissue-btn">Перевыпустить ссылку</button>' +
          '<button type="button" class="danger del-btn">Удалить</button>' +
        '</div>';
      tile.querySelector('.tile-title').textContent = plant.name;
      tile.querySelector('.tile-meta').textContent =
        Format.fmtNum(plant.targetOutput, 0, 'м³/мес') + ' · амортизация ' + Format.fmt(Calc.plantDeprMonthly(plant), 0) + '/мес';
      tile.querySelector('.tile-meta-access').textContent = plant.tokenLastUsedAt
        ? 'Посл. доступ по ссылке: ' + new Date(plant.tokenLastUsedAt).toLocaleString('ru-RU') + (plant.tokenLastUsedIp ? ' (' + plant.tokenLastUsedIp + ')' : '')
        : 'Ссылка ещё не использовалась';
      tile.querySelector('.edit-btn').addEventListener('click', function () { openForEdit(plant); });
      tile.querySelector('.link-btn').addEventListener('click', function (e) { copyPlantLink(plant, e.target); });
      tile.querySelector('.reissue-btn').addEventListener('click', function (e) { reissuePlantLink(plant, e.target); });
      tile.querySelector('.del-btn').addEventListener('click', function () { handleDelete(plant); });
      container.appendChild(tile);
    });
  }

  function renderSummary() {
    var plants = State.data.plants;
    var orders = State.data.orders || [];
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };

    var totalDepr = plants.reduce(function (sum, p) { return sum + Calc.plantDeprMonthly(p); }, 0);
    var totalOutput = plants.reduce(function (sum, p) { return sum + (p.targetOutput || 0); }, 0);
    var totalPayroll = plants.reduce(function (sum, p) { return sum + ((summary.byPlant && summary.byPlant[p.id]) || 0); }, 0) + (summary.sharedTotal || 0);
    var totalProfit = orders.reduce(function (sum, o) { return sum + (o.totalProfit || 0); }, 0);
    var totalRevenue = orders.reduce(function (sum, o) { return sum + (o.totalRevenue || 0); }, 0);

    document.getElementById('dash-total-depr').textContent = Format.fmt(totalDepr, 0);
    document.getElementById('dash-total-payroll').textContent = Format.fmt(totalPayroll, 0);
    document.getElementById('dash-total-output').textContent = Format.fmtNum(totalOutput, 0, 'м³/мес');
    document.getElementById('dash-orders-count').textContent = Format.fmtNum(orders.length, 0, '');

    var profitEl = document.getElementById('dash-total-profit');
    var profitWrap = document.getElementById('dash-total-profit-wrap');
    profitEl.textContent = Format.fmt(totalProfit, 0);
    profitWrap.classList.remove('positive', 'negative');
    profitWrap.classList.add(totalProfit >= 0 ? 'positive' : 'negative');

    document.getElementById('dash-total-revenue').textContent = Format.fmt(totalRevenue, 0);
  }

  function universalTokenLink(token) {
    return location.origin + location.pathname + '?token=' + encodeURIComponent(token);
  }

  async function copyLink(url, btn) {
    var originalText = btn.textContent;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Скопировано!';
      setTimeout(function () { btn.textContent = originalText; }, 2000);
    } catch (err) {
      window.prompt('Скопируйте ссылку (Ctrl+C):', url);
    }
  }

  async function reissueUniversalToken(btn) {
    if (!confirm('Перевыпустить общую ссылку подмены? Старая перестанет работать немедленно у всех, кто ей пользовался.')) return;
    try {
      await Api.post('/config/reissue-universal-token', {});
      await State.loadAll();
      var token = State.data.config.universalWorkerToken;
      if (token) await copyLink(universalTokenLink(token), btn);
    } catch (err) {
      alert(err.message);
    }
  }

  function renderUniversalToken() {
    var config = State.data.config;
    var token = config && config.universalWorkerToken;
    document.getElementById('universal-token-meta').textContent = config && config.universalTokenLastUsedAt
      ? 'Посл. доступ по ссылке: ' + new Date(config.universalTokenLastUsedAt).toLocaleString('ru-RU') + (config.universalTokenLastUsedIp ? ' (' + config.universalTokenLastUsedIp + ')' : '')
      : 'Ссылка ещё не использовалась';
    document.getElementById('universal-token-copy-btn').onclick = function (e) {
      if (token) copyLink(universalTokenLink(token), e.target);
    };
  }

  function renderPlantTable() {
    var tbody = document.getElementById('dash-plant-table-body');
    tbody.innerHTML = '';
    var orders = State.data.orders || [];
    State.data.plants.forEach(function (plant) {
      var plantOrders = orders.filter(function (o) { return o.plantId === plant.id; });
      var profit = plantOrders.reduce(function (sum, o) { return sum + (o.totalProfit || 0); }, 0);

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td></td><td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = plant.name;
      cells[1].textContent = Format.fmtNum(plant.targetOutput, 0, 'м³');
      cells[2].textContent = Format.fmt(Calc.plantDeprMonthly(plant), 0);
      cells[3].textContent = Format.fmt(plant.utilitiesMonthly || 0, 0);
      cells[4].textContent = Format.fmtNum(plantOrders.length, 0, '');
      cells[5].textContent = Format.fmt(profit, 0);
      cells[5].classList.add(profit >= 0 ? 'positive' : 'negative');
      tbody.appendChild(tr);
    });
  }

  var MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var PLANT_COLORS = ['#3e7a52', '#b5502a', '#4a6fa5', '#8a6a3f', '#7a4a8a', '#2b8f8a', '#a5334a', '#5a8a2b'];
  var breakevenMonthValue = '';
  var breakevenScopeValue = '';

  // Пусто — показываем все заводы + "Итого" на одном графике (масштаб по
  // самому крупному %). Конкретный завод — только его линия, в изоляции:
  // иначе один завод с сотнями % покрытия визуально "съедает" другой,
  // который ещё в минусе (см. скриншот пользователя — Теберда на фоне
  // Джаги выглядела плоской нулевой линией).
  function populateBreakevenScopeOptions() {
    var select = document.getElementById('dash-breakeven-scope');
    select.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'Все заводы';
    select.appendChild(allOpt);
    State.data.plants.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    var valid = State.data.plants.some(function (p) { return p.id === breakevenScopeValue; });
    select.value = valid ? breakevenScopeValue : '';
    breakevenScopeValue = select.value;
  }

  // 'YYYY-MM' -> год/месяц + границы месяца + до какого дня есть смысл
  // считать (сегодня, если это текущий месяц — будущих дней у прошлого
  // месяца нет, у текущего они просто ещё не наступили).
  function monthRange(monthStr) {
    var parts = monthStr.split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    var start = new Date(year, month, 1);
    var end = new Date(year, month + 1, 1);
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var now = new Date();
    var isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
    var lastDay = isCurrentMonth ? now.getDate() : daysInMonth;
    return { year: year, month: month, start: start, end: end, daysInMonth: daysInMonth, lastDay: lastDay };
  }

  function populateBreakevenMonthOptions() {
    var select = document.getElementById('dash-breakeven-month');
    if (select.options.length) return; // заполняем один раз при init
    var now = new Date();
    for (var i = 0; i < 12; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
      select.appendChild(opt);
    }
    breakevenMonthValue = select.value;
  }

  // Расход/накопление по дням месяца для одного завода (или суммарно, если
  // plant не задан — тогда fixedCosts и contribution уже посчитаны заранее).
  function dailyCumulative(orders, plantId, range) {
    var byDay = {};
    orders.forEach(function (o) {
      if (plantId && o.plantId !== plantId) return;
      var d = new Date(o.createdAt);
      if (d < range.start || d >= range.end) return;
      var day = d.getDate();
      byDay[day] = (byDay[day] || 0) + Calc.orderContribution(o);
    });
    var cumulative = [];
    var running = 0;
    for (var day = 1; day <= range.lastDay; day++) {
      running += byDay[day] || 0;
      cumulative.push(running);
    }
    return cumulative;
  }

  function renderBreakevenTable(range) {
    var tbody = document.getElementById('dash-breakeven-table-body');
    tbody.innerHTML = '';
    var plants = State.data.plants;
    var orders = State.data.orders || [];
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };

    plants.forEach(function (plant) {
      var fixedCosts = Calc.fixedCostsMonthly(plant, plants, summary);
      var series = dailyCumulative(orders, plant.id, range);
      var contribution = series.length ? series[series.length - 1] : 0;
      var coveredPercent = fixedCosts > 0 ? (contribution / fixedCosts) * 100 : (contribution > 0 ? 100 : 0);
      var realProfit = contribution - fixedCosts;

      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = plant.name;
      cells[1].textContent = Format.fmt(fixedCosts, 0);
      cells[2].textContent = Format.fmt(contribution, 0);
      cells[3].textContent = Format.fmtNum(Math.max(0, coveredPercent), 0, '%');
      cells[3].classList.add(coveredPercent >= 100 ? 'positive' : 'negative');
      cells[4].textContent = Format.fmt(realProfit, 0);
      cells[4].classList.add(realProfit >= 0 ? 'positive' : 'negative');
      tbody.appendChild(tr);
    });
  }

  // Линии + залитая площадь под ними — по оси X дни месяца, по оси Y
  // процент покрытия постоянных расходов (0-100%+). Пунктир на 100% —
  // сама точка безубыточности. "Итого" — сумма расходов и маржи по ВСЕМ
  // заводам разом (не среднее по процентам — иначе крупный завод и
  // копеечный весили бы поровну).
  function renderBreakevenChart(range) {
    var svg = document.getElementById('dash-breakeven-chart');
    var legend = document.getElementById('dash-breakeven-legend');
    svg.innerHTML = '';
    legend.innerHTML = '';

    var plants = State.data.plants;
    var orders = State.data.orders || [];
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };
    if (!plants.length || range.lastDay < 1) return;

    var W = 800, H = 260, padL = 36, padR = 8, padT = 10, padB = 22;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var series = [{ id: null, name: 'Итого', color: 'var(--accent)' }].concat(
      plants.map(function (p, i) { return { id: p.id, name: p.name, color: PLANT_COLORS[i % PLANT_COLORS.length] }; })
    );
    // Изоляция одного завода — своя шкала, без "Итого" и остальных заводов.
    if (breakevenScopeValue) {
      series = series.filter(function (s) { return s.id === breakevenScopeValue; });
    }

    var totalFixed = plants.reduce(function (sum, p) { return sum + Calc.fixedCostsMonthly(p, plants, summary); }, 0);

    var seriesData = series.map(function (s) {
      var fixedCosts = s.id === null ? totalFixed : Calc.fixedCostsMonthly(plants.find(function (p) { return p.id === s.id; }), plants, summary);
      var cumulative = dailyCumulative(orders, s.id, range);
      var pct = cumulative.map(function (v) { return fixedCosts > 0 ? (v / fixedCosts) * 100 : (v > 0 ? 100 : 0); });
      return { def: s, pct: pct, current: pct.length ? pct[pct.length - 1] : 0 };
    });

    var maxPct = seriesData.reduce(function (m, s) { return Math.max(m, s.pct.reduce(function (mm, v) { return Math.max(mm, v); }, 0)); }, 100);
    var yMax = Math.max(120, Math.ceil((maxPct + 10) / 20) * 20);

    function x(day) { return padL + (range.lastDay > 1 ? (day - 1) / (range.lastDay - 1) : 0) * plotW; }
    function y(pct) { return padT + plotH - (pct / yMax) * plotH; }

    var svgNS = 'http://www.w3.org/2000/svg';
    function el(tag, attrs) {
      var e = document.createElementNS(svgNS, tag);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      return e;
    }

    // Сетка + подпись 100%
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(100), y2: y(100), stroke: 'var(--border)', 'stroke-width': 1, 'stroke-dasharray': '4,4' }));
    svg.appendChild(el('text', { x: padL, y: y(100) - 4, fill: 'var(--text-muted)', 'font-size': 10 })).textContent = '100%';
    [0, yMax / 2, yMax].forEach(function (v) {
      var line = el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: 'var(--border)', 'stroke-width': 1, opacity: 0.4 });
      svg.appendChild(line);
      var label = el('text', { x: 2, y: y(v) + 3, fill: 'var(--text-muted)', 'font-size': 10 });
      label.textContent = Math.round(v) + '%';
      svg.appendChild(label);
    });
    // Подписи по оси X — начало, середина, конец
    [1, Math.ceil(range.lastDay / 2), range.lastDay].forEach(function (day) {
      var label = el('text', { x: x(day), y: H - 4, fill: 'var(--text-muted)', 'font-size': 10, 'text-anchor': day === 1 ? 'start' : (day === range.lastDay ? 'end' : 'middle') });
      label.textContent = day + ' числа';
      svg.appendChild(label);
    });

    seriesData.forEach(function (s) {
      if (s.pct.length < 2) return;
      var linePoints = s.pct.map(function (v, i) { return x(i + 1) + ',' + y(v); }).join(' ');
      var areaPoints = 'M ' + x(1) + ',' + y(0) + ' L ' + s.pct.map(function (v, i) { return x(i + 1) + ',' + y(v); }).join(' L ') + ' L ' + x(s.pct.length) + ',' + y(0) + ' Z';
      svg.appendChild(el('path', { d: areaPoints, fill: s.def.color, opacity: s.def.id === null ? 0.12 : 0.08 }));
      svg.appendChild(el('polyline', {
        points: linePoints, fill: 'none', stroke: s.def.color,
        'stroke-width': s.def.id === null ? 2.5 : 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));
    });

    seriesData.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'breakeven-legend-item';
      item.innerHTML = '<span class="swatch"></span><span class="name"></span><span class="pct"></span>';
      item.querySelector('.swatch').style.background = s.def.color;
      item.querySelector('.name').textContent = s.def.name;
      item.querySelector('.pct').textContent = Format.fmtNum(Math.max(0, s.current), 0, '%');
      item.querySelector('.pct').style.color = s.current >= 100 ? 'var(--positive)' : 'var(--negative)';
      legend.appendChild(item);
    });
  }

  function renderBreakeven() {
    populateBreakevenScopeOptions();
    var range = monthRange(breakevenMonthValue || document.getElementById('dash-breakeven-month').value);
    renderBreakevenTable(range);
    renderBreakevenChart(range);
  }

  function init() {
    document.getElementById('add-plant-btn').addEventListener('click', openForCreate);
    form.addEventListener('submit', handleSubmit);
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    document.getElementById('universal-token-reissue-btn').addEventListener('click', function (e) {
      reissueUniversalToken(e.target);
    });
    populateBreakevenMonthOptions();
    document.getElementById('dash-breakeven-month').addEventListener('change', function () {
      breakevenMonthValue = this.value;
      renderBreakeven();
    });
    document.getElementById('dash-breakeven-scope').addEventListener('change', function () {
      breakevenScopeValue = this.value;
      renderBreakevenChart(monthRange(breakevenMonthValue || document.getElementById('dash-breakeven-month').value));
    });
  }

  function render() {
    if (!window.Auth || !Auth.isAtLeast('admin')) return;
    renderPlantTiles();
    renderSummary();
    renderPlantTable();
    renderBreakeven();
    renderUniversalToken();
  }

  window.DashboardTab = { init: init, render: render };
})();
