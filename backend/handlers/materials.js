const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function sanitizeDelivery(delivery, trucks) {
  const d = delivery || {};
  const ownTransport = !!d.ownTransport;
  if (!ownTransport) {
    return {
      ownTransport: false,
      truckId: null,
      distanceKm: 0,
      fuelPricePerLiter: 0,
      driverSurcharge: 0,
      amortRatePerKm: 0,
      manualCostPerUnit: num(d.manualCostPerUnit, 'delivery.manualCostPerUnit')
    };
  }
  if (!d.truckId || !trucks.some((t) => t.id === d.truckId)) {
    throw new HttpError(400, 'Неизвестная техника в доставке материала');
  }
  return {
    ownTransport: true,
    truckId: d.truckId,
    distanceKm: num(d.distanceKm, 'delivery.distanceKm'),
    fuelPricePerLiter: num(d.fuelPricePerLiter, 'delivery.fuelPricePerLiter'),
    driverSurcharge: num(d.driverSurcharge, 'delivery.driverSurcharge'),
    amortRatePerKm: num(d.amortRatePerKm, 'delivery.amortRatePerKm'),
    manualCostPerUnit: 0
  };
}

function sanitize(body, trucks) {
  return {
    name: str(body.name, 'name'),
    unit: str(body.unit, 'unit'),
    price: num(body.price, 'price'),
    lossPercent: num(body.lossPercent, 'lossPercent'),
    delivery: sanitizeDelivery(body.delivery, trucks)
  };
}

async function list() {
  return db.get().materials;
}

async function create(body) {
  let item;
  await db.mutate((draft) => {
    item = { id: db.genId('mat'), ...sanitize(body, draft.aggregateTrucks) };
    draft.materials.push(item);
    return draft;
  });
  return item;
}

async function update(id, body) {
  let updated = null;
  await db.mutate((draft) => {
    const idx = draft.materials.findIndex((m) => m.id === id);
    if (idx === -1) throw new HttpError(404, 'Материал не найден');
    const fields = sanitize(body, draft.aggregateTrucks);
    draft.materials[idx] = { id, ...fields };
    updated = draft.materials[idx];
    return draft;
  });
  return updated;
}

async function remove(id) {
  await db.mutate((draft) => {
    const idx = draft.materials.findIndex((m) => m.id === id);
    if (idx === -1) throw new HttpError(404, 'Материал не найден');
    const blocking = draft.recipes.filter((r) => r.items.some((it) => it.materialId === id));
    if (blocking.length) {
      throw new HttpError(409, 'Материал используется в рецептах и не может быть удалён', {
        blockingRecipes: blocking.map((r) => r.name)
      });
    }
    draft.materials.splice(idx, 1);
    return draft;
  });
}

module.exports = { list, create, update, remove };
