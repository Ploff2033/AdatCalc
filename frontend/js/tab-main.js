(function () {
  var selectedRecipeId = null;
  var selectedMixerId = null;
  var inputIds = ['dist', 'fuel-price', 'delivery-charge', 'sale-volume'];

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

  function setProfitLine(valueEl, amount) {
    valueEl.textContent = Format.fmt(amount, 2);
    valueEl.classList.remove('positive', 'negative');
    valueEl.classList.add(amount >= 0 ? 'positive' : 'negative');
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
    var salePrice = recipe ? (recipe.salePrice || 0) : 0;
    document.getElementById('recipe-sale-price-display').textContent = Format.fmt(salePrice, 2);

    var mixRevenue = salePrice * saleVolume;
    var mixCost = costPerM3 * saleVolume;
    var mixProfit = mixRevenue - mixCost;
    document.getElementById('mix-revenue').textContent = Format.fmt(mixRevenue, 2);
    document.getElementById('mix-cost').textContent = Format.fmt(mixCost, 2);
    setProfitLine(document.getElementById('mix-profit'), mixProfit);

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
    document.getElementById('delivery-revenue').textContent = Format.fmt(deliveryRevenue, 2);
    setProfitLine(document.getElementById('delivery-profit'), deliveryProfit);

    var totalProfit = mixProfit + deliveryProfit;
    var profitPerM3Total = saleVolume > 0 ? totalProfit / saleVolume : 0;

    var profitTotalEl = document.getElementById('profit-total');
    var profitTotalWrap = document.getElementById('profit-total-wrap');
    var profitPerM3El = document.getElementById('profit-per-m3');
    var profitPerM3Wrap = document.getElementById('profit-per-m3-wrap');

    profitTotalEl.textContent = Format.fmt(totalProfit, 2);
    profitPerM3El.textContent = Format.fmt(profitPerM3Total, 2);

    profitTotalWrap.classList.remove('positive', 'negative');
    profitTotalWrap.classList.add(totalProfit >= 0 ? 'positive' : 'negative');
    profitPerM3Wrap.classList.remove('positive', 'negative');
    profitPerM3Wrap.classList.add(profitPerM3Total >= 0 ? 'positive' : 'negative');
  }

  function init() {
    NumericInput.attach(document.getElementById('delivery-charge'));
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
