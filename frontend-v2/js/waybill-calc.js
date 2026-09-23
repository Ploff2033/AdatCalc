(function () {
  // Единая, DOM-независимая версия лимитов путевых листов для v2 — та же
  // формула, что на бэкенде (backend/handlers/waybill-entries.js) и в v1
  // (tab-waybills.js). Десктоп (screen-waybills.js) и мобильный
  // (mobile-waybills.js) экраны вызывают одни и те же функции, чтобы не
  // разойтись в допустимом MAX рейсов.
  function cfgLimits(config) {
    var c = config || {};
    return { driverShiftHours: c.driverShiftHours || 0, vehicleShiftHours: c.vehicleShiftHours || 0, avgSpeedKmh: c.avgSpeedKmh || 0, unloadMinutes: c.unloadMinutes || 0 };
  }

  function tripHours(distanceKm, cfg) {
    var roundTrip = (distanceKm || 0) * 2;
    var drivingHours = cfg.avgSpeedKmh > 0 ? roundTrip / cfg.avgSpeedKmh : 0;
    return drivingHours + (cfg.unloadMinutes || 0) / 60;
  }

  function entriesForOrder(entries, orderId) { return entries.filter(function (e) { return e.orderId === orderId; }); }
  function allocatedForOrder(entries, orderId) { return entriesForOrder(entries, orderId).reduce(function (s, e) { return s + e.tripCount; }, 0); }
  function remainingForOrder(entries, order) { return Math.max(0, (order.tripCount || 0) - allocatedForOrder(entries, order.id)); }
  function deliveryOrders(orders) { return orders.filter(function (o) { return o.tripCount > 0; }); }
  function unallocatedOrders(orders, entries) {
    return deliveryOrders(orders).filter(function (o) { return remainingForOrder(entries, o) > 0; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  function driverUsedHours(entries, config, driverId, date, excludeId) {
    var cfg = cfgLimits(config);
    return entries.filter(function (e) { return e.driverId === driverId && e.tripDate === date && e.id !== excludeId; })
      .reduce(function (s, e) { return s + e.tripCount * tripHours(e.distanceKm, cfg); }, 0);
  }
  function mixerUsedHours(entries, config, mixerId, date, excludeId) {
    var cfg = cfgLimits(config);
    return entries.filter(function (e) { return e.mixerId === mixerId && e.tripDate === date && e.id !== excludeId; })
      .reduce(function (s, e) { return s + e.tripCount * tripHours(e.distanceKm, cfg); }, 0);
  }

  // MAX-подсказка (та же формула, что и handleMaxClick/wb-max-btn в v1 и
  // desktop-screen) — сколько рейсов реально можно назначить этой связке
  // водитель+машина+день, с учётом остатка заказа и обоих бюджетов часов.
  function maxTrips(order, entries, config, driverId, mixerId, date) {
    var cfg = cfgLimits(config);
    var perTripHours = tripHours(order.distanceKm, cfg);
    var remaining = remainingForOrder(entries, order);
    var driverLeft = cfg.driverShiftHours - driverUsedHours(entries, config, driverId, date, null);
    var mixerLeft = cfg.vehicleShiftHours - mixerUsedHours(entries, config, mixerId, date, null);
    var maxByDriver = perTripHours > 0 ? Math.floor(driverLeft / perTripHours + 1e-9) : remaining;
    var maxByMixer = perTripHours > 0 ? Math.floor(mixerLeft / perTripHours + 1e-9) : remaining;
    return { max: Math.max(0, Math.min(remaining, maxByDriver, maxByMixer)), remaining: remaining, maxByDriver: maxByDriver, maxByMixer: maxByMixer };
  }

  window.WaybillCalc = {
    cfgLimits: cfgLimits, tripHours: tripHours, entriesForOrder: entriesForOrder, allocatedForOrder: allocatedForOrder,
    remainingForOrder: remainingForOrder, deliveryOrders: deliveryOrders, unallocatedOrders: unallocatedOrders,
    driverUsedHours: driverUsedHours, mixerUsedHours: mixerUsedHours, maxTrips: maxTrips
  };
})();
