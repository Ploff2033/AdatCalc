(function () {
  var data = {
    employees: [],
    personnelSummary: { byPlant: {}, sharedTotal: 0 },
    plants: [],
    config: { fuelPriceDefault: 0, neighborCitySurcharge: 0 },
    materials: [],
    recipes: [],
    mixers: [],
    aggregateTrucks: [],
    orders: []
  };

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { fn(); }); }

  function currentPlant() {
    var id = Plant.currentPlantId();
    return data.plants.find(function (p) { return p.id === id; }) || null;
  }

  // admin/manager (залогинены) шлют ?plantId= напрямую, как раньше. Работник
  // без роли шлёт ?token= — бэкенд сам резолвит его в plantId и логирует
  // обращение (см. scopeByToken в backend/router.js). Общий токен подмены —
  // отдельный случай: он не привязан к одному заводу, поэтому вместе с
  // токеном шлём ещё и plantId (текущий выбор в переключателе заводов) —
  // бэкенд его примет, раз токен общий и действителен.
  function withPlantFilter(path) {
    var role = window.Auth ? Auth.getRole() : null;
    if (role) {
      var plantId = Plant.currentPlantId();
      return plantId ? path + '?plantId=' + encodeURIComponent(plantId) : path;
    }
    var token = Plant.currentToken();
    if (!token) return path;
    var url = path + '?token=' + encodeURIComponent(token);
    if (Plant.isUniversal()) {
      var universalPlantId = Plant.currentPlantId();
      if (universalPlantId) url += '&plantId=' + encodeURIComponent(universalPlantId);
    }
    return url;
  }

  // Некоторые ресурсы (сотрудники, а в будущем и другие) требуют роли —
  // у незалогиненного работника они отдадут 403. Promise.allSettled вместо
  // Promise.all, чтобы такой отказ не ронял загрузку всего приложения.
  //
  // Материалы/рецепты/сотрудники фильтруются по текущему заводу (?plantId=).
  // Заказы: у работника (без роли) — тоже фильтруются по его заводу (по
  // ссылке); у admin/manager — приходят все, фильтр по заводу уже на фронте.
  async function loadAll() {
    var role = window.Auth ? Auth.getRole() : null;
    var ordersPath = role ? '/orders' : withPlantFilter('/orders');

    var results = await Promise.allSettled([
      Api.get(withPlantFilter('/employees')),
      Api.get('/personnel-summary'),
      Api.get('/config'),
      Api.get(withPlantFilter('/materials')),
      Api.get(withPlantFilter('/recipes')),
      Api.get('/mixers'),
      Api.get('/aggregate-trucks'),
      Api.get(ordersPath),
      Api.get('/plants')
    ]);
    var allFailed = results.every(function (r) { return r.status === 'rejected'; });
    if (allFailed) throw results[0].reason;

    data.employees = results[0].status === 'fulfilled' ? results[0].value : [];
    data.personnelSummary = results[1].status === 'fulfilled' ? results[1].value : { byPlant: {}, sharedTotal: 0 };
    if (results[2].status === 'fulfilled') data.config = results[2].value;
    data.materials = results[3].status === 'fulfilled' ? results[3].value : [];
    data.recipes = results[4].status === 'fulfilled' ? results[4].value : [];
    data.mixers = results[5].status === 'fulfilled' ? results[5].value : [];
    data.aggregateTrucks = results[6].status === 'fulfilled' ? results[6].value : [];
    data.orders = results[7].status === 'fulfilled' ? results[7].value : [];
    data.plants = results[8].status === 'fulfilled' ? results[8].value : [];
    notify();
  }

  window.State = { data: data, loadAll: loadAll, onChange: onChange, currentPlant: currentPlant };
})();
