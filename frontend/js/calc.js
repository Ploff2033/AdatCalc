(function () {
  function payrollPerM3(data) {
    var total = data.employees.reduce(function (sum, e) { return sum + (e.salary || 0); }, 0);
    return data.config.targetOutput > 0 ? total / data.config.targetOutput : 0;
  }

  function plantDeprPerM3(config) {
    var pd = config.plantDepr;
    if (!(pd.lifespanMonths > 0) || !(config.targetOutput > 0)) return 0;
    var monthly = (pd.balance - pd.residual) / pd.lifespanMonths;
    return monthly / config.targetOutput;
  }

  function utilitiesPerM3(config) {
    return config.targetOutput > 0 ? config.utilitiesMonthly / config.targetOutput : 0;
  }

  function materialEffectivePrice(material) {
    if (!material) return 0;
    return material.price * (1 + (material.lossPercent || 0) / 100);
  }

  function materialsCostPerM3(recipe, materials) {
    if (!recipe) return 0;
    var byId = {};
    materials.forEach(function (m) { byId[m.id] = m; });
    return recipe.items.reduce(function (sum, item) {
      var mat = byId[item.materialId];
      if (!mat) return sum;
      return sum + item.qty * materialEffectivePrice(mat);
    }, 0);
  }

  function amortPerKm(mixer) {
    if (!mixer || !(mixer.mileage > 0)) return 0;
    return (mixer.balance - mixer.residual) / mixer.mileage;
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
    materialsCostPerM3: materialsCostPerM3,
    amortPerKm: amortPerKm,
    tripsForVolume: tripsForVolume,
    marginPercent: marginPercent
  };
})();
