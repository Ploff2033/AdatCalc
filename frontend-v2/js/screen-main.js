(function () {
  // Порт расчёта из frontend/js/tab-main.js под новую вёрстку (см. план
  // v2/redesign — "пересобрать текущую логику tab-main.js... под новую
  // вёрстку"). Сама формула ни в чём не меняется — только DOM-обвязка и
  // разметка. Склад — заглушка в Фазе 1 (реальные остатки появятся вместе
  // со схемой в Фазе 2), поле "Дата отгрузки" из макета туда же — сейчас у
  // заказа такого поля в БД ещё нет.
  var VAT_MULT = 1.22;
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap">Новый расчёт</span><h1>Расчёт и оформление заказа</h1></div>' +
      '<div class="page-head-actions"><button class="btn ghost sm" id="m-reset-btn">Сбросить</button></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 480px;gap:24px;align-items:start;flex:1;min-height:0" class="m-grid">' +
      '<div class="stack g16">' +
        '<section class="card stack g16" style="padding:20px">' +
          '<div class="card-h2"><span class="step-num">1</span><h2>Смесь</h2></div>' +
          '<div class="grid-3">' +
            '<div class="field"><label for="m-recipe">Рецепт</label><select id="m-recipe" class="inp"></select></div>' +
            '<div class="field"><label for="m-volume">Объём, м³</label><input id="m-volume" class="inp num" inputmode="decimal"></div>' +
            '<div class="field"><label for="m-price" id="m-price-label">Цена отпуска без НДС</label><input id="m-price" class="inp num" inputmode="decimal"></div>' +
          '</div>' +
          '<div class="field" style="max-width:280px"><span style="font-size:12px;color:var(--muted);font-weight:500">Цена указана</span>' +
            '<div class="seg" role="group" aria-label="НДС"><button type="button" id="m-vat-off" class="on" aria-pressed="true">без НДС</button><button type="button" id="m-vat-on" aria-pressed="false">с НДС 22%</button></div>' +
          '</div>' +
          '<p class="hint" id="m-price-hint" style="margin:0"></p>' +
        '</section>' +
        '<section class="card stack g16" style="padding:20px" id="m-delivery-section">' +
          '<div class="spread">' +
            '<div class="card-h2"><span class="step-num">2</span><h2>Доставка</h2></div>' +
            '<label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer"><button type="button" class="tog" id="m-self-pickup" aria-pressed="false"><i></i></button>Самовывоз</label>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:14px">' +
            '<div class="field" id="m-address-field"><label for="m-address">Адрес / объект</label><input id="m-address" class="inp"></div>' +
            '<div class="field" id="m-dist-field"><label for="m-dist">Плечо, км</label><input id="m-dist" class="inp num" inputmode="decimal"></div>' +
            '<div class="field"><label for="m-mixer">Миксер</label><select id="m-mixer" class="inp"></select></div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="m-nb-city"> Рейс в другой город <span id="m-nb-badge" class="hint"></span></label>' +
            '<span class="hint">Рейсов: <b class="num" id="m-trip-count" style="color:var(--ink)">—</b></span>' +
          '</div>' +
          '<div class="grid-3">' +
            '<div class="field"><label for="m-delivery-charge">Цена доставки клиенту</label><div class="unit"><input id="m-delivery-charge" class="inp num" inputmode="decimal" value="500"><span>₽/м³</span></div></div>' +
          '</div>' +
          '<div class="grid-2">' +
            '<div class="field"><label for="m-fuel-price">Цена топлива <button type="button" class="hint" id="m-fuel-reset" style="border:0;background:none;cursor:pointer;text-decoration:underline">сбросить</button></label><input id="m-fuel-price" class="inp num" inputmode="decimal"></div>' +
            '<div class="field"><label for="m-urea-price">Цена мочевины <button type="button" class="hint" id="m-urea-reset" style="border:0;background:none;cursor:pointer;text-decoration:underline">сбросить</button></label><input id="m-urea-price" class="inp num" inputmode="decimal"></div>' +
          '</div>' +
        '</section>' +
        '<section class="card" style="padding:0;overflow:hidden">' +
          '<div class="spread" style="padding:16px 20px">' +
            '<div class="card-h2"><span class="step-num">3</span><h2 id="m-stock-title">Склад после этого заказа</h2></div>' +
            '<span class="chip mute" id="m-stock-chip">Фаза 2</span>' +
          '</div>' +
          '<p class="hint" style="margin:0 20px 16px">Проверка остатков материалов появится вместе с модулем «Остатки» (см. вкладку в сайдбаре — пока пустая заготовка).</p>' +
        '</section>' +
      '</div>' +
      '<aside class="card" style="padding:0;overflow:hidden;border-color:var(--ink)">' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));background:var(--sidebar-bg);color:#fff" class="m-kpi-grid">' +
          '<div class="m-kpi" style="border-right:1px solid var(--sidebar-border);border-bottom:1px solid var(--sidebar-border)"><span class="m-kpi-label">Чистая прибыль · итого</span><span class="num m-kpi-val" id="m-net-profit">—</span><span class="num m-kpi-sub" id="m-net-margin">—</span></div>' +
          '<div class="m-kpi" style="border-bottom:1px solid var(--sidebar-border)"><span class="m-kpi-label">К оплате</span><span class="num m-kpi-val" id="m-pay-total">—</span><span class="num m-kpi-sub" id="m-pay-vat-note"></span></div>' +
          '<div class="m-kpi" style="border-right:1px solid var(--sidebar-border)"><span class="m-kpi-label">Прибыль с м³</span><span class="num m-kpi-val" id="m-profit-per-m3" style="font-size:20px">—</span></div>' +
          '<div class="m-kpi"><span class="m-kpi-label">Запас прочности</span><span class="num m-kpi-val" id="m-safety-margin" style="font-size:20px">—</span><span class="num m-kpi-sub" id="m-safety-margin-pct"></span></div>' +
        '</div>' +
        '<div class="stack g14" style="padding:16px 20px" id="m-breakdown" hidden>' +
          '<div class="bar lg" id="m-split-bar"><span id="m-split-mix" style="background:var(--ink)"></span><span id="m-split-delivery" style="background:var(--accent)"></span></div>' +
          '<div class="grid-2">' +
            '<div class="stack" style="border:1px solid var(--border);border-radius:6px;overflow:hidden;background:#fff">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg);border-bottom:1px solid var(--border)"><span style="width:10px;height:10px;border-radius:2px;background:var(--ink)"></span><span style="font-weight:600">Смесь</span><span class="hint" style="margin-left:auto" id="m-mix-vol"></span></div>' +
              '<div class="stack g6" style="padding:10px 12px">' +
                '<div class="spread" style="font-size:13px"><span>Выручка без НДС</span><span class="num" id="m-mix-revenue" style="font-weight:600">—</span></div>' +
                '<div class="spread" style="font-size:13px"><span>Себестоимость</span><span class="num" id="m-mix-cost" style="font-weight:600">—</span></div>' +
                '<div class="stack g6" style="padding-left:10px;border-left:2px solid var(--border-soft)">' +
                  '<div class="spread" style="font-size:13px"><span>Материалы</span><span class="num" id="m-mix-materials"></span></div>' +
                  '<div class="spread" style="font-size:13px"><span>ФОТ</span><span class="num" id="m-mix-payroll"></span></div>' +
                  '<div class="spread" style="font-size:13px"><span>Амортизация</span><span class="num" id="m-mix-depr"></span></div>' +
                  '<div class="spread" style="font-size:13px"><span>Коммуналка</span><span class="num" id="m-mix-utilities"></span></div>' +
                '</div>' +
              '</div>' +
              '<div class="stack" style="padding:10px 12px;border-top:1px solid var(--border);background:var(--surface-2);gap:1px"><span style="font-size:12px;font-weight:600">Прибыль от смеси</span><span class="num" id="m-mix-profit" style="font-size:18px;font-weight:600">—</span><span class="num hint" id="m-mix-margin"></span></div>' +
            '</div>' +
            '<div class="stack" id="m-delivery-box" style="border:1px solid var(--border);border-radius:6px;overflow:hidden;background:#fff">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg);border-bottom:1px solid var(--border)"><span style="width:10px;height:10px;border-radius:2px;background:var(--accent)"></span><span style="font-weight:600">Доставка</span><span class="hint" style="margin-left:auto" id="m-delivery-trips-label"></span></div>' +
              '<div class="stack g6" style="padding:10px 12px">' +
                '<div class="spread" style="font-size:13px"><span>Доход от доставки</span><span class="num" id="m-delivery-revenue" style="font-weight:600">—</span></div>' +
                '<div class="spread" style="font-size:13px"><span>Расход</span><span class="num" id="m-delivery-cost" style="font-weight:600">—</span></div>' +
                '<div class="stack g6" style="padding-left:10px;border-left:2px solid var(--border-soft)">' +
                  '<div class="spread" style="font-size:13px"><span>Топливо</span><span class="num" id="m-delivery-fuel"></span></div>' +
                  '<div class="spread" style="font-size:13px"><span>Мочевина</span><span class="num" id="m-delivery-urea"></span></div>' +
                  '<div class="spread" style="font-size:13px"><span>Платон/доплата</span><span class="num" id="m-delivery-surcharge"></span></div>' +
                  '<div class="spread" style="font-size:13px"><span>Амортизация</span><span class="num" id="m-delivery-amort"></span></div>' +
                '</div>' +
              '</div>' +
              '<div class="stack" style="padding:10px 12px;border-top:1px solid var(--border);background:var(--surface-2);gap:1px"><span style="font-size:12px;font-weight:600">Прибыль от доставки</span><span class="num" id="m-delivery-profit" style="font-size:18px;font-weight:600">—</span><span class="num hint" id="m-delivery-margin"></span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:auto;padding:16px 22px 20px;border-top:1px solid var(--border-soft);background:var(--surface-2)" class="stack g12">' +
          '<div class="banner" id="m-validation-banner" hidden></div>' +
          '<div class="banner" id="m-stock-banner" hidden></div>' +
          '<button class="btn pri" id="m-place-order-btn" style="width:100%;height:48px;font-size:15px">Оформить заказ</button>' +
          '<p class="hint" id="m-order-placed-hint" style="text-align:center;margin:0" hidden>Заказ оформлен.</p>' +
          '<p class="hint" style="text-align:center;margin:0">После оформления цены заказа фиксируются.</p>' +
        '</div>' +
      '</aside>' +
    '</div>';

  var selectedRecipeId = '';
  var selectedMixerId = '';
  var vatGrossMode = false;
  var priceDirty = false;
  var priceNetStored = 0;
  var fuelPriceDirty = false;
  var ureaPriceDirty = false;
  var lastPricePlantId = null;
  var submitAttempted = false;
  var lastCalc = null;

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

  function netFromField(input) {
    var entered = NumericInput.parseNumber(input.value) || 0;
    return vatGrossMode ? entered / VAT_MULT : entered;
  }

  function displayVatField(input, netValue) {
    if (document.activeElement === input) return;
    NumericInput.setFormattedValue(input, vatGrossMode ? netValue * VAT_MULT : netValue);
  }

  function setVatButtons() {
    document.getElementById('m-vat-off').classList.toggle('on', !vatGrossMode);
    document.getElementById('m-vat-on').classList.toggle('on', vatGrossMode);
    document.getElementById('m-price-label').textContent = 'Цена отпуска ' + (vatGrossMode ? 'с НДС' : 'без НДС');
  }

  function recalc() {
    var data = State.data;
    var plant = State.currentPlant();
    var recipeSelect = document.getElementById('m-recipe');
    var mixerSelect = document.getElementById('m-mixer');
    var distInput = document.getElementById('m-dist');
    var addressInput = document.getElementById('m-address');
    var banner = document.getElementById('m-validation-banner');
    var placeOrderBtn = document.getElementById('m-place-order-btn');
    var nbCityInput = document.getElementById('m-nb-city');

    var selfPickup = document.getElementById('m-self-pickup').classList.contains('on');
    [mixerSelect, distInput, addressInput, nbCityInput].forEach(function (el) { el.disabled = selfPickup; });
    document.getElementById('m-fuel-price').disabled = selfPickup;
    document.getElementById('m-urea-price').disabled = selfPickup;
    document.getElementById('m-delivery-section').style.opacity = selfPickup ? '.55' : '1';

    selectedRecipeId = populateSelect(recipeSelect, data.recipes, selectedRecipeId || recipeSelect.value);
    selectedMixerId = populateSelect(mixerSelect, data.mixers, selectedMixerId || mixerSelect.value);
    var recipe = data.recipes.find(function (r) { return r.id === selectedRecipeId; });
    var mixer = data.mixers.find(function (m) { return m.id === selectedMixerId; });

    var distRaw = distInput.value;
    var dist = parseFloat(distRaw) || 0;
    var distMissing = !selfPickup && (distRaw.trim() === '' || !(dist > 0));
    var addressMissing = !selfPickup && !addressInput.value.trim();

    var pricePlantId = plant ? plant.id : null;
    if (pricePlantId !== lastPricePlantId) {
      fuelPriceDirty = false;
      ureaPriceDirty = false;
      lastPricePlantId = pricePlantId;
    }
    var fuelPriceInput = document.getElementById('m-fuel-price');
    if (!fuelPriceDirty) NumericInput.setFormattedValue(fuelPriceInput, (plant && plant.fuelPrice) || 0);
    var fuelPrice = NumericInput.parseNumber(fuelPriceInput.value) || 0;

    var ureaPriceInput = document.getElementById('m-urea-price');
    if (!ureaPriceDirty) NumericInput.setFormattedValue(ureaPriceInput, (plant && plant.ureaPrice) || 0);
    var ureaPrice = NumericInput.parseNumber(ureaPriceInput.value) || 0;

    var neighborCitySurcharge = (data.config && data.config.neighborCitySurcharge) || 0;
    document.getElementById('m-nb-badge').textContent = '(+' + Format.fmt(neighborCitySurcharge, 0) + '/рейс)';

    var missingDelivery = [];
    if (!selfPickup && !mixer) missingDelivery.push(mixerSelect);
    if (distMissing) missingDelivery.push(distInput.closest('.field'));
    if (addressMissing) missingDelivery.push(addressInput.closest('.field'));
    var missing = recipe ? missingDelivery : [recipeSelect].concat(missingDelivery);

    [recipeSelect, mixerSelect, distInput.closest('.field'), addressInput.closest('.field')].forEach(function (el) { el.style.borderColor = ''; });
    if (submitAttempted && missing.length) {
      missing.forEach(function (el) { if (el.style) el.style.borderColor = '#8C2217'; });
      banner.textContent = selfPickup
        ? 'Заполните обязательное поле: марка/рецепт.'
        : 'Заполните обязательные поля: марка/рецепт, миксер, расстояние и адрес доставки.';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    if (!recipe) {
      placeOrderBtn.disabled = true;
      lastCalc = null;
      document.getElementById('m-breakdown').hidden = true;
      return;
    }

    var materialsCost = Calc.materialsCostPerM3(recipe, data.materials, data.aggregateTrucks);
    var payroll = Calc.payrollPerM3(plant, data.plants, data.personnelSummary);
    var depr = Calc.plantDeprPerM3(plant);
    var utilities = Calc.utilitiesPerM3(plant);
    var costPerM3 = materialsCost + payroll + depr + utilities;

    var saleVolume = parseFloat(document.getElementById('m-volume').value) || 0;
    document.getElementById('m-mix-vol').textContent = Format.fmtNum(saleVolume, 1, 'м³');

    var materialsById = {};
    data.materials.forEach(function (m) { materialsById[m.id] = m; });
    var materialsBreakdown = recipe.items.map(function (item) {
      var mat = materialsById[item.materialId];
      return { name: mat ? mat.name : 'Неизвестный материал', unit: mat ? mat.unit : '', qty: item.qty * saleVolume };
    });

    var salePrice = recipe.salePrice || 0;
    var priceInput = document.getElementById('m-price');
    var priceNet = priceDirty ? priceNetStored : salePrice;
    displayVatField(priceInput, priceNet);

    var mixRevenue = priceNet * saleVolume;
    var mixRevenueGross = priceNet * VAT_MULT * saleVolume;
    var mixCost = costPerM3 * saleVolume;
    var mixProfit = mixRevenue - mixCost;
    var mixMarginPercent = Calc.marginPercent(mixProfit, mixRevenue);

    var priceHint = document.getElementById('m-price-hint');
    priceHint.textContent = vatGrossMode ? 'В прибыль идёт цена без НДС: ' + Format.fmt(priceNet, 2) + ' за м³.' : '';

    var deliveryReady = selfPickup || (!!mixer && !distMissing && !addressMissing);
    var trips = 0, roundTrip = 0, fuelCostPerTrip = 0, ureaCostPerTrip = 0, platonCostPerTrip = 0, amortCostPerTrip = 0, neighborCity = false,
      surchargePerTrip = 0, deliveryCostTotal = 0, deliveryChargePerM3 = 0, deliveryRevenue = 0, deliveryProfit = 0, deliveryMarginPercent = 0;

    var deliveryChargeInput = document.getElementById('m-delivery-charge');
    deliveryChargeInput.disabled = selfPickup;

    if (deliveryReady && !selfPickup) {
      trips = Calc.tripsForVolume(mixer, saleVolume);
      roundTrip = dist * 2;
      var amortPerKm = Calc.amortPerKm(mixer);
      fuelCostPerTrip = roundTrip * ((mixer.fuelRate || 0) / 100) * fuelPrice;
      ureaCostPerTrip = roundTrip * ((mixer.ureaRate || 0) / 100) * ureaPrice;
      platonCostPerTrip = roundTrip * (mixer.platonRatePerKm || 0);
      amortCostPerTrip = roundTrip * amortPerKm;
      neighborCity = nbCityInput.checked;
      surchargePerTrip = neighborCity ? neighborCitySurcharge : 0;
      deliveryCostTotal = (fuelCostPerTrip + ureaCostPerTrip + platonCostPerTrip + amortCostPerTrip + surchargePerTrip) * trips;
      deliveryChargePerM3 = NumericInput.parseNumber(deliveryChargeInput.value) || 0;
      deliveryRevenue = deliveryChargePerM3 * saleVolume;
      deliveryProfit = deliveryRevenue - deliveryCostTotal;
      deliveryMarginPercent = Calc.marginPercent(deliveryProfit, deliveryRevenue);

      document.getElementById('m-trip-count').textContent = Format.fmtNum(trips, 0);
      document.getElementById('m-delivery-box').style.display = '';
    } else if (!selfPickup) {
      document.getElementById('m-trip-count').textContent = '—';
    } else {
      document.getElementById('m-trip-count').textContent = '0';
    }

    var totalRevenueNet = mixRevenue + deliveryRevenue;
    var totalRevenueGross = mixRevenueGross + deliveryRevenue;
    var totalRevenueDisplayed = vatGrossMode ? totalRevenueGross : totalRevenueNet;
    var totalProfit = mixProfit + deliveryProfit;
    var profitPerM3Total = saleVolume > 0 ? totalProfit / saleVolume : 0;
    var marginTotal = Calc.marginPercent(totalProfit, totalRevenueNet);

    document.getElementById('m-pay-total').textContent = Format.fmt(totalRevenueDisplayed, 2);
    var vatNoteEl = document.getElementById('m-pay-vat-note');
    if (vatGrossMode && mixRevenue > 0) {
      vatNoteEl.textContent = 'в т.ч. НДС ' + Format.fmt(mixRevenueGross - mixRevenue, 2);
    } else {
      vatNoteEl.textContent = '';
    }

    document.getElementById('m-net-profit').textContent = Format.fmt(totalProfit, 2);
    document.getElementById('m-net-margin').textContent = Format.fmtNum(marginTotal, 1, '% рентабельность');
    document.getElementById('m-profit-per-m3').textContent = Format.fmt(profitPerM3Total, 2);
    var safetyMargin = priceNet - costPerM3;
    document.getElementById('m-safety-margin').textContent = Format.fmt(safetyMargin, 2);
    document.getElementById('m-safety-margin-pct').textContent = Format.fmtNum(priceNet > 0 ? (safetyMargin / priceNet) * 100 : 0, 1, '% до безубыточной цены');

    // Разбивка видна только залогиненным (менеджер/админ) — работник по
    // анонимной ссылке в v2 вообще не бывает (см. app.js), но проверка на
    // всякий случай остаётся тем же принципом, что и в v1.
    var breakdown = document.getElementById('m-breakdown');
    breakdown.hidden = false;
    var mixShare = totalProfit !== 0 ? Math.max(0, mixProfit / (Math.abs(mixProfit) + Math.abs(deliveryProfit) || 1)) : 0.5;
    document.getElementById('m-split-mix').style.width = Math.round(mixShare * 100) + '%';
    document.getElementById('m-split-delivery').style.width = (100 - Math.round(mixShare * 100)) + '%';

    document.getElementById('m-mix-revenue').textContent = Format.fmt(mixRevenue, 0);
    document.getElementById('m-mix-cost').textContent = Format.fmt(mixCost, 0);
    document.getElementById('m-mix-materials').textContent = Format.fmt(materialsCost * saleVolume, 0);
    document.getElementById('m-mix-payroll').textContent = Format.fmt(payroll * saleVolume, 0);
    document.getElementById('m-mix-depr').textContent = Format.fmt(depr * saleVolume, 0);
    document.getElementById('m-mix-utilities').textContent = Format.fmt(utilities * saleVolume, 0);
    document.getElementById('m-mix-profit').textContent = Format.fmt(mixProfit, 0);
    document.getElementById('m-mix-margin').textContent = Format.fmtNum(mixMarginPercent, 1, '%');

    document.getElementById('m-delivery-trips-label').textContent = Format.fmtNum(trips, 0, 'рейс(ов)');
    document.getElementById('m-delivery-revenue').textContent = Format.fmt(deliveryRevenue, 0);
    document.getElementById('m-delivery-cost').textContent = Format.fmt(deliveryCostTotal, 0);
    document.getElementById('m-delivery-fuel').textContent = Format.fmt(fuelCostPerTrip * trips, 0);
    document.getElementById('m-delivery-urea').textContent = Format.fmt(ureaCostPerTrip * trips, 0);
    document.getElementById('m-delivery-surcharge').textContent = Format.fmt((platonCostPerTrip + surchargePerTrip) * trips, 0);
    document.getElementById('m-delivery-amort').textContent = Format.fmt(amortCostPerTrip * trips, 0);
    document.getElementById('m-delivery-profit').textContent = Format.fmt(deliveryProfit, 0);
    document.getElementById('m-delivery-margin').textContent = Format.fmtNum(deliveryMarginPercent, 1, '%');

    if (!deliveryReady) {
      placeOrderBtn.disabled = true;
      lastCalc = null;
      return;
    }

    placeOrderBtn.disabled = false;
    lastCalc = {
      plantId: plant.id, plantName: plant.name, recipeName: recipe.name, materials: materialsBreakdown,
      mixerName: selfPickup ? 'Самовывоз' : mixer.name, mixerPlate: selfPickup ? '' : (mixer.licensePlate || ''),
      driverName: '', driverLicenseNumber: '', saleVolume: saleVolume, distanceKm: selfPickup ? 0 : dist,
      address: selfPickup ? '' : addressInput.value.trim(), fuelPricePerLiter: fuelPrice, ureaPricePerLiter: ureaPrice,
      ureaCostPerTrip: ureaCostPerTrip, platonCostPerTrip: platonCostPerTrip, neighborCity: neighborCity,
      surchargePerTrip: surchargePerTrip, tripCount: trips, roundTripKm: roundTrip, fuelCostPerTrip: fuelCostPerTrip,
      amortCostPerTrip: amortCostPerTrip, deliveryCostTotal: deliveryCostTotal, deliveryChargePerM3: deliveryChargePerM3,
      deliveryRevenue: deliveryRevenue, deliveryProfit: deliveryProfit, deliveryMarginPercent: deliveryMarginPercent,
      materialsCost: materialsCost, payrollCost: payroll, deprCost: depr, utilitiesCost: utilities, costPerM3: costPerM3,
      salePrice: priceNet, mixRevenue: mixRevenue, mixCost: mixCost, mixProfit: mixProfit, mixMarginPercent: mixMarginPercent,
      totalRevenue: totalRevenueDisplayed, totalProfit: totalProfit, profitPerM3: profitPerM3Total, totalMarginPercent: marginTotal,
      vatApplied: vatGrossMode
    };
  }

  function resetOrderForm() {
    ['m-dist', 'm-address', 'm-volume', 'm-delivery-charge'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('m-nb-city').checked = false;
    document.getElementById('m-self-pickup').classList.remove('on');
    document.getElementById('m-self-pickup').setAttribute('aria-pressed', 'false');
    document.getElementById('m-price').value = '';
    priceDirty = false;
    priceNetStored = 0;
    document.getElementById('m-fuel-price').value = '';
    fuelPriceDirty = false;
    document.getElementById('m-urea-price').value = '';
    ureaPriceDirty = false;
    submitAttempted = false;
    selectedRecipeId = '';
    document.getElementById('m-recipe').value = '';
  }

  async function handlePlaceOrder() {
    if (!lastCalc) { submitAttempted = true; recalc(); return; }
    var btn = document.getElementById('m-place-order-btn');
    var hint = document.getElementById('m-order-placed-hint');
    btn.disabled = true;
    try {
      var payload = Object.assign({}, lastCalc, { createdAt: new Date().toISOString() });
      await Api.post('/orders', payload);
      await State.loadAll();
      resetOrderForm();
      recalc();
      hint.hidden = false;
      setTimeout(function () { hint.hidden = true; }, 4000);
    } catch (err) {
      alert('Не удалось оформить заказ: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  var initialized = false;
  function init() {
    document.getElementById('page-main').innerHTML = HTML;

    document.getElementById('m-vat-off').addEventListener('click', function () { vatGrossMode = false; setVatButtons(); recalc(); });
    document.getElementById('m-vat-on').addEventListener('click', function () { vatGrossMode = true; setVatButtons(); recalc(); });
    setVatButtons();

    document.getElementById('m-self-pickup').addEventListener('click', function () {
      this.classList.toggle('on');
      this.setAttribute('aria-pressed', this.classList.contains('on') ? 'true' : 'false');
      recalc();
    });

    NumericInput.attach(document.getElementById('m-price'));
    document.getElementById('m-price').addEventListener('input', function () {
      priceDirty = true;
      priceNetStored = netFromField(this);
      recalc();
    });

    NumericInput.attach(document.getElementById('m-fuel-price'));
    document.getElementById('m-fuel-price').addEventListener('input', function () { fuelPriceDirty = true; recalc(); });
    document.getElementById('m-fuel-reset').addEventListener('click', function () { fuelPriceDirty = false; recalc(); });
    NumericInput.attach(document.getElementById('m-urea-price'));
    document.getElementById('m-urea-price').addEventListener('input', function () { ureaPriceDirty = true; recalc(); });
    document.getElementById('m-urea-reset').addEventListener('click', function () { ureaPriceDirty = false; recalc(); });

    NumericInput.attach(document.getElementById('m-delivery-charge'));
    document.getElementById('m-delivery-charge').addEventListener('input', recalc);

    ['m-dist', 'm-address', 'm-volume'].forEach(function (id) { document.getElementById(id).addEventListener('input', recalc); });
    document.getElementById('m-nb-city').addEventListener('change', recalc);
    document.getElementById('m-recipe').addEventListener('change', function () { selectedRecipeId = this.value; priceDirty = false; recalc(); });
    document.getElementById('m-mixer').addEventListener('change', function () { selectedMixerId = this.value; recalc(); });
    document.getElementById('m-place-order-btn').addEventListener('click', handlePlaceOrder);
    document.getElementById('m-reset-btn').addEventListener('click', function () { resetOrderForm(); recalc(); });

    initialized = true;
  }

  function show() {
    if (!initialized) init();
    recalc();
  }

  window.MainScreen = { show: show };
})();
