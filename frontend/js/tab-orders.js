(function () {
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
          '<div class="order-title"></div>' +
          '<div class="order-meta"></div>' +
        '</div>' +
        '<div class="order-summary-figures">' +
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
        '<div class="final-grid compact three">' +
          '<div class="final-result" data-fr="1"><span class="label">Чистая прибыль</span><span class="value" data-f="totalProfit">—</span></div>' +
          '<div class="final-result" data-fr="1"><span class="label">Прибыль на 1 м³</span><span class="value" data-f="profitPerM3">—</span></div>' +
          '<div class="final-result" data-fr="1"><span class="label">Рентабельность</span><span class="value" data-f="totalMarginPercent">—</span></div>' +
        '</div>' +
      '</div>';

    card.querySelector('.order-title').textContent = order.recipeName + ' → ' + order.mixerName;
    var metaParts = [
      formatDate(order.createdAt),
      Format.fmtNum(order.saleVolume, 1, 'м³'),
      Format.fmtNum(order.distanceKm, 1, 'км')
    ];
    if (order.neighborCity) metaParts.push('рейс в соседний город');
    card.querySelector('.order-meta').textContent = metaParts.join(' · ');

    [
      'materialsCost', 'payrollCost', 'deprCost', 'utilitiesCost', 'costPerM3', 'mixCost', 'salePrice', 'mixRevenue',
      'fuelCostPerTrip', 'amortCostPerTrip', 'surchargePerTrip', 'deliveryCostTotal', 'deliveryRevenue',
      'totalProfit', 'profitPerM3'
    ].forEach(function (key) {
      fillAll(card, key, Format.fmt(order[key] || 0, 2));
    });
    fillAll(card, 'roundTripKm', Format.fmtNum(order.roundTripKm || 0, 0, 'км'));
    fillAll(card, 'tripCount', Format.fmtNum(order.tripCount || 0, 0, 'рейс(ов)'));

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

  function render() {
    var container = document.getElementById('orders-list');
    var emptyHint = document.getElementById('orders-empty-hint');
    var exportBtn = document.getElementById('export-orders-btn');
    var orders = State.data.orders || [];
    container.innerHTML = '';
    emptyHint.hidden = orders.length > 0;
    exportBtn.disabled = orders.length === 0;
    orders.forEach(function (order) {
      container.appendChild(buildOrderCard(order));
    });
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
    var orders = State.data.orders || [];
    if (!orders.length) return;

    var headers = [
      'Дата', 'Марка', 'Миксер', 'Объём (м³)', 'Расстояние (км)', 'Рейс в другой город',
      'Материалы (₽/м³)', 'ФОТ (₽/м³)', 'Амортизация завода (₽/м³)', 'Коммуналка (₽/м³)', 'Себестоимость 1м³ (₽)',
      'Себестоимость смеси (₽)', 'Цена (₽/м³)', 'Выручка со смеси (₽)', 'Прибыль от смеси (₽)', 'Рентабельность смеси (%)',
      'Пробег за рейс (км)', 'Топливо за рейс (₽)', 'Амортизация техники за рейс (₽)', 'Доплата водителю (₽)', 'Рейсов',
      'Расход на доставку (₽)', 'Доход от доставки (₽)', 'Прибыль от доставки (₽)', 'Рентабельность доставки (%)',
      'Выручка всего (₽)', 'Чистая прибыль (₽)', 'Прибыль на 1м³ (₽)', 'Рентабельность сделки (%)'
    ];

    var rows = orders.map(function (o) {
      return [
        formatDate(o.createdAt), o.recipeName, o.mixerName, csvNum(o.saleVolume), csvNum(o.distanceKm), o.neighborCity ? 'да' : 'нет',
        csvNum(o.materialsCost), csvNum(o.payrollCost), csvNum(o.deprCost), csvNum(o.utilitiesCost), csvNum(o.costPerM3),
        csvNum(o.mixCost), csvNum(o.salePrice), csvNum(o.mixRevenue), csvNum(o.mixProfit), csvNum(o.mixMarginPercent),
        csvNum(o.roundTripKm), csvNum(o.fuelCostPerTrip), csvNum(o.amortCostPerTrip), csvNum(o.surchargePerTrip), csvNum(o.tripCount),
        csvNum(o.deliveryCostTotal), csvNum(o.deliveryRevenue), csvNum(o.deliveryProfit), csvNum(o.deliveryMarginPercent),
        csvNum(o.totalRevenue), csvNum(o.totalProfit), csvNum(o.profitPerM3), csvNum(o.totalMarginPercent)
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
  }

  window.OrdersTab = { init: init, render: render };
})();
