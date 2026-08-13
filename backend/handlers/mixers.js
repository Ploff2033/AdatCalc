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
    fuelRate: num(body.fuelRate, 'fuelRate'),
    maintenancePerKm: num(body.maintenancePerKm, 'maintenancePerKm')
  };
}

async function list() {
  return db.get().mixers;
}

async function create(body) {
  const item = { id: db.genId('mix'), ...sanitize(body) };
  await db.mutate((draft) => {
    draft.mixers.push(item);
    return draft;
  });
  return item;
}

async function update(id, body) {
  const fields = sanitize(body);
  let updated = null;
  await db.mutate((draft) => {
    const idx = draft.mixers.findIndex((m) => m.id === id);
    if (idx === -1) throw new HttpError(404, 'Миксер не найден');
    draft.mixers[idx] = { id, ...fields };
    updated = draft.mixers[idx];
    return draft;
  });
  return updated;
}

async function remove(id) {
  await db.mutate((draft) => {
    const idx = draft.mixers.findIndex((m) => m.id === id);
    if (idx === -1) throw new HttpError(404, 'Миксер не найден');
    draft.mixers.splice(idx, 1);
    return draft;
  });
}

module.exports = { list, create, update, remove };
