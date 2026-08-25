const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function rowToEmployee(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    name: row.name,
    position: row.position,
    salary: Number(row.salary)
  };
}

async function validatePlantId(plantId) {
  if (!plantId) return null;
  const { rows } = await db.pool.query('SELECT id FROM plants WHERE id = $1', [plantId]);
  if (!rows.length) throw new HttpError(400, 'Неизвестный завод');
  return plantId;
}

// query.plantId задан — сотрудники этого завода + общие (plant_id IS NULL).
// Не задан — все (для дашборда).
async function list(query) {
  let rows;
  if (query && query.plantId) {
    ({ rows } = await db.pool.query(
      'SELECT * FROM employees WHERE plant_id = $1 OR plant_id IS NULL ORDER BY name',
      [query.plantId]
    ));
  } else {
    ({ rows } = await db.pool.query('SELECT * FROM employees ORDER BY name'));
  }
  return rows.map(rowToEmployee);
}

async function create(body) {
  const name = str(body.name, 'name');
  const position = str(body.position, 'position');
  const salary = num(body.salary, 'salary');
  const plantId = await validatePlantId(body.plantId || null);

  const id = db.genId('emp');
  await db.pool.query(
    'INSERT INTO employees (id, plant_id, name, position, salary) VALUES ($1,$2,$3,$4,$5)',
    [id, plantId, name, position, salary]
  );
  const { rows } = await db.pool.query('SELECT * FROM employees WHERE id = $1', [id]);
  return rowToEmployee(rows[0]);
}

async function update(id, body) {
  const { rows: existing } = await db.pool.query('SELECT id FROM employees WHERE id = $1', [id]);
  if (!existing.length) throw new HttpError(404, 'Сотрудник не найден');

  const name = str(body.name, 'name');
  const position = str(body.position, 'position');
  const salary = num(body.salary, 'salary');
  const plantId = await validatePlantId(body.plantId || null);

  await db.pool.query(
    'UPDATE employees SET name=$2, position=$3, salary=$4, plant_id=$5 WHERE id=$1',
    [id, name, position, salary, plantId]
  );
  const { rows } = await db.pool.query('SELECT * FROM employees WHERE id = $1', [id]);
  return rowToEmployee(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM employees WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Сотрудник не найден');
}

module.exports = { list, create, update, remove };
