(function () {
  var data = {
    employees: [],
    payrollMonthlyTotal: 0,
    config: { targetOutput: 0, plantDepr: { balance: 0, residual: 0, lifespanMonths: 0 }, utilitiesMonthly: 0, plantLocation: null, fuelPriceDefault: 0, neighborCitySurcharge: 0 },
    materials: [],
    recipes: [],
    mixers: [],
    aggregateTrucks: [],
    orders: []
  };

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { fn(); }); }

  // Некоторые ресурсы (сотрудники, а в будущем и другие) требуют роли —
  // у незалогиненного работника они отдадут 403. Promise.allSettled вместо
  // Promise.all, чтобы такой отказ не ронял загрузку всего приложения.
  async function loadAll() {
    var results = await Promise.allSettled([
      Api.get('/employees'),
      Api.get('/personnel-summary'),
      Api.get('/config'),
      Api.get('/materials'),
      Api.get('/recipes'),
      Api.get('/mixers'),
      Api.get('/aggregate-trucks'),
      Api.get('/orders')
    ]);
    var allFailed = results.every(function (r) { return r.status === 'rejected'; });
    if (allFailed) throw results[0].reason;

    data.employees = results[0].status === 'fulfilled' ? results[0].value : [];
    data.payrollMonthlyTotal = results[1].status === 'fulfilled' ? results[1].value.payrollMonthlyTotal : 0;
    if (results[2].status === 'fulfilled') data.config = results[2].value;
    data.materials = results[3].status === 'fulfilled' ? results[3].value : [];
    data.recipes = results[4].status === 'fulfilled' ? results[4].value : [];
    data.mixers = results[5].status === 'fulfilled' ? results[5].value : [];
    data.aggregateTrucks = results[6].status === 'fulfilled' ? results[6].value : [];
    data.orders = results[7].status === 'fulfilled' ? results[7].value : [];
    notify();
  }

  window.State = { data: data, loadAll: loadAll, onChange: onChange };
})();
