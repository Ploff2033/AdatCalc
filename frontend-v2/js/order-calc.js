(function () {
  // Единая, DOM-независимая версия расчёта заказа для v2 — и десктоп
  // (screen-main.js), и мобильный (mobile-calc.js) экраны читают свои
  // input'ы в эту функцию и рендерят один и тот же результат, чтобы мобильная
  // вёрстка физически не могла разойтись с десктопной в цифрах. Логика — тот
  // же перенос tab-main.js, что уже сделан один раз в screen-main.js.
  var VAT_MULT = 1.22;

  // input: { plant, recipe, mixer, data:{materials,aggregateTrucks,plants,personnelSummary,config},
  //          selfPickup, saleVolume, dist, addressFilled, priceNet, vatGrossMode,
  //          nbCity, fuelPrice, ureaPrice, deliveryChargePerM3 }
  function run(input) {
    var data = input.data;
    var plant = input.plant;
    var recipe = input.recipe;
    var mixer = input.mixer;
    var selfPickup = !!input.selfPickup;
    var saleVolume = input.saleVolume || 0;
    var dist = input.dist || 0;

    if (!recipe) return null;

    var materialsCost = Calc.materialsCostPerM3(recipe, data.materials, data.aggregateTrucks);
    var payroll = Calc.payrollPerM3(plant, data.plants, data.personnelSummary);
    var depr = Calc.plantDeprPerM3(plant);
    var utilities = Calc.utilitiesPerM3(plant);
    var costPerM3 = materialsCost + payroll + depr + utilities;

    var materialsById = {};
    data.materials.forEach(function (m) { materialsById[m.id] = m; });
    // materialId — без него backend/handlers/stock.js не может забронировать
    // остаток под этот заказ (order_materials.material_id, см. schema.sql).
    var materialsBreakdown = recipe.items.map(function (item) {
      var mat = materialsById[item.materialId];
      return { name: mat ? mat.name : 'Неизвестный материал', unit: mat ? mat.unit : '', qty: item.qty * saleVolume, materialId: item.materialId || null };
    });

    var priceNet = input.priceNet || 0;
    var vatGrossMode = !!input.vatGrossMode;
    var mixRevenue = priceNet * saleVolume;
    var mixRevenueGross = priceNet * VAT_MULT * saleVolume;
    var mixCost = costPerM3 * saleVolume;
    var mixProfit = mixRevenue - mixCost;
    var mixMarginPercent = Calc.marginPercent(mixProfit, mixRevenue);
    var safetyMargin = priceNet - costPerM3;

    var deliveryReady = selfPickup || (!!mixer && dist > 0 && input.addressFilled);
    var trips = 0, roundTrip = 0, fuelCostPerTrip = 0, ureaCostPerTrip = 0, platonCostPerTrip = 0, amortCostPerTrip = 0,
      neighborCity = !!input.nbCity, surchargePerTrip = 0, deliveryCostTotal = 0, deliveryChargePerM3 = 0,
      deliveryRevenue = 0, deliveryProfit = 0, deliveryMarginPercent = 0;
    var neighborCitySurcharge = (data.config && data.config.neighborCitySurcharge) || 0;

    if (deliveryReady && !selfPickup) {
      trips = Calc.tripsForVolume(mixer, saleVolume);
      roundTrip = dist * 2;
      var amortPerKm = Calc.amortPerKm(mixer);
      fuelCostPerTrip = roundTrip * ((mixer.fuelRate || 0) / 100) * (input.fuelPrice || 0);
      ureaCostPerTrip = roundTrip * ((mixer.ureaRate || 0) / 100) * (input.ureaPrice || 0);
      platonCostPerTrip = roundTrip * (mixer.platonRatePerKm || 0);
      amortCostPerTrip = roundTrip * amortPerKm;
      surchargePerTrip = neighborCity ? neighborCitySurcharge : 0;
      deliveryCostTotal = (fuelCostPerTrip + ureaCostPerTrip + platonCostPerTrip + amortCostPerTrip + surchargePerTrip) * trips;
      deliveryChargePerM3 = input.deliveryChargePerM3 || 0;
      deliveryRevenue = deliveryChargePerM3 * saleVolume;
      deliveryProfit = deliveryRevenue - deliveryCostTotal;
      deliveryMarginPercent = Calc.marginPercent(deliveryProfit, deliveryRevenue);
    }

    var totalRevenueNet = mixRevenue + deliveryRevenue;
    var totalRevenueGross = mixRevenueGross + deliveryRevenue;
    var totalRevenueDisplayed = vatGrossMode ? totalRevenueGross : totalRevenueNet;
    var totalProfit = mixProfit + deliveryProfit;
    var profitPerM3Total = saleVolume > 0 ? totalProfit / saleVolume : 0;
    var marginTotal = Calc.marginPercent(totalProfit, totalRevenueNet);
    var vatAmount = vatGrossMode && mixRevenue > 0 ? mixRevenueGross - mixRevenue : 0;
    // Безубыточная цена доставки (для мобильной подсказки "доставка в минус
    // от X ₽/м³") — расход на 1 м³ при текущем плече/миксере.
    var deliveryBreakevenPerM3 = saleVolume > 0 && trips > 0 ? deliveryCostTotal / saleVolume : 0;

    return {
      deliveryReady: deliveryReady, trips: trips, roundTrip: roundTrip,
      materialsCost: materialsCost, payroll: payroll, depr: depr, utilities: utilities, costPerM3: costPerM3,
      materialsBreakdown: materialsBreakdown, priceNet: priceNet,
      mixRevenue: mixRevenue, mixRevenueGross: mixRevenueGross, mixCost: mixCost, mixProfit: mixProfit, mixMarginPercent: mixMarginPercent,
      safetyMargin: safetyMargin, safetyMarginPercent: priceNet > 0 ? (safetyMargin / priceNet) * 100 : 0,
      fuelCostPerTrip: fuelCostPerTrip, ureaCostPerTrip: ureaCostPerTrip, platonCostPerTrip: platonCostPerTrip, amortCostPerTrip: amortCostPerTrip,
      surchargePerTrip: surchargePerTrip, deliveryCostTotal: deliveryCostTotal, deliveryChargePerM3: deliveryChargePerM3,
      deliveryRevenue: deliveryRevenue, deliveryProfit: deliveryProfit, deliveryMarginPercent: deliveryMarginPercent,
      deliveryBreakevenPerM3: deliveryBreakevenPerM3, neighborCitySurcharge: neighborCitySurcharge,
      totalRevenueNet: totalRevenueNet, totalRevenueGross: totalRevenueGross, totalRevenueDisplayed: totalRevenueDisplayed,
      totalProfit: totalProfit, profitPerM3: profitPerM3Total, totalMarginPercent: marginTotal, vatAmount: vatAmount
    };
  }

  // Собирает payload для POST /api/orders из результата run() + сырых input —
  // тот же набор полей, что backend/handlers/orders.js::sanitize() ожидает.
  function toOrderPayload(input, calc) {
    var plant = input.plant, recipe = input.recipe, mixer = input.mixer, selfPickup = !!input.selfPickup;
    return {
      plantId: plant.id, plantName: plant.name, recipeName: recipe.name, materials: calc.materialsBreakdown,
      mixerName: selfPickup ? 'Самовывоз' : mixer.name, mixerPlate: selfPickup ? '' : (mixer.licensePlate || ''),
      driverName: '', driverLicenseNumber: '', saleVolume: input.saleVolume, distanceKm: selfPickup ? 0 : input.dist,
      address: selfPickup ? '' : (input.address || ''), fuelPricePerLiter: input.fuelPrice || 0, ureaPricePerLiter: input.ureaPrice || 0,
      ureaCostPerTrip: calc.ureaCostPerTrip, platonCostPerTrip: calc.platonCostPerTrip, neighborCity: !!input.nbCity,
      surchargePerTrip: calc.surchargePerTrip, tripCount: calc.trips, roundTripKm: calc.roundTrip, fuelCostPerTrip: calc.fuelCostPerTrip,
      amortCostPerTrip: calc.amortCostPerTrip, deliveryCostTotal: calc.deliveryCostTotal, deliveryChargePerM3: calc.deliveryChargePerM3,
      deliveryRevenue: calc.deliveryRevenue, deliveryProfit: calc.deliveryProfit, deliveryMarginPercent: calc.deliveryMarginPercent,
      materialsCost: calc.materialsCost, payrollCost: calc.payroll, deprCost: calc.depr, utilitiesCost: calc.utilities, costPerM3: calc.costPerM3,
      salePrice: calc.priceNet, mixRevenue: calc.mixRevenue, mixCost: calc.mixCost, mixProfit: calc.mixProfit, mixMarginPercent: calc.mixMarginPercent,
      totalRevenue: calc.totalRevenueDisplayed, totalProfit: calc.totalProfit, profitPerM3: calc.profitPerM3, totalMarginPercent: calc.totalMarginPercent,
      vatApplied: !!input.vatGrossMode, createdAt: new Date().toISOString()
    };
  }

  window.OrderCalc = { run: run, toOrderPayload: toOrderPayload };
})();
