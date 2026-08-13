(function () {
  var data = {
    employees: [],
    config: { targetOutput: 0, plantDepr: { balance: 0, residual: 0, lifespanMonths: 0 }, utilitiesMonthly: 0, plantLocation: null },
    materials: [],
    recipes: [],
    mixers: []
  };

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { fn(); }); }

  async function loadAll() {
    var results = await Promise.all([
      Api.get('/employees'),
      Api.get('/config'),
      Api.get('/materials'),
      Api.get('/recipes'),
      Api.get('/mixers')
    ]);
    data.employees = results[0];
    data.config = results[1];
    data.materials = results[2];
    data.recipes = results[3];
    data.mixers = results[4];
    notify();
  }

  window.State = { data: data, loadAll: loadAll, onChange: onChange };
})();
