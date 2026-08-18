const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function sanitize(body) {
  return {
    name: str(body.name, 'name'),
    capacity: num(body.capacity, 'capacity'),
    balance: num(body.balance, 'balance'),
    residual: num(body.residual, 'residual'),
    mileage: num(body.mileage, 'mileage'),
    fuelRate: num(body.fuelRate, 'fuelRate')
  };
}

async function list() {
  return db.get().aggregateTrucks;
}

async function create(body) {
  const item = { id: db.genId('atr'), ...sanitize(body) };
  await db.mutate((draft) => {
    draft.aggregateTrucks.push(item);
    return draft;
  });
  return item;
}

async function update(id, body) {
  const fields = sanitize(body);
  let updated = null;
  await db.mutate((draft) => {
    const idx = draft.aggregateTrucks.findIndex((t) => t.id === id);
    if (idx === -1) throw new HttpError(404, 'Техника не найдена');
    draft.aggregateTrucks[idx] = { id, ...fields };
    updated = draft.aggregateTrucks[idx];
    return draft;
  });
  return updated;
}

async function remove(id) {
  await db.mutate((draft) => {
    const idx = draft.aggregateTrucks.findIndex((t) => t.id === id);
    if (idx === -1) throw new HttpError(404, 'Техника не найдена');
    const blocking = draft.materials.filter((m) => m.delivery && m.delivery.ownTransport && m.delivery.truckId === id);
    if (blocking.length) {
      throw new HttpError(409, 'Техника используется в доставке материалов и не может быть удалена', {
        blockingMaterials: blocking.map((m) => m.name)
      });
    }
    draft.aggregateTrucks.splice(idx, 1);
    return draft;
  });
}

module.exports = { list, create, update, remove };
