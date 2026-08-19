const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

// Заказ — снимок расчёта с Главной на момент оформления: цены материалов,
// рецепт и т.п. могут измениться позже, но сам заказ должен остаться таким,
// каким его посчитали и отдали клиенту. Поэтому редактирования нет, только удаление.
function sanitize(body) {
  return {
    createdAt: str(body.createdAt, 'createdAt'),
    recipeName: str(body.recipeName, 'recipeName'),
    mixerName: str(body.mixerName, 'mixerName'),
    saleVolume: num(body.saleVolume, 'saleVolume'),
    distanceKm: num(body.distanceKm, 'distanceKm'),
    fuelPricePerLiter: num(body.fuelPricePerLiter, 'fuelPricePerLiter'),
    neighborCity: !!body.neighborCity,
    surchargePerTrip: num(body.surchargePerTrip, 'surchargePerTrip'),
    tripCount: num(body.tripCount, 'tripCount'),
    roundTripKm: num(body.roundTripKm, 'roundTripKm'),
    fuelCostPerTrip: num(body.fuelCostPerTrip, 'fuelCostPerTrip'),
    amortCostPerTrip: num(body.amortCostPerTrip, 'amortCostPerTrip'),
    deliveryCostTotal: num(body.deliveryCostTotal, 'deliveryCostTotal'),
    deliveryChargePerM3: num(body.deliveryChargePerM3, 'deliveryChargePerM3'),
    deliveryRevenue: num(body.deliveryRevenue, 'deliveryRevenue'),
    deliveryProfit: num(body.deliveryProfit, 'deliveryProfit'),
    deliveryMarginPercent: num(body.deliveryMarginPercent, 'deliveryMarginPercent'),
    materialsCost: num(body.materialsCost, 'materialsCost'),
    payrollCost: num(body.payrollCost, 'payrollCost'),
    deprCost: num(body.deprCost, 'deprCost'),
    utilitiesCost: num(body.utilitiesCost, 'utilitiesCost'),
    costPerM3: num(body.costPerM3, 'costPerM3'),
    salePrice: num(body.salePrice, 'salePrice'),
    mixRevenue: num(body.mixRevenue, 'mixRevenue'),
    mixCost: num(body.mixCost, 'mixCost'),
    mixProfit: num(body.mixProfit, 'mixProfit'),
    mixMarginPercent: num(body.mixMarginPercent, 'mixMarginPercent'),
    totalRevenue: num(body.totalRevenue, 'totalRevenue'),
    totalProfit: num(body.totalProfit, 'totalProfit'),
    profitPerM3: num(body.profitPerM3, 'profitPerM3'),
    totalMarginPercent: num(body.totalMarginPercent, 'totalMarginPercent')
  };
}

async function list() {
  return db.get().orders;
}

async function create(body) {
  let item;
  await db.mutate((draft) => {
    item = { id: db.genId('ord'), ...sanitize(body) };
    draft.orders.unshift(item);
    return draft;
  });
  return item;
}

async function remove(id) {
  await db.mutate((draft) => {
    const idx = draft.orders.findIndex((o) => o.id === id);
    if (idx === -1) throw new HttpError(404, 'Заказ не найден');
    draft.orders.splice(idx, 1);
    return draft;
  });
}

module.exports = { list, create, remove };
