(function () {
  var selectedRecipeId = null;
  var selectedMixerId = null;
  var inputIds = ['dist', 'fuel-price', 'sale-price', 'sale-volume'];

  function populateSelect(select, items, preferredId) {
    select.innerHTML = '';
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      select.appendChild(opt);
    });
    var validId = items.some(function (i) { return i.id === preferredId; }) ? preferredId : (items[0] && items[0].id) || '';
    select.value = validId;
    return validId;
  }

  function recalc() {
    var data = State.data;
    var recipeSelect = document.getElementById('main-recipe');
    var mixerSelect = document.getElementById('main-mixer');

    selectedRecipeId = populateSelect(recipeSelect, data.recipes, selectedRecipeId || recipeSelect.value);
    selectedMixerId = populateSelect(mixerSelect, data.mixers, selectedMixerId || mixerSelect.value);

    var recipe = data.recipes.find(function (r) { return r.id === selectedRecipeId; });
    var mixer = data.mixers.find(function (m) { return m.id === selectedMixerId; });

    var materialsCost = Calc.materialsCostPerM3(recipe, data.materials);
    var payroll = Calc.payrollPerM3(data);
    var depr = Calc.plantDeprPerM3(data.config);
    var utilities = Calc.utilitiesPerM3(data.config);
    var costPerM3 = materialsCost + payroll + depr + utilities;
    document.getElementById('cost-per-m3').textContent = Format.fmt(costPerM3, 2);

    var saleVolume = parseFloat(document.getElementById('sale-volume').value) || 0;
    var trips = Calc.tripsForVolume(mixer, saleVolume);

    var dist = parseFloat(document.getElementById('dist').value) || 0;
    var roundTrip = dist * 2;
    var fuelPrice = parseFloat(document.getElementById('fuel-price').value) || 0;
    var fuelRate = mixer ? mixer.fuelRate : 0;
    var amortPerKm = Calc.amortPerKm(mixer);
    var fuelCostPerTrip = roundTrip * (fuelRate / 100) * fuelPrice;
    var amortCostPerTrip = roundTrip * amortPerKm;
    var neighborCity = document.getElementById('nb-city').checked;
    var surchargePerTrip = neighborCity ? 1000 : 0;
    var deliveryTotal = (fuelCostPerTrip + amortCostPerTrip + surchargePerTrip) * trips;

    document.getElementById('round-trip').textContent = Format.fmtNum(roundTrip, 0, 'км');
    document.getElementById('fuel-cost').textContent = Format.fmt(fuelCostPerTrip, 2);
    document.getElementById('amort-cost').textContent = Format.fmt(amortCostPerTrip, 2);
    document.getElementById('surcharge-cost').textContent = Format.fmt(surchargePerTrip, 2);
    document.getElementById('trip-count').textContent = Format.fmtNum(trips, 0, 'рейс(ов)');
    document.getElementById('delivery-total').textContent = Format.fmt(deliveryTotal, 2);
    document.getElementById('delivery-line').textContent = Format.fmt(deliveryTotal, 2);

    var salePrice = NumericInput.parseNumber(document.getElementById('sale-price').value) || 0;
    var revenue = salePrice * saleVolume;
    var batchCost = costPerM3 * saleVolume;
    var profitTotal = revenue - batchCost - deliveryTotal;
    var profitPerM3 = salePrice - costPerM3;

    document.getElementById('revenue').textContent = Format.fmt(revenue, 2);
    document.getElementById('batch-cost').textContent = Format.fmt(batchCost, 2);

    var profitTotalEl = document.getElementById('profit-total');
    var profitTotalWrap = document.getElementById('profit-total-wrap');
    var profitPerM3El = document.getElementById('profit-per-m3');
    var profitPerM3Wrap = document.getElementById('profit-per-m3-wrap');
    var barProfitEl = document.getElementById('bar-profit');

    profitTotalEl.textContent = Format.fmt(profitTotal, 2);
    profitPerM3El.textContent = Format.fmt(profitPerM3, 2);
    barProfitEl.textContent = Format.fmt(profitTotal, 2);

    profitTotalWrap.classList.remove('positive', 'negative');
    profitTotalWrap.classList.add(profitTotal >= 0 ? 'positive' : 'negative');
    profitPerM3Wrap.classList.remove('positive', 'negative');
    profitPerM3Wrap.classList.add(profitPerM3 >= 0 ? 'positive' : 'negative');
    barProfitEl.classList.remove('positive', 'negative');
    barProfitEl.classList.add(profitTotal >= 0 ? 'positive' : 'negative');
  }

  function init() {
    var salePriceInput = document.getElementById('sale-price');
    NumericInput.attach(salePriceInput);
    NumericInput.setFormattedValue(salePriceInput, parseFloat(salePriceInput.value) || 0);
    inputIds.forEach(function (id) {
      document.getElementById(id).addEventListener('input', recalc);
    });
    document.getElementById('nb-city').addEventListener('change', recalc);
    document.getElementById('main-recipe').addEventListener('change', function () {
      selectedRecipeId = this.value;
      recalc();
    });
    document.getElementById('main-mixer').addEventListener('change', function () {
      selectedMixerId = this.value;
      recalc();
    });
  }

  window.MainTab = { init: init, render: recalc };
})();
