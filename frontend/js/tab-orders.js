(function () {
  var plantFilterValue = '';
  var periodFilterValue = 'all';
  var customFrom = '';
  var customTo = '';

  function setSigned(el, amount) {
    el.textContent = Format.fmt(amount, 2);
    el.classList.remove('positive', 'negative');
    el.classList.add(amount >= 0 ? 'positive' : 'negative');
  }

  function setSignedPct(el, percent) {
    el.textContent = Format.fmtNum(percent, 1, '%');
    el.classList.remove('positive', 'negative');
    el.classList.add(percent >= 0 ? 'positive' : 'negative');
  }

  function fillAll(card, key, text) {
    Array.prototype.forEach.call(card.querySelectorAll('[data-f="' + key + '"]'), function (el) {
      el.textContent = text;
    });
  }

  function fillAllSigned(card, key, amount) {
    Array.prototype.forEach.call(card.querySelectorAll('[data-f="' + key + '"]'), function (el) {
      setSigned(el, amount);
    });
  }

  function fillAllSignedPct(card, key, percent) {
    Array.prototype.forEach.call(card.querySelectorAll('[data-f="' + key + '"]'), function (el) {
      setSignedPct(el, percent);
    });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function handleDelete(order) {
    if (!confirm('Удалить заказ от ' + formatDate(order.createdAt) + '?')) return;
    try {
      await Api.del('/orders/' + order.id);
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function buildOrderCard(order) {
    var card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML =
      '<div class="order-card-head">' +
        '<div class="order-card-head-main">' +
          '<div class="order-title"><span data-title-text></span><span class="order-vat-badge" data-vat-badge hidden>С НДС</span></div>' +
          '<div class="order-meta"></div>' +
        '</div>' +
        '<div class="order-summary-figures">' +
          '<div class="order-figure"><span class="order-figure-label">К оплате</span><span class="order-figure-value big" data-f="totalRevenue">—</span></div>' +
          '<div class="order-figure"><span class="order-figure-label">Прибыль</span><span class="order-figure-value big" data-f="totalProfit">—</span></div>' +
          '<div class="order-figure"><span class="order-figure-label">От смеси</span><span class="order-figure-value" data-f="mixProfit">—</span></div>' +
          '<div class="order-figure"><span class="order-figure-label">От доставки</span><span class="order-figure-value" data-f="deliveryProfit">—</span></div>' +
          '<div class="order-figure"><span class="order-figure-label">Рент-ть</span><span class="order-figure-value" data-f="totalMarginPercent">—</span></div>' +
        '</div>' +
        '<button type="button" class="danger del-btn">Удалить</button>' +
        '<button type="button" class="icon-btn toggle-btn" title="Развернуть">⌄</button>' +
      '</div>' +
      '<div class="order-details" hidden>' +
        '<div class="breakdown compact">' +
          '<div class="line"><span class="l">Материалы</span><span class="v" data-f="materialsCost">—</span></div>' +
          '<div class="line"><span class="l">ФОТ</span><span class="v" data-f="payrollCost">—</span></div>' +
          '<div class="line"><span class="l">Амортизация завода</span><span class="v" data-f="deprCost">—</span></div>' +
          '<div class="line"><span class="l">Коммуналка</span><span class="v" data-f="utilitiesCost">—</span></div>' +
          '<div class="line total"><span class="l">Себестоимость 1 м³</span><span class="v" data-f="costPerM3">—</span></div>' +
        '</div>' +
        '<div class="split-col-label">Расход материалов (на весь заказ)</div>' +
        '<div class="breakdown compact" data-materials-list></div>' +
        '<div class="split-cols">' +
          '<div class="split-col expense">' +
            '<div class="split-col-label">Смесь — расход</div>' +
            '<div class="breakdown compact"><div class="line"><span class="l">Себестоимость смеси</span><span class="v" data-f="mixCost">—</span></div></div>' +
          '</div>' +
          '<div class="split-col income">' +
            '<div class="split-col-label">Смесь — доход</div>' +
            '<div class="breakdown compact">' +
              '<div class="line"><span class="l">Цена</span><span class="v" data-f="salePrice">—</span></div>' +
              '<div class="line"><span class="l">Выручка</span><span class="v" data-f="mixRevenue">—</span></div>' +
              '<div class="line" data-vat-row hidden><span class="l">в т.ч. НДС</span><span class="v" data-f="ndsAmount">—</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="split-total"><span class="l">Прибыль от смеси</span><span class="v-wrap"><span class="v" data-f="mixProfit">—</span><span class="margin" data-f="mixMarginPercent">—</span></span></div>' +
        '<div class="split-cols">' +
          '<div class="split-col expense">' +
            '<div class="split-col-label">Доставка — расход</div>' +
            '<div class="breakdown compact">' +
              '<div class="line"><span class="l">Пробег (1 рейс)</span><span class="v" data-f="roundTripKm">—</span></div>' +
              '<div class="line"><span class="l">Топливо (1 рейс)</span><span class="v" data-f="fuelCostPerTrip">—</span></div>' +
              '<div class="line"><span class="l">Амортизация (1 рейс)</span><span class="v" data-f="amortCostPerTrip">—</span></div>' +
              '<div class="line"><span class="l">Доплата водителю (1 рейс)</span><span class="v" data-f="surchargePerTrip">—</span></div>' +
              '<div class="line"><span class="l">Рейсов</span><span class="v" data-f="tripCount">—</span></div>' +
              '<div class="line total"><span class="l">Итого расход</span><span class="v" data-f="deliveryCostTotal">—</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="split-col income">' +
            '<div class="split-col-label">Доставка — доход</div>' +
            '<div class="breakdown compact"><div class="line"><span class="l">Доход от доставки</span><span class="v" data-f="deliveryRevenue">—</span></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="split-total"><span class="l">Прибыль от доставки</span><span class="v-wrap"><span class="v" data-f="deliveryProfit">—</span><span class="margin" data-f="deliveryMarginPercent">—</span></span></div>' +
        '<div class="final-grid compact">' +
          '<div class="final-result"><span class="label">К оплате</span><span class="value" data-f="totalRevenue">—</span></div>' +
          '<div class="final-result" data-fr="1"><span class="label">Чистая прибыль</span><span class="value" data-f="totalProfit">—</span></div>' +
          '<div class="final-result" data-fr="1"><span class="label">Прибыль на 1 м³</span><span class="value" data-f="profitPerM3">—</span></div>' +
          '<div class="final-result" data-fr="1"><span class="label">Рентабельность</span><span class="value" data-f="totalMarginPercent">—</span></div>' +
        '</div>' +
      '</div>';

    card.querySelector('[data-title-text]').textContent = order.recipeName + ' → ' + order.mixerName;
    if (order.vatApplied) card.querySelector('[data-vat-badge]').hidden = false;
    var metaParts = [
      order.plantName,
      formatDate(order.createdAt),
      Format.fmtNum(order.saleVolume, 1, 'м³'),
      Format.fmtNum(order.distanceKm, 1, 'км')
    ];
    if (order.neighborCity) metaParts.push('рейс в соседний город');
    card.querySelector('.order-meta').textContent = metaParts.join(' · ');

    [
      'materialsCost', 'payrollCost', 'deprCost', 'utilitiesCost', 'costPerM3', 'mixCost', 'salePrice', 'mixRevenue',
      'fuelCostPerTrip', 'amortCostPerTrip', 'surchargePerTrip', 'deliveryCostTotal', 'deliveryRevenue',
      'totalRevenue', 'totalProfit', 'profitPerM3'
    ].forEach(function (key) {
      fillAll(card, key, Format.fmt(order[key] || 0, 2));
    });
    fillAll(card, 'roundTripKm', Format.fmtNum(order.roundTripKm || 0, 0, 'км'));
    fillAll(card, 'tripCount', Format.fmtNum(order.tripCount || 0, 0, 'рейс(ов)'));

    // НДС — только по бетону (mixRevenue), доставка в него не входит и не
    // менялась. mixRevenue всегда хранится без НДС, поэтому сумма налога —
    // 22% от него (эквивалентно 22/122 от выручки с НДС, mixRevenue×1.22).
    if (order.vatApplied) {
      card.querySelector('[data-vat-row]').hidden = false;
      fillAll(card, 'ndsAmount', Format.fmt((order.mixRevenue || 0) * 0.22, 2));
    }

    var materialsListEl = card.querySelector('[data-materials-list]');
    (order.materials || []).forEach(function (m) {
      var line = document.createElement('div');
      line.className = 'line';
      line.innerHTML = '<span class="l"></span><span class="v"></span>';
      line.querySelector('.l').textContent = m.name;
      line.querySelector('.v').textContent = Format.fmtNum(m.qty, 2, m.unit);
      materialsListEl.appendChild(line);
    });

    fillAllSigned(card, 'mixProfit', order.mixProfit || 0);
    fillAllSignedPct(card, 'mixMarginPercent', order.mixMarginPercent || 0);
    fillAllSigned(card, 'deliveryProfit', order.deliveryProfit || 0);
    fillAllSignedPct(card, 'deliveryMarginPercent', order.deliveryMarginPercent || 0);
    fillAllSigned(card, 'totalProfit', order.totalProfit || 0);
    fillAllSignedPct(card, 'totalMarginPercent', order.totalMarginPercent || 0);

    var sign = (order.totalProfit || 0) >= 0 ? 'positive' : 'negative';
    Array.prototype.forEach.call(card.querySelectorAll('[data-fr]'), function (el) { el.classList.add(sign); });

    var head = card.querySelector('.order-card-head');
    var details = card.querySelector('.order-details');
    var toggleBtn = card.querySelector('.toggle-btn');
    head.addEventListener('click', function (e) {
      if (e.target.closest('.del-btn')) return;
      var willOpen = details.hidden;
      details.hidden = !willOpen;
      toggleBtn.classList.toggle('open', willOpen);
      toggleBtn.title = willOpen ? 'Свернуть' : 'Развернуть';
    });
    card.querySelector('.del-btn').addEventListener('click', function () { handleDelete(order); });

    return card;
  }

  function renderPlantFilter() {
    var select = document.getElementById('orders-plant-filter');
    var showFilter = window.Auth && Auth.isAtLeast('manager') && State.data.plants.length > 1;
    select.hidden = !showFilter;
    if (!showFilter) return;

    var prev = plantFilterValue;
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
    var valid = State.data.plants.some(function (p) { return p.id === prev; });
    select.value = valid ? prev : '';
    plantFilterValue = select.value;
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { var x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

  function periodBounds() {
    var now = new Date();
    if (periodFilterValue === 'today') return { from: startOfDay(now), to: endOfDay(now) };
    if (periodFilterValue === '7d') { var f = new Date(now); f.setDate(f.getDate() - 6); return { from: startOfDay(f), to: endOfDay(now) }; }
    if (periodFilterValue === '30d') { var f2 = new Date(now); f2.setDate(f2.getDate() - 29); return { from: startOfDay(f2), to: endOfDay(now) }; }
    if (periodFilterValue === 'month') { var f3 = new Date(now.getFullYear(), now.getMonth(), 1); return { from: f3, to: endOfDay(now) }; }
    if (periodFilterValue === 'custom') {
      return {
        from: customFrom ? startOfDay(new Date(customFrom)) : null,
        to: customTo ? endOfDay(new Date(customTo)) : null
      };
    }
    return { from: null, to: null };
  }

  // Работнику бэкенд и так отдаёт только заказы за сегодня (см. backend/
  // handlers/orders.js), независимо от фильтра — показывать сам селектор
  // периода ему смысла нет, он бы вводил в заблуждение (любой выбор давал
  // бы один и тот же результат).
  function renderPeriodFilter() {
    var isInternal = !!(window.Auth && Auth.getRole());
    var periodSelect = document.getElementById('orders-period-filter');
    periodSelect.hidden = !isInternal;
    if (!isInternal) {
      document.getElementById('orders-custom-range').hidden = true;
      return;
    }
    document.getElementById('orders-custom-range').hidden = periodFilterValue !== 'custom';
  }

  function filteredOrders() {
    var orders = State.data.orders || [];
    if (plantFilterValue) {
      orders = orders.filter(function (o) { return o.plantId === plantFilterValue; });
    }
    var bounds = periodBounds();
    if (bounds.from) orders = orders.filter(function (o) { return new Date(o.createdAt) >= bounds.from; });
    if (bounds.to) orders = orders.filter(function (o) { return new Date(o.createdAt) <= bounds.to; });
    return orders;
  }

  function renderMaterialsSummary(orders) {
    var container = document.getElementById('orders-materials-summary');
    var emptyHint = document.getElementById('orders-materials-empty-hint');
    container.innerHTML = '';

    // Группируем по заводу — при фильтре "Все заводы" разные заводы могут
    // использовать материал с одинаковым названием (например, свой "Цемент"
    // у каждого), и схлопывать их расход в одну сумму было бы неверно: это
    // разные закупки/остатки, которыми управляют по отдельности.
    var plantOrder = [];
    var byPlant = {}; // plantId -> { name, totals: {"name|unit": qty} }
    orders.forEach(function (o) {
      var pid = o.plantId || '';
      if (!byPlant[pid]) {
        byPlant[pid] = { name: o.plantName || 'Без завода', totals: {} };
        plantOrder.push(pid);
      }
      (o.materials || []).forEach(function (m) {
        var key = m.name + '|' + m.unit;
        byPlant[pid].totals[key] = (byPlant[pid].totals[key] || 0) + m.qty;
      });
    });

    plantOrder.sort(function (a, b) { return byPlant[a].name.localeCompare(byPlant[b].name, 'ru'); });
    emptyHint.hidden = plantOrder.length > 0;

    var showHeaders = plantOrder.length > 1;
    plantOrder.forEach(function (pid) {
      var group = byPlant[pid];
      if (showHeaders) {
        var header = document.createElement('div');
        header.className = 'split-col-label';
        header.textContent = group.name;
        container.appendChild(header);
      }
      Object.keys(group.totals).sort().forEach(function (key) {
        var parts = key.split('|');
        var line = document.createElement('div');
        line.className = 'line';
        line.innerHTML = '<span class="l"></span><span class="v"></span>';
        line.querySelector('.l').textContent = parts[0];
        line.querySelector('.v').textContent = Format.fmtNum(group.totals[key], 2, parts[1]);
        container.appendChild(line);
      });
    });
  }

  function render() {
    renderPlantFilter();
    renderPeriodFilter();
    var container = document.getElementById('orders-list');
    var emptyHint = document.getElementById('orders-empty-hint');
    var exportBtn = document.getElementById('export-orders-btn');
    var orders = filteredOrders();
    container.innerHTML = '';
    emptyHint.hidden = orders.length > 0;
    exportBtn.hidden = !(window.Auth && Auth.getRole());
    exportBtn.disabled = orders.length === 0;
    orders.forEach(function (order) {
      container.appendChild(buildOrderCard(order));
    });
    renderMaterialsSummary(orders);
  }

  // ---- Экспорт в Excel (CSV с BOM и ; — открывается в Excel с русской локалью без перекодировки) ----
  function csvEscape(value) {
    var str = String(value);
    if (/[";\n]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function csvNum(n) {
    var rounded = Math.round((n || 0) * 100) / 100;
    return rounded.toString().replace('.', ',');
  }

  function exportToExcel() {
    var orders = filteredOrders();
    if (!orders.length) return;

    var headers = [
      'Завод', 'Дата', 'Марка', 'Миксер', 'Объём (м³)', 'Расстояние (км)', 'Рейс в другой город',
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
      // НДС в заказе — не всегда: тумблер "Цены с НДС" на Главной определяет
      // сделку целиком (см. o.vatApplied). Извлекаем 22/122 из totalRevenue
      // только когда сделка реально была с НДС — иначе там просто чистая
      // выручка без наценки налога, извлекать из неё нечего.
      var ndsAmount = o.vatApplied ? (o.totalRevenue || 0) * 22 / 122 : 0;
      return [
        o.plantName, formatDate(o.createdAt), o.recipeName, o.mixerName, csvNum(o.saleVolume), csvNum(o.distanceKm), o.neighborCity ? 'да' : 'нет',
        csvNum(o.materialsCost), csvNum(o.payrollCost), csvNum(o.deprCost), csvNum(o.utilitiesCost), csvNum(o.costPerM3),
        csvNum(o.mixCost), csvNum(o.salePrice), csvNum(o.mixRevenue), csvNum(o.mixProfit), csvNum(o.mixMarginPercent),
        csvNum(o.roundTripKm), csvNum(o.fuelCostPerTrip), csvNum(o.amortCostPerTrip), csvNum(o.surchargePerTrip), csvNum(o.tripCount),
        csvNum(o.deliveryCostTotal), csvNum(o.deliveryRevenue), csvNum(o.deliveryProfit), csvNum(o.deliveryMarginPercent),
        csvNum(o.totalRevenue), o.vatApplied ? 'да' : 'нет', csvNum(ndsAmount), csvNum(o.totalProfit), csvNum(o.profitPerM3), csvNum(o.totalMarginPercent), materialsText
      ];
    });

    var lines = [headers].concat(rows).map(function (row) {
      return row.map(csvEscape).join(';');
    });
    var csvContent = '\uFEFF' + lines.join('\r\n');

    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'zakazy-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function init() {
    document.getElementById('export-orders-btn').addEventListener('click', exportToExcel);
    document.getElementById('orders-plant-filter').addEventListener('change', function () {
      plantFilterValue = this.value;
      render();
    });
    document.getElementById('orders-period-filter').addEventListener('change', function () {
      periodFilterValue = this.value;
      render();
    });
    document.getElementById('orders-date-from').addEventListener('change', function () {
      customFrom = this.value;
      render();
    });
    document.getElementById('orders-date-to').addEventListener('change', function () {
      customTo = this.value;
      render();
    });
  }

  window.OrdersTab = { init: init, render: render };
})();
