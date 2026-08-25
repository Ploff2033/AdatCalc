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

  function plantDeprPerM3(plant) {
    if (!plant) return 0;
    var pd = plant.plantDepr;
    if (!pd || !(pd.lifespanMonths > 0) || !(plant.targetOutput > 0)) return 0;
    var monthly = (pd.balance - pd.residual) / pd.lifespanMonths;
    return monthly / plant.targetOutput;
  }

  function utilitiesPerM3(plant) {
    if (!plant) return 0;
    return plant.targetOutput > 0 ? (plant.utilitiesMonthly || 0) / plant.targetOutput : 0;
  }

  function amortPerKm(vehicle) {
    if (!vehicle || !(vehicle.mileage > 0)) return 0;
    return (vehicle.balance - vehicle.residual) / vehicle.mileage;
  }

  // Внутренние рейсы за инертными — не покупка услуги, поэтому без НДС.
  // Возят всегда полным кузовом, поэтому грузоподъёмность берётся с карточки техники, без переопределения.
  // Амортизация тоже всегда считается с карточки техники (баланс/остаток/пробег) — не хранится отдельно,
  // чтобы не разъезжалась с реальной карточкой при её изменении.
  function aggregateDeliveryPerTrip(delivery, truck) {
    if (!delivery || !truck) return { fuel: 0, amort: 0, surcharge: 0, total: 0 };
    var roundTrip = (delivery.distanceKm || 0) * 2;
    var fuel = roundTrip * ((truck.fuelRate || 0) / 100) * (delivery.fuelPricePerLiter || 0);
    var amort = roundTrip * amortPerKm(truck);
    var surcharge = delivery.driverSurcharge || 0;
    return { fuel: fuel, amort: amort, surcharge: surcharge, total: fuel + amort + surcharge };
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
    utilitiesPerM3: utilitiesPerM3,
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
