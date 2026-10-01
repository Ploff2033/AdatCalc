const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function rowToEmployee(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    name: row.name,
    position: row.position,
    salary: Number(row.salary),
    isDriver: !!row.is_driver,
    licenseNumber: row.license_number || ''
  };
}

// Для выбора водителя на Главной (доступно менеджеру и работнику по
// ссылке) — ФИО, номер удостоверения (нужен путевому листу) и отметка
// "водитель", без должности/оклада: это чувствительные данные, которые
// видит только админ (см. read:'admin' в старой версии этого списка и
// ветку ниже).
function rowToDriverOption(row) {
  return { id: row.id, plantId: row.plant_id, name: row.name, licenseNumber: row.license_number || '', isDriver: true };
}

async function validatePlantId(plantId) {
  if (!plantId) return null;
  const { rows } = await db.pool.query('SELECT id FROM plants WHERE id = $1', [plantId]);
  if (!rows.length) throw new HttpError(400, 'Неизвестный завод');
  return plantId;
}

// admin — полный список (query.plantId задан — сотрудники этого завода +
// общие; не задан — все, для дашборда). Менеджер/работник (по ссылке) —
// только отмеченные "водитель" сотрудники своего завода, без зарплат.
async function list(query, role) {
  if (role === 'admin') {
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

  if (!query || !query.plantId) return [];
  const { rows } = await db.pool.query(
    'SELECT id, plant_id, name, license_number FROM employees WHERE is_driver = TRUE AND (plant_id = $1 OR plant_id IS NULL) ORDER BY name',
    [query.plantId]
  );
  return rows.map(rowToDriverOption);
}

async function create(body) {
  const name = str(body.name, 'name');
  const position = str(body.position, 'position');
  const salary = num(body.salary, 'salary');
  const plantId = await validatePlantId(body.plantId || null);
  const isDriver = !!body.isDriver;
  const licenseNumber = (body.licenseNumber || '').trim();

  const id = db.genId('emp');
  await db.pool.query(
    'INSERT INTO employees (id, plant_id, name, position, salary, is_driver, license_number) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, plantId, name, position, salary, isDriver, licenseNumber]
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
  const isDriver = !!body.isDriver;
  const licenseNumber = (body.licenseNumber || '').trim();

  await db.pool.query(
    'UPDATE employees SET name=$2, position=$3, salary=$4, plant_id=$5, is_driver=$6, license_number=$7 WHERE id=$1',
    [id, name, position, salary, plantId, isDriver, licenseNumber]
  );
  const { rows } = await db.pool.query('SELECT * FROM employees WHERE id = $1', [id]);
  return rowToEmployee(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM employees WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Сотрудник не найден');
}

module.exports = { list, create, update, remove };
