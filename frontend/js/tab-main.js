(function () {
  var selectedRecipeId = '';
  var selectedMixerId = '';
  var inputIds = ['dist', 'delivery-charge', 'sale-volume'];
  var mixTestPriceDirty = false;
  var lastCalc = null;

  var outputIds = [
    'cost-materials', 'cost-payroll', 'cost-depr', 'cost-utilities', 'cost-per-m3',
    'recipe-sale-price-display', 'mix-revenue', 'mix-cost', 'mix-profit', 'mix-margin',
    'mix-breakeven-price', 'mix-safety-margin', 'mix-safety-margin-pct',
    'round-trip', 'fuel-cost', 'amort-cost', 'surcharge-cost', 'trip-count', 'delivery-cost-total',
    'delivery-revenue', 'delivery-profit', 'delivery-margin',
    'profit-total', 'profit-per-m3', 'margin-total'
  ];

  function populateSelect(select, items, preferredId) {
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— выберите —';
    select.appendChild(placeholder);
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      select.appendChild(opt);
    });
    var validId = items.some(function (i) { return i.id === preferredId; }) ? preferredId : '';
    select.value = validId;
    return validId;
  }

  function setProfitLine(valueEl, amount) {
    valueEl.textContent = Format.fmt(amount, 2);
    valueEl.classList.remove('positive', 'negative');
    valueEl.classList.add(amount >= 0 ? 'positive' : 'negative');
  }

  function setMarginBadge(el, percent) {
    el.textContent = Format.fmtNum(percent, 1, '%');
    el.classList.remove('positive', 'negative');
    el.classList.add(percent >= 0 ? 'positive' : 'negative');
  }

  function resetOutputsToDash() {
    outputIds.forEach(function (id) {
      var el = document.getElementById(id);
      el.textContent = '—';
      el.classList.remove('positive', 'negative');
    });
    ['profit-total-wrap', 'profit-per-m3-wrap', 'margin-total-wrap'].forEach(function (id) {
      document.getElementById(id).classList.remove('positive', 'negative');
    });
    document.getElementById('cost-materials-label').textContent = 'Материалы';
  }

  function recalc() {
    var data = State.data;
    var recipeSelect = document.getElementById('main-recipe');
    var mixerSelect = document.getElementById('main-mixer');
    var distInput = document.getElementById('dist');
    var errorEl = document.getElementById('main-validation-error');
    var placeOrderBtn = document.getElementById('place-order-btn');

    selectedRecipeId = populateSelect(recipeSelect, data.recipes, selectedRecipeId || recipeSelect.value);
    selectedMixerId = populateSelect(mixerSelect, data.mixers, selectedMixerId || mixerSelect.value);

    var recipe = data.recipes.find(function (r) { return r.id === selectedRecipeId; });
    var mixer = data.mixers.find(function (m) { return m.id === selectedMixerId; });

    var distField = distInput.closest('.field');
    var distRaw = distInput.value;
    var dist = parseFloat(distRaw) || 0;
    var distMissing = distRaw.trim() === '' || !(dist > 0);

    // Цена топлива — единый источник (Техника → Общие настройки), на Главной только отображается.
    var fuelPrice = data.config.fuelPriceDefault || 0;
    document.getElementById('fuel-price').value = fuelPrice;

    var neighborCitySurcharge = data.config.neighborCitySurcharge || 0;
    document.getElementById('nb-city-badge').textContent = '+' + Format.fmt(neighborCitySurcharge, 0) + '/рейс';

    [recipeSelect, mixerSelect, distField].forEach(function (el) { el.classList.remove('invalid'); });
    var missing = [];
    if (!recipe) missing.push(recipeSelect);
    if (!mixer) missing.push(mixerSelect);
    if (distMissing) missing.push(distField);

    if (missing.length) {
      missing.forEach(function (el) { el.classList.add('invalid'); });
      errorEl.textContent = 'Заполните обязательные поля: марка/рецепт, миксер и расстояние — они выделены красным.';
      errorEl.hidden = false;
      placeOrderBtn.disabled = true;
      lastCalc = null;
      resetOutputsToDash();
      return;
    }
    errorEl.hidden = true;

    var materialsCost = Calc.materialsCostPerM3(recipe, data.materials, data.aggregateTrucks);
    var payroll = Calc.payrollPerM3(data);
    var depr = Calc.plantDeprPerM3(data.config);
    var utilities = Calc.utilitiesPerM3(data.config);
    var costPerM3 = materialsCost + payroll + depr + utilities;

    document.getElementById('cost-materials-label').textContent = 'Материалы (' + recipe.name + ')';
    document.getElementById('cost-materials').textContent = Format.fmt(materialsCost, 2);
    document.getElementById('cost-payroll').textContent = Format.fmt(payroll, 2);
    document.getElementById('cost-depr').textContent = Format.fmt(depr, 2);
    document.getElementById('cost-utilities').textContent = Format.fmt(utilities, 2);
    document.getElementById('cost-per-m3').textContent = Format.fmt(costPerM3, 2);

    var saleVolume = parseFloat(document.getElementById('sale-volume').value) || 0;
    var salePrice = recipe.salePrice || 0;
    document.getElementById('recipe-sale-price-display').textContent = Format.fmt(salePrice, 2);

    var testPriceInput = document.getElementById('mix-test-price');
    if (!mixTestPriceDirty) {
      NumericInput.setFormattedValue(testPriceInput, salePrice);
    }
    var testPrice = NumericInput.parseNumber(testPriceInput.value) || 0;

    var mixRevenue = testPrice * saleVolume;
    var mixCost = costPerM3 * saleVolume;
    var mixProfit = mixRevenue - mixCost;
    document.getElementById('mix-revenue').textContent = Format.fmt(mixRevenue, 2);
    document.getElementById('mix-cost').textContent = Format.fmt(mixCost, 2);
    setProfitLine(document.getElementById('mix-profit'), mixProfit);
    var mixMarginPercent = Calc.marginPercent(mixProfit, mixRevenue);
    setMarginBadge(document.getElementById('mix-margin'), mixMarginPercent);

    var safetyMargin = testPrice - costPerM3;
    document.getElementById('mix-breakeven-price').textContent = Format.fmt(costPerM3, 2);
    setProfitLine(document.getElementById('mix-safety-margin'), safetyMargin);
    setMarginBadge(document.getElementById('mix-safety-margin-pct'), testPrice > 0 ? (safetyMargin / testPrice) * 100 : 0);

    var trips = Calc.tripsForVolume(mixer, saleVolume);
    var roundTrip = dist * 2;
    var fuelRate = mixer.fuelRate;
    var amortPerKm = Calc.amortPerKm(mixer);
    var fuelCostPerTrip = roundTrip * (fuelRate / 100) * fuelPrice;
    var amortCostPerTrip = roundTrip * amortPerKm;
    var neighborCity = document.getElementById('nb-city').checked;
    var surchargePerTrip = neighborCity ? neighborCitySurcharge : 0;
    var deliveryCostTotal = (fuelCostPerTrip + amortCostPerTrip + surchargePerTrip) * trips;

    document.getElementById('round-trip').textContent = Format.fmtNum(roundTrip, 0, 'км');
    document.getElementById('fuel-cost').textContent = Format.fmt(fuelCostPerTrip, 2);
    document.getElementById('amort-cost').textContent = Format.fmt(amortCostPerTrip, 2);
    document.getElementById('surcharge-cost').textContent = Format.fmt(surchargePerTrip, 2);
    document.getElementById('trip-count').textContent = Format.fmtNum(trips, 0, 'рейс(ов)');
    document.getElementById('delivery-cost-total').textContent = Format.fmt(deliveryCostTotal, 2);

    var deliveryChargePerM3 = NumericInput.parseNumber(document.getElementById('delivery-charge').value) || 0;
    var deliveryRevenue = deliveryChargePerM3 * saleVolume;
    var deliveryProfit = deliveryRevenue - deliveryCostTotal;
    var deliveryMarginPercent = Calc.marginPercent(deliveryProfit, deliveryRevenue);
    document.getElementById('delivery-revenue').textContent = Format.fmt(deliveryRevenue, 2);
    setProfitLine(document.getElementById('delivery-profit'), deliveryProfit);
    setMarginBadge(document.getElementById('delivery-margin'), deliveryMarginPercent);

    var totalRevenue = mixRevenue + deliveryRevenue;
    var totalProfit = mixProfit + deliveryProfit;
    var profitPerM3Total = saleVolume > 0 ? totalProfit / saleVolume : 0;
    var marginTotal = Calc.marginPercent(totalProfit, totalRevenue);

    var profitTotalEl = document.getElementById('profit-total');
    var profitTotalWrap = document.getElementById('profit-total-wrap');
    var profitPerM3El = document.getElementById('profit-per-m3');
    var profitPerM3Wrap = document.getElementById('profit-per-m3-wrap');
    var marginTotalEl = document.getElementById('margin-total');
    var marginTotalWrap = document.getElementById('margin-total-wrap');

    profitTotalEl.textContent = Format.fmt(totalProfit, 2);
    profitPerM3El.textContent = Format.fmt(profitPerM3Total, 2);
    marginTotalEl.textContent = Format.fmtNum(marginTotal, 1, '%');

    profitTotalWrap.classList.remove('positive', 'negative');
    profitTotalWrap.classList.add(totalProfit >= 0 ? 'positive' : 'negative');
    profitPerM3Wrap.classList.remove('positive', 'negative');
    profitPerM3Wrap.classList.add(profitPerM3Total >= 0 ? 'positive' : 'negative');
    marginTotalWrap.classList.remove('positive', 'negative');
    marginTotalWrap.classList.add(marginTotal >= 0 ? 'positive' : 'negative');

    placeOrderBtn.disabled = false;
    lastCalc = {
      recipeName: recipe.name,
      mixerName: mixer.name,
      saleVolume: saleVolume,
      distanceKm: dist,
      fuelPricePerLiter: fuelPrice,
      neighborCity: neighborCity,
      surchargePerTrip: surchargePerTrip,
      tripCount: trips,
      roundTripKm: roundTrip,
      fuelCostPerTrip: fuelCostPerTrip,
      amortCostPerTrip: amortCostPerTrip,
      deliveryCostTotal: deliveryCostTotal,
      deliveryChargePerM3: deliveryChargePerM3,
      deliveryRevenue: deliveryRevenue,
      deliveryProfit: deliveryProfit,
      deliveryMarginPercent: deliveryMarginPercent,
      materialsCost: materialsCost,
      payrollCost: payroll,
      deprCost: depr,
      utilitiesCost: utilities,
      costPerM3: costPerM3,
      salePrice: testPrice,
      mixRevenue: mixRevenue,
      mixCost: mixCost,
      mixProfit: mixProfit,
      mixMarginPercent: mixMarginPercent,
      totalRevenue: totalRevenue,
      totalProfit: totalProfit,
      profitPerM3: profitPerM3Total,
      totalMarginPercent: marginTotal
    };
  }

  async function handlePlaceOrder() {
    if (!lastCalc) return;
    var placeOrderBtn = document.getElementById('place-order-btn');
    var hintEl = document.getElementById('order-placed-hint');
    placeOrderBtn.disabled = true;
    try {
      var payload = Object.assign({}, lastCalc, { createdAt: new Date().toISOString() });
      await Api.post('/orders', payload);
      await State.loadAll();
      hintEl.hidden = false;
      setTimeout(function () { hintEl.hidden = true; }, 4000);
    } catch (err) {
      alert('Не удалось оформить заказ: ' + err.message);
    } finally {
      placeOrderBtn.disabled = !lastCalc;
    }
  }

  function init() {
    NumericInput.attach(document.getElementById('delivery-charge'));
    inputIds.forEach(function (id) {
      document.getElementById(id).addEventListener('input', recalc);
    });
    document.getElementById('nb-city').addEventListener('change', recalc);

    NumericInput.attach(document.getElementById('mix-test-price'));
    document.getElementById('mix-test-price').addEventListener('input', function () {
      mixTestPriceDirty = true;
      recalc();
    });
    document.getElementById('mix-test-price-reset').addEventListener('click', function () {
      mixTestPriceDirty = false;
      recalc();
    });

    document.getElementById('main-recipe').addEventListener('change', function () {
      selectedRecipeId = this.value;
      mixTestPriceDirty = false;
      recalc();
    });
    document.getElementById('main-mixer').addEventListener('change', function () {
      selectedMixerId = this.value;
      recalc();
    });

    document.getElementById('place-order-btn').addEventListener('click', handlePlaceOrder);
  }

  window.MainTab = { init: init, render: recalc };
})();
