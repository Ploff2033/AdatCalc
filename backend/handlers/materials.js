const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function sanitize(body) {
  return {
    name: str(body.name, 'name'),
    unit: str(body.unit, 'unit'),
    price: num(body.price, 'price'),
    lossPercent: num(body.lossPercent, 'lossPercent')
  };
}

async function list() {
  return db.get().materials;
}

async function create(body) {
  const item = { id: db.genId('mat'), ...sanitize(body) };
  await db.mutate((draft) => {
    draft.materials.push(item);
    return draft;
  });
  return item;
}

async function update(id, body) {
  const fields = sanitize(body);
  let updated = null;
  await db.mutate((draft) => {
    const idx = draft.materials.findIndex((m) => m.id === id);
    if (idx === -1) throw new HttpError(404, 'Материал не найден');
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
