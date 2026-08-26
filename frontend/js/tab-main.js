(function () {
  var selectedRecipeId = '';
  var selectedMixerId = '';
  var inputIds = ['dist', 'delivery-charge', 'sale-volume'];
  var mixTestPriceDirty = false;
  var fuelPriceDirty = false;
  var submitAttempted = false;
  var lastCalc = null;

  var mixOutputIds = [
    'cost-materials', 'cost-payroll', 'cost-depr', 'cost-utilities', 'cost-per-m3',
    'recipe-sale-price-display', 'mix-revenue', 'mix-cost', 'mix-profit', 'mix-margin',
    'mix-breakeven-price', 'mix-safety-margin', 'mix-safety-margin-pct'
  ];
  var deliveryOutputIds = [
    'round-trip', 'fuel-cost', 'amort-cost', 'surcharge-cost', 'trip-count', 'delivery-cost-total',
    'delivery-revenue', 'delivery-profit', 'delivery-margin'
  ];
  var totalOutputIds = ['revenue-total', 'profit-total', 'profit-per-m3', 'margin-total'];

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

  function dashOut(ids) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      el.textContent = '—';
      el.classList.remove('positive', 'negative');
    });
  }

  function resetOutputsToDash() {
    dashOut(mixOutputIds);
    dashOut(deliveryOutputIds);
    dashOut(totalOutputIds);
    ['profit-total-wrap', 'profit-per-m3-wrap', 'margin-total-wrap'].forEach(function (id) {
      document.getElementById(id).classList.remove('positive', 'negative');
    });
    document.getElementById('cost-materials-label').textContent = 'Материалы';
  }

  function recalc() {
    var data = State.data;
    var plant = State.currentPlant();
    document.getElementById('main-plant-badge').textContent = plant ? plant.name : '';
    var recipeSelect = document.getElementById('main-recipe');
    var mixerSelect = document.getElementById('main-mixer');
    var distInput = document.getElementById('dist');
    var errorEl = document.getElementById('main-validation-error');
    var placeOrderBtn = document.getElementById('place-order-btn');
    var nbCityInput = document.getElementById('nb-city');
    var deliveryChargeInput = document.getElementById('delivery-charge');
    var deliverySection = document.getElementById('delivery-section');

    // Самовывоз — клиент забирает сам, миксер/расстояние/доставка не участвуют
    // в расчёте: соответствующие поля блокируются, а не просто игнорируются,
    // чтобы не создавать впечатление, что они всё ещё на что-то влияют.
    var selfPickup = document.getElementById('self-pickup').checked;
    mixerSelect.disabled = selfPickup;
    distInput.disabled = selfPickup;
    nbCityInput.disabled = selfPickup;
    deliveryChargeInput.disabled = selfPickup;
    document.getElementById('fuel-price').disabled = selfPickup;
    document.getElementById('fuel-price-reset').disabled = selfPickup;
    deliverySection.hidden = selfPickup;

    selectedRecipeId = populateSelect(recipeSelect, data.recipes, selectedRecipeId || recipeSelect.value);
    selectedMixerId = populateSelect(mixerSelect, data.mixers, selectedMixerId || mixerSelect.value);

    var recipe = data.recipes.find(function (r) { return r.id === selectedRecipeId; });
    var mixer = data.mixers.find(function (m) { return m.id === selectedMixerId; });

    var distField = distInput.closest('.field');
    var distRaw = distInput.value;
    var dist = parseFloat(distRaw) || 0;
    var distMissing = !selfPickup && (distRaw.trim() === '' || !(dist > 0));

    // Цена топлива — предустановка из Техника → Общие настройки, но на Главной
    // её можно переопределить под конкретный заказ (как с ценой смеси).
    var fuelPriceInput = document.getElementById('fuel-price');
    var configFuelPrice = data.config.fuelPriceDefault || 0;
    if (!fuelPriceDirty) {
      NumericInput.setFormattedValue(fuelPriceInput, configFuelPrice);
    }
    var fuelPrice = NumericInput.parseNumber(fuelPriceInput.value) || 0;

    var neighborCitySurcharge = data.config.neighborCitySurcharge || 0;
    document.getElementById('nb-city-badge').textContent = '+' + Format.fmt(neighborCitySurcharge, 0) + '/рейс';

    // Марка/рецепт нужна для любого расчёта. Миксер/расстояние нужны только
    // для доставки — без них уже можно посмотреть себестоимость и прибыль по
    // смеси (быстрая проверка цены без лишних кликов).
    var missingDelivery = [];
    if (!selfPickup && !mixer) missingDelivery.push(mixerSelect);
    if (distMissing) missingDelivery.push(distField);
    var missing = recipe ? missingDelivery : [recipeSelect].concat(missingDelivery);

    // Баннер и красная обводка — только после попытки оформить заказ с
    // незаполненными полями, а не сразу при открытии формы: иначе баннер
    // занимает место и вёрстка прыгает при каждом вводе.
    [recipeSelect, mixerSelect, distField].forEach(function (el) { el.classList.remove('invalid'); });
    if (submitAttempted && missing.length) {
      missing.forEach(function (el) { el.classList.add('invalid'); });
      errorEl.textContent = selfPickup
        ? 'Заполните обязательное поле: марка/рецепт — оно выделено красным.'
        : 'Заполните обязательные поля: марка/рецепт, миксер и расстояние — они выделены красным.';
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }

    if (!recipe) {
      placeOrderBtn.classList.add('not-ready');
      lastCalc = null;
      resetOutputsToDash();
      return;
    }

    var materialsCost = Calc.materialsCostPerM3(recipe, data.materials, data.aggregateTrucks);
    var payroll = Calc.payrollPerM3(plant, data.plants, data.personnelSummary);
    var depr = Calc.plantDeprPerM3(plant);
    var utilities = Calc.utilitiesPerM3(plant);
    var costPerM3 = materialsCost + payroll + depr + utilities;

    document.getElementById('cost-materials-label').textContent = 'Материалы (' + recipe.name + ')';
    document.getElementById('cost-materials').textContent = Format.fmt(materialsCost, 2);
    document.getElementById('cost-payroll').textContent = Format.fmt(payroll, 2);
    document.getElementById('cost-depr').textContent = Format.fmt(depr, 2);
    document.getElementById('cost-utilities').textContent = Format.fmt(utilities, 2);
    document.getElementById('cost-per-m3').textContent = Format.fmt(costPerM3, 2);

    var saleVolume = parseFloat(document.getElementById('sale-volume').value) || 0;

    // Расход материалов на заказ (для истории/учёта инертов) — снимок:
    // название/ед. на момент заказа, не ссылка на mat_id.
    var materialsById = {};
    data.materials.forEach(function (m) { materialsById[m.id] = m; });
    var materialsBreakdown = recipe.items.map(function (item) {
      var mat = materialsById[item.materialId];
      return {
        name: mat ? mat.name : 'Неизвестный материал',
        unit: mat ? mat.unit : '',
        qty: item.qty * saleVolume
      };
    });

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

    var deliveryReady = selfPickup || (!!mixer && !distMissing);
    var trips = 0, roundTrip = 0, fuelCostPerTrip = 0, amortCostPerTrip = 0, neighborCity = false,
      surchargePerTrip = 0, deliveryCostTotal = 0, deliveryChargePerM3 = 0, deliveryRevenue = 0,
      deliveryProfit = 0, deliveryMarginPercent = 0;

    if (deliveryReady && !selfPickup) {
      trips = Calc.tripsForVolume(mixer, saleVolume);
      roundTrip = dist * 2;
      var fuelRate = mixer.fuelRate;
      var amortPerKm = Calc.amortPerKm(mixer);
      fuelCostPerTrip = roundTrip * (fuelRate / 100) * fuelPrice;
      amortCostPerTrip = roundTrip * amortPerKm;
      neighborCity = nbCityInput.checked;
      surchargePerTrip = neighborCity ? neighborCitySurcharge : 0;
      deliveryCostTotal = (fuelCostPerTrip + amortCostPerTrip + surchargePerTrip) * trips;

      document.getElementById('round-trip').textContent = Format.fmtNum(roundTrip, 0, 'км');
      document.getElementById('fuel-cost').textContent = Format.fmt(fuelCostPerTrip, 2);
      document.getElementById('amort-cost').textContent = Format.fmt(amortCostPerTrip, 2);
      document.getElementById('surcharge-cost').textContent = Format.fmt(surchargePerTrip, 2);
      document.getElementById('trip-count').textContent = Format.fmtNum(trips, 0, 'рейс(ов)');
      document.getElementById('delivery-cost-total').textContent = Format.fmt(deliveryCostTotal, 2);

      deliveryChargePerM3 = NumericInput.parseNumber(deliveryChargeInput.value) || 0;
      deliveryRevenue = deliveryChargePerM3 * saleVolume;
      deliveryProfit = deliveryRevenue - deliveryCostTotal;
      deliveryMarginPercent = Calc.marginPercent(deliveryProfit, deliveryRevenue);
      document.getElementById('delivery-revenue').textContent = Format.fmt(deliveryRevenue, 2);
      setProfitLine(document.getElementById('delivery-profit'), deliveryProfit);
      setMarginBadge(document.getElementById('delivery-margin'), deliveryMarginPercent);
    } else if (!selfPickup) {
      // Миксер/расстояние ещё не заполнены — доставку показывать нечего,
      // но по смеси (выше) уже можно смотреть цифры для быстрой прикидки.
      dashOut(deliveryOutputIds);
    }

    var totalRevenue = mixRevenue + deliveryRevenue;
    var totalProfit = mixProfit + deliveryProfit;
    var profitPerM3Total = saleVolume > 0 ? totalProfit / saleVolume : 0;
    var marginTotal = Calc.marginPercent(totalProfit, totalRevenue);

    document.getElementById('revenue-total').textContent = Format.fmt(totalRevenue, 2);

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

    if (!deliveryReady) {
      placeOrderBtn.classList.add('not-ready');
      lastCalc = null;
      return;
    }

    placeOrderBtn.classList.remove('not-ready');
    lastCalc = {
      plantId: plant.id,
      plantName: plant.name,
      recipeName: recipe.name,
      materials: materialsBreakdown,
      mixerName: selfPickup ? 'Самовывоз' : mixer.name,
      saleVolume: saleVolume,
      distanceKm: selfPickup ? 0 : dist,
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

  // Марку/миксер оставляем выбранными (обычно следующий заказ — та же смесь),
  // а расстояние/объём/доплату за рейс/цену-испытание/чекбокс соседнего города
  // очищаем — это разовые параметры конкретного заказа.
  function resetOrderForm() {
    inputIds.forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('nb-city').checked = false;
    document.getElementById('self-pickup').checked = false;
    document.getElementById('mix-test-price').value = '';
    mixTestPriceDirty = false;
    document.getElementById('fuel-price').value = '';
    fuelPriceDirty = false;
    submitAttempted = false;
  }

  async function handlePlaceOrder() {
    if (!lastCalc) {
      submitAttempted = true;
      recalc();
      return;
    }
    var placeOrderBtn = document.getElementById('place-order-btn');
    var hintEl = document.getElementById('order-placed-hint');
    placeOrderBtn.disabled = true;
    try {
      var payload = Object.assign({}, lastCalc, { createdAt: new Date().toISOString() });
      await Api.post('/orders', payload);
      await State.loadAll();
      resetOrderForm();
      recalc();
      hintEl.hidden = false;
      setTimeout(function () { hintEl.hidden = true; }, 4000);
    } catch (err) {
      alert('Не удалось оформить заказ: ' + err.message);
    } finally {
      placeOrderBtn.disabled = false;
    }
  }

  function init() {
    // Работник (без роли, по ссылке-токену) не должен видеть, сколько внутри
    // сделки уходит на материалы/ФОТ/амортизацию — только видит, в плюсе
    // сделка или в минусе (строка "Прибыль от смеси" ниже остаётся видна
    // всем). Роль не меняется без перезагрузки страницы (см. auth.js), так
    // что достаточно решить один раз при инициализации, а не на каждый recalc().
    var isInternal = !!(window.Auth && Auth.getRole());
    document.getElementById('mix-cost-breakdown').hidden = !isInternal;
    document.getElementById('mix-breakeven').hidden = !isInternal;
    document.getElementById('mix-split-cols').classList.toggle('single-col', !isInternal);

    NumericInput.attach(document.getElementById('delivery-charge'));
    inputIds.forEach(function (id) {
      document.getElementById(id).addEventListener('input', recalc);
    });
    document.getElementById('nb-city').addEventListener('change', recalc);
    document.getElementById('self-pickup').addEventListener('change', recalc);

    NumericInput.attach(document.getElementById('mix-test-price'));
    document.getElementById('mix-test-price').addEventListener('input', function () {
      mixTestPriceDirty = true;
      recalc();
    });
    document.getElementById('mix-test-price-reset').addEventListener('click', function () {
      mixTestPriceDirty = false;
      recalc();
    });

    NumericInput.attach(document.getElementById('fuel-price'));
    document.getElementById('fuel-price').addEventListener('input', function () {
      fuelPriceDirty = true;
      recalc();
    });
    document.getElementById('fuel-price-reset').addEventListener('click', function () {
      fuelPriceDirty = false;
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
