const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

async function rowToRecipe(client, row) {
  const { rows: items } = await client.query(
    'SELECT material_id, qty FROM recipe_items WHERE recipe_id = $1 ORDER BY position',
    [row.id]
  );
  return {
    id: row.id,
    plantId: row.plant_id,
    name: row.name,
    salePrice: Number(row.sale_price),
    items: items.map((it) => ({ materialId: it.material_id, qty: Number(it.qty) }))
  };
}

async function validateItems(client, items, plantId) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Рецепт должен содержать хотя бы один компонент');
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || !it.materialId) throw new HttpError(400, `Неизвестный материал в строке ${i + 1}`);
    const { rows } = await client.query('SELECT id, name, plant_id FROM materials WHERE id = $1', [it.materialId]);
    if (!rows.length) throw new HttpError(400, `Неизвестный материал в строке ${i + 1}`);
    if (rows[0].plant_id !== plantId) {
      throw new HttpError(400, `Материал «${rows[0].name}» принадлежит другому заводу`);
    }
    out.push({ materialId: it.materialId, qty: num(it.qty, `items[${i}].qty`) });
  }
  return out;
}

// query.plantId задан — только рецепты этого завода. Не задан — все (дашборд/экспорт).
async function list(query) {
  const client = await db.pool.connect();
  try {
    let rows;
    if (query && query.plantId) {
      ({ rows } = await client.query('SELECT * FROM recipes WHERE plant_id = $1 ORDER BY name', [query.plantId]));
    } else {
      ({ rows } = await client.query('SELECT * FROM recipes ORDER BY name'));
    }
    const result = [];
    for (const row of rows) result.push(await rowToRecipe(client, row));
    return result;
  } finally {
    client.release();
  }
}

async function create(body) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const plantId = str(body.plantId, 'plantId');
    const { rows: plantRows } = await client.query('SELECT id FROM plants WHERE id = $1', [plantId]);
    if (!plantRows.length) throw new HttpError(400, 'Неизвестный завод');

    const name = str(body.name, 'name');
    const salePrice = num(body.salePrice, 'salePrice');
    const items = await validateItems(client, body.items, plantId);

    const id = db.genId('rec');
    await client.query('INSERT INTO recipes (id, plant_id, name, sale_price) VALUES ($1,$2,$3,$4)', [id, plantId, name, salePrice]);
    for (let i = 0; i < items.length; i++) {
      await client.query(
        'INSERT INTO recipe_items (recipe_id, material_id, qty, position) VALUES ($1,$2,$3,$4)',
        [id, items[i].materialId, items[i].qty, i]
      );
    }
    const { rows } = await client.query('SELECT * FROM recipes WHERE id = $1', [id]);
    const result = await rowToRecipe(client, rows[0]);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Завод рецепта не меняется через update (как и раньше) — берём из существующей записи.
async function update(id, body) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT * FROM recipes WHERE id = $1', [id]);
    if (!existing.length) throw new HttpError(404, 'Рецепт не найден');
    const plantId = existing[0].plant_id;

    const name = str(body.name, 'name');
    const salePrice = num(body.salePrice, 'salePrice');
    const items = await validateItems(client, body.items, plantId);

    await client.query('UPDATE recipes SET name=$2, sale_price=$3 WHERE id=$1', [id, name, salePrice]);
    await client.query('DELETE FROM recipe_items WHERE recipe_id = $1', [id]);
    for (let i = 0; i < items.length; i++) {
      await client.query(
        'INSERT INTO recipe_items (recipe_id, material_id, qty, position) VALUES ($1,$2,$3,$4)',
        [id, items[i].materialId, items[i].qty, i]
      );
    }
    const { rows } = await client.query('SELECT * FROM recipes WHERE id = $1', [id]);
    const result = await rowToRecipe(client, rows[0]);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM recipes WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Рецепт не найден');
}

module.exports = { list, create, update, remove };
