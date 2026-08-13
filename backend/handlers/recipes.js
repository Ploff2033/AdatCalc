const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function sanitizeItems(items, materials) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Рецепт должен содержать хотя бы один компонент');
  }
  const materialIds = new Set(materials.map((m) => m.id));
  return items.map((it, i) => {
    if (!it || !materialIds.has(it.materialId)) {
      throw new HttpError(400, `Неизвестный материал в строке ${i + 1}`);
    }
    return { materialId: it.materialId, qty: num(it.qty, `items[${i}].qty`) };
  });
}

async function list() {
  return db.get().recipes;
}

async function create(body) {
  let created;
  await db.mutate((draft) => {
    const name = str(body.name, 'name');
    const salePrice = num(body.salePrice, 'salePrice');
    const items = sanitizeItems(body.items, draft.materials);
    created = { id: db.genId('rec'), name, salePrice, items };
    draft.recipes.push(created);
    return draft;
  });
  return created;
}

async function update(id, body) {
  let updated = null;
  await db.mutate((draft) => {
    const idx = draft.recipes.findIndex((r) => r.id === id);
    if (idx === -1) throw new HttpError(404, 'Рецепт не найден');
    const name = str(body.name, 'name');
    const salePrice = num(body.salePrice, 'salePrice');
    const items = sanitizeItems(body.items, draft.materials);
    draft.recipes[idx] = { id, name, salePrice, items };
    updated = draft.recipes[idx];
    return draft;
  });
  return updated;
}

async function remove(id) {
  await db.mutate((draft) => {
    const idx = draft.recipes.findIndex((r) => r.id === id);
    if (idx === -1) throw new HttpError(404, 'Рецепт не найден');
    draft.recipes.splice(idx, 1);
    return draft;
  });
}

module.exports = { list, create, update, remove };
