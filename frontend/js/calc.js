(function () {
  // ФОТ на 1 м³ для завода = (ФОТ своих сотрудников / выработка этого завода)
  // + (ФОТ общих сотрудников / суммарная выработка ВСЕХ заводов) — общие
  // сотрудники (бухгалтер и т.п.) обслуживают все заводы сразу, поэтому их
  // ФОТ размазывается по общей выработке, а не по одному заводу.
  function payrollPerM3(plant, allPlants, personnelSummary) {
    if (!plant) return 0;
    var totalOutput = (allPlants || []).reduce(function (sum, p) { return sum + (p.targetOutput || 0); }, 0);
    var ownTotal = (personnelSummary && personnelSummary.byPlant && personnelSummary.byPlant[plant.id]) || 0;
    var sharedTotal = (personnelSummary && personnelSummary.sharedTotal) || 0;
    var ownPart = plant.targetOutput > 0 ? ownTotal / plant.targetOutput : 0;
    var sharedPart = totalOutput > 0 ? sharedTotal / totalOutput : 0;
    return ownPart + sharedPart;
  }

  function plantDeprMonthly(plant) {
    if (!plant) return 0;
    var pd = plant.plantDepr;
    if (!pd || !(pd.lifespanMonths > 0)) return 0;
    return (pd.balance - pd.residual) / pd.lifespanMonths;
  }

  function plantDeprPerM3(plant) {
    if (!plant || !(plant.targetOutput > 0)) return 0;
    return plantDeprMonthly(plant) / plant.targetOutput;
  }

  function utilitiesPerM3(plant) {
    if (!plant) return 0;
    return plant.targetOutput > 0 ? (plant.utilitiesMonthly || 0) / plant.targetOutput : 0;
  }

  // Постоянные расходы завода за месяц, в рублях (не на м³!) — ФОТ (свои +
  // доля общих сотрудников по выработке) + амортизация + коммуналка. Считаем
  // напрямую, а не через payrollPerM3×targetOutput — при targetOutput=0 (ещё
  // не заполнили) деление на м³ обнулило бы реальный ФОТ, а тут это просто
  // сумма фактических месячных расходов, которую нужно "отбить" заказами.
  function fixedCostsMonthly(plant, allPlants, personnelSummary) {
    if (!plant) return 0;
    var totalOutput = (allPlants || []).reduce(function (sum, p) { return sum + (p.targetOutput || 0); }, 0);
    var ownPayroll = (personnelSummary && personnelSummary.byPlant && personnelSummary.byPlant[plant.id]) || 0;
    var sharedTotal = (personnelSummary && personnelSummary.sharedTotal) || 0;
    var sharedShare = totalOutput > 0 ? sharedTotal * ((plant.targetOutput || 0) / totalOutput) : 0;
    return ownPayroll + sharedShare + plantDeprMonthly(plant) + (plant.utilitiesMonthly || 0);
  }

  // Вклад заказа в покрытие постоянных расходов (маржинальная прибыль) —
  // выручка минус ТОЛЬКО переменные расходы (материалы + доставка). ФОТ/
  // амортизация/коммуналка заказа возвращаются обратно в вклад, потому что
  // для точки безубыточности они уже учтены отдельно в fixedCostsMonthly —
  // иначе посчитали бы их дважды.
  function orderContribution(order) {
    if (!order) return 0;
    var fixedPerM3 = (order.payrollCost || 0) + (order.deprCost || 0) + (order.utilitiesCost || 0);
    return (order.totalProfit || 0) + fixedPerM3 * (order.saleVolume || 0);
  }

  function amortPerKm(vehicle) {
    if (!vehicle || !(vehicle.mileage > 0)) return 0;
    return (vehicle.balance - vehicle.residual) / vehicle.mileage;
  }

  // Внутренние рейсы за инертными — не покупка услуги, поэтому без НДС.
  // Возят всегда полным кузовом, поэтому грузоподъёмность берётся с карточки техники, без переопределения.
  // Амортизация тоже всегда считается с карточки техники (баланс/остаток/пробег) — не хранится отдельно,
  // чтобы не разъезжалась с реальной карточкой при её изменении.
  // Мочевина (AdBlue) — расход хранится на карточке техники, цена вводится
  // при доставке (как топливо). Платон — только для доставки инертов, ставка
  // ₽/км уже полная (без отдельной "цены"), берётся с карточки техники.
  function aggregateDeliveryPerTrip(delivery, truck) {
    if (!delivery || !truck) return { fuel: 0, urea: 0, platon: 0, amort: 0, surcharge: 0, total: 0 };
    var roundTrip = (delivery.distanceKm || 0) * 2;
    var fuel = roundTrip * ((truck.fuelRate || 0) / 100) * (delivery.fuelPricePerLiter || 0);
    var urea = roundTrip * ((truck.ureaRate || 0) / 100) * (delivery.ureaPricePerLiter || 0);
    var platon = roundTrip * (truck.platonRatePerKm || 0);
    var amort = roundTrip * amortPerKm(truck);
    var surcharge = delivery.driverSurcharge || 0;
    return { fuel: fuel, urea: urea, platon: platon, amort: amort, surcharge: surcharge, total: fuel + urea + platon + amort + surcharge };
  }

  function materialDeliveryAdditionPerTon(material, trucks) {
    if (!material || !material.delivery) return 0;
    var delivery = material.delivery;
    if (!delivery.ownTransport) return delivery.manualCostPerUnit || 0;
    var truck = (trucks || []).find(function (t) { return t.id === delivery.truckId; });
    if (!truck || !(truck.capacity > 0)) return 0;
    var perTrip = aggregateDeliveryPerTrip(delivery, truck);
    return perTrip.total / truck.capacity;
  }

  // "На заводе": закупочная цена + доставка (без НДС), до вычета потерь при хранении/дозировке.
  function materialLandedPrice(material, trucks) {
    if (!material) return 0;
    return material.price + materialDeliveryAdditionPerTon(material, trucks);
  }

  function materialEffectivePrice(material, trucks) {
    if (!material) return 0;
    return materialLandedPrice(material, trucks) * (1 + (material.lossPercent || 0) / 100);
  }

  function materialsCostPerM3(recipe, materials, trucks) {
    if (!recipe) return 0;
    var byId = {};
    materials.forEach(function (m) { byId[m.id] = m; });
    return recipe.items.reduce(function (sum, item) {
      var mat = byId[item.materialId];
      if (!mat) return sum;
      return sum + item.qty * materialEffectivePrice(mat, trucks);
    }, 0);
  }

  function tripsForVolume(mixer, volume) {
    if (!mixer || !(mixer.capacity > 0) || !(volume > 0)) return 1;
    return Math.max(1, Math.ceil(volume / mixer.capacity));
  }

  function marginPercent(profit, revenue) {
    return revenue > 0 ? (profit / revenue) * 100 : 0;
  }

  window.Calc = {
    payrollPerM3: payrollPerM3,
    plantDeprPerM3: plantDeprPerM3,
    plantDeprMonthly: plantDeprMonthly,
    utilitiesPerM3: utilitiesPerM3,
    fixedCostsMonthly: fixedCostsMonthly,
    orderContribution: orderContribution,
    materialEffectivePrice: materialEffectivePrice,
    materialLandedPrice: materialLandedPrice,
    materialDeliveryAdditionPerTon: materialDeliveryAdditionPerTon,
    aggregateDeliveryPerTrip: aggregateDeliveryPerTrip,
    materialsCostPerM3: materialsCostPerM3,
    amortPerKm: amortPerKm,
    tripsForVolume: tripsForVolume,
    marginPercent: marginPercent
  };
})();
