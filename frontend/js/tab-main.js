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

  function setMarginBadge(el, percent) {
    el.textContent = Format.fmtNum(percent, 1, '%');
    el.classList.remove('positive', 'negative');
    el.classList.add(percent >= 0 ? 'positive' : 'negative');
  }

  function recalc() {
    refreshPlantMarker();

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

    document.getElementById('cost-materials-label').textContent = recipe ? ('Материалы (' + recipe.name + ')') : 'Материалы';
    document.getElementById('cost-materials').textContent = Format.fmt(materialsCost, 2);
    document.getElementById('cost-payroll').textContent = Format.fmt(payroll, 2);
    document.getElementById('cost-depr').textContent = Format.fmt(depr, 2);
    document.getElementById('cost-utilities').textContent = Format.fmt(utilities, 2);
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
    setMarginBadge(document.getElementById('mix-margin'), Calc.marginPercent(mixProfit, mixRevenue));

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
    setMarginBadge(document.getElementById('delivery-margin'), Calc.marginPercent(deliveryProfit, deliveryRevenue));

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
  }

  // ---- Delivery destination map (inline on Главная) ----
  var deliveryMap = null;
  var deliveryMapInitStarted = false;
  var deliveryPlantPlacemark = null;
  var deliveryDestPlacemark = null;
  var deliveryRouteRequestId = 0;

  function showDeliveryMapUnavailable() {
    document.getElementById('delivery-map').innerHTML =
      '<div class="map-placeholder">Карта недоступна: не задан API-ключ Яндекс.Карт.<br>Добавьте его в frontend/js/yandex-config.js.</div>';
  }

  function currentPlantCoords() {
    var loc = State.data.config.plantLocation;
    return loc && loc.lat != null ? [loc.lat, loc.lng] : MapUtil.DEFAULT_CENTER;
  }

  function refreshPlantMarker() {
    if (!deliveryMap) return;
    var loc = State.data.config.plantLocation;
    if (!loc || loc.lat == null) {
      if (deliveryPlantPlacemark) {
        deliveryMap.geoObjects.remove(deliveryPlantPlacemark);
        deliveryPlantPlacemark = null;
      }
      return;
    }
    var coords = [loc.lat, loc.lng];
    if (deliveryPlantPlacemark) {
      deliveryPlantPlacemark.geometry.setCoordinates(coords);
    } else {
      deliveryPlantPlacemark = new ymaps.Placemark(coords, { hintContent: 'Завод' }, { preset: 'islands#blueFactoryIcon' });
      deliveryMap.geoObjects.add(deliveryPlantPlacemark);
    }
  }

  function applyDistance(km, unitLabel) {
    document.getElementById('delivery-map-distance').textContent = Format.fmtNum(km, 1, unitLabel);
    document.getElementById('dist').value = km.toFixed(1);
    recalc();
  }

  function updateDeliveryDistance(destCoords) {
    var distEl = document.getElementById('delivery-map-distance');
    var plantCoords = currentPlantCoords();
    distEl.textContent = 'Считаем маршрут…';
    var requestId = ++deliveryRouteRequestId;
    var fallback = function () {
      if (requestId !== deliveryRouteRequestId) return;
      var km = MapUtil.haversineKm({ lat: plantCoords[0], lng: plantCoords[1] }, { lat: destCoords[0], lng: destCoords[1] });
      applyDistance(km, 'км по прямой (маршрут недоступен)');
    };
    try {
      ymaps.route([plantCoords, destCoords], { multiRoute: false }).then(function (route) {
        if (requestId !== deliveryRouteRequestId) return;
        applyDistance(route.getLength() / 1000, 'км по дороге');
      }, fallback);
    } catch (err) {
      fallback();
    }
  }

  function setDestination(coords) {
    if (deliveryDestPlacemark) {
      deliveryDestPlacemark.geometry.setCoordinates(coords);
    } else {
      deliveryDestPlacemark = new ymaps.Placemark(coords, { hintContent: 'Точка доставки', draggable: true }, { preset: 'islands#redGeolocationIcon' });
      deliveryMap.geoObjects.add(deliveryDestPlacemark);
      deliveryDestPlacemark.events.add('dragend', function () {
        setDestination(deliveryDestPlacemark.geometry.getCoordinates());
      });
    }
    updateDeliveryDistance(coords);
  }

  function handleDeliveryAddressSearch() {
    var input = document.getElementById('delivery-address-search');
    var query = input.value.trim();
    if (!query || !deliveryMap) return;
    MapUtil.geocode(query).then(
      function (result) {
        if (!result) {
          alert('Адрес не найден.');
          return;
        }
        deliveryMap.setCenter([result.lat, result.lng], 15);
        setDestination([result.lat, result.lng]);
      },
      function () { alert('Не удалось найти адрес.'); }
    );
  }

  function ensureDeliveryMap() {
    if (deliveryMapInitStarted) return;
    deliveryMapInitStarted = true;
    YandexLoader.whenReady(function () {
      if (window.YandexMapsUnavailable) {
        showDeliveryMapUnavailable();
        return;
      }
      deliveryMap = new ymaps.Map('delivery-map', { center: currentPlantCoords(), zoom: 12, controls: ['zoomControl'] });
      refreshPlantMarker();
      deliveryMap.events.add('click', function (e) {
        setDestination(e.get('coords'));
      });

      var searchBtn = document.getElementById('delivery-address-search-btn');
      var searchInput = document.getElementById('delivery-address-search');
      searchBtn.addEventListener('click', handleDeliveryAddressSearch);
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleDeliveryAddressSearch();
        }
      });
    });
  }

  function onShowMain() {
    ensureDeliveryMap();
    if (deliveryMap) {
      setTimeout(function () { deliveryMap.container.fitToViewport(); }, 30);
    }
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

  window.MainTab = { init: init, render: recalc, onShow: onShowMain };
})();
