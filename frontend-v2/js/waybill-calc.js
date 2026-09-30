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

  // MAX-подсказка, общая часть (не зависит от того, заказ это или
  // поступление) — сколько рейсов реально можно назначить этой связке
  // водитель+машина+день, с учётом остатка источника и обоих бюджетов часов.
  function maxTripsGeneric(remaining, distanceKm, entries, config, driverId, mixerId, date) {
    var cfg = cfgLimits(config);
    var perTripHours = tripHours(distanceKm, cfg);
    var driverLeft = cfg.driverShiftHours - driverUsedHours(entries, config, driverId, date, null);
    var mixerLeft = cfg.vehicleShiftHours - mixerUsedHours(entries, config, mixerId, date, null);
    var maxByDriver = perTripHours > 0 ? Math.floor(driverLeft / perTripHours + 1e-9) : remaining;
    var maxByMixer = perTripHours > 0 ? Math.floor(mixerLeft / perTripHours + 1e-9) : remaining;
    return { max: Math.max(0, Math.min(remaining, maxByDriver, maxByMixer)), remaining: remaining, maxByDriver: maxByDriver, maxByMixer: maxByMixer };
  }

  // Оставлено как было (v1/mobile-waybills.js зовут именно так) — тонкая
  // обёртка над maxTripsGeneric.
  function maxTrips(order, entries, config, driverId, mixerId, date) {
    return maxTripsGeneric(remainingForOrder(entries, order), order.distanceKm, entries, config, driverId, mixerId, date);
  }

  // ---- Поступления инертных (см. handlers/waybill-entries.js::receiptId) —
  // тот же экран/форма, что и заказы (документ прямо требует "никакой
  // отдельной ветки кода на распределение"), поэтому набор функций внизу —
  // зеркало order-функций выше, а не что-то новое по сути. ----
  function entriesForReceipt(entries, receiptId) { return entries.filter(function (e) { return e.receiptId === receiptId; }); }
  function allocatedForReceipt(entries, receiptId) { return entriesForReceipt(entries, receiptId).reduce(function (s, e) { return s + e.tripCount; }, 0); }
  function remainingForReceipt(entries, receipt) { return Math.max(0, (receipt.tripCount || 0) - allocatedForReceipt(entries, receipt.id)); }
  function unallocatedReceipts(receipts, entries) {
    return (receipts || []).filter(function (r) { return !r.cancelledAt && r.tripCount > 0 && remainingForReceipt(entries, r) > 0; })
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }
  function maxTripsForReceipt(receipt, entries, config, driverId, mixerId, date) {
    return maxTripsGeneric(remainingForReceipt(entries, receipt), receipt.distanceKm, entries, config, driverId, mixerId, date);
  }

  // ---- Единая "очередь" для экрана — каждый пункт помечен kind, дальше
  // форма читает id/label/remaining/tripCount/distanceKm одинаково для
  // обоих источников. ----
  function queueItems(orders, receipts, entries) {
    var fromOrders = unallocatedOrders(orders, entries).map(function (o) {
      return { kind: 'order', id: o.id, source: o, label: o.recipeName, sub: o.address || o.plantName,
        remaining: remainingForOrder(entries, o), tripCount: o.tripCount, distanceKm: o.distanceKm, createdAt: o.createdAt };
    });
    var fromReceipts = unallocatedReceipts(receipts, entries).map(function (r) {
      // createdAt тут — дата поступления "для бухгалтерии" (r.receiptDate),
      // а не момент оформления записи в системе: это и есть смысловая дата
      // поступления, ровно как order.createdAt — смысловая дата заказа.
      return { kind: 'receipt', id: r.id, source: r, label: r.materialName + ' · ' + Format.fmtNum(r.qty, 1, r.unit),
        sub: r.plantName + ' · приход', remaining: remainingForReceipt(entries, r), tripCount: r.tripCount, distanceKm: r.distanceKm, createdAt: r.receiptDate };
    });
    return fromOrders.concat(fromReceipts).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  window.WaybillCalc = {
    cfgLimits: cfgLimits, tripHours: tripHours, entriesForOrder: entriesForOrder, allocatedForOrder: allocatedForOrder,
    remainingForOrder: remainingForOrder, deliveryOrders: deliveryOrders, unallocatedOrders: unallocatedOrders,
    driverUsedHours: driverUsedHours, mixerUsedHours: mixerUsedHours, maxTrips: maxTrips,
    entriesForReceipt: entriesForReceipt, allocatedForReceipt: allocatedForReceipt, remainingForReceipt: remainingForReceipt,
    unallocatedReceipts: unallocatedReceipts, maxTripsForReceipt: maxTripsForReceipt, queueItems: queueItems
  };
})();
