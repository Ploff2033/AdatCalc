const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

// Прицепы — тот же набор полей, что у мик­серов/инертовозов (грузоподъёмность,
// амортизация, гос.номер, гаражный номер), БЕЗ расхода топлива/мочевины/
// Платона и одометра — см. комментарий у trailers в schema.sql.

function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    capacity: Number(row.capacity),
    balance: Number(row.balance),
    residual: Number(row.residual),
    mileage: Number(row.mileage),
    licensePlate: row.license_plate || '',
    garageNumber: row.garage_number || ''
  };
}

function sanitize(body) {
  return {
    name: str(body.name, 'name'),
    capacity: num(body.capacity, 'capacity'),
    balance: num(body.balance, 'balance'),
    residual: num(body.residual, 'residual'),
    mileage: num(body.mileage, 'mileage'),
    licensePlate: (body.licensePlate || '').trim(),
    garageNumber: (body.garageNumber || '').trim()
  };
}

async function list() {
  const { rows } = await db.pool.query('SELECT * FROM trailers ORDER BY name');
  return rows.map(rowToItem);
}

async function create(body) {
  const f = sanitize(body);
  const id = db.genId('trl');
  await db.pool.query(
    'INSERT INTO trailers (id, name, capacity, balance, residual, mileage, license_plate, garage_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.licensePlate, f.garageNumber]
  );
  const { rows } = await db.pool.query('SELECT * FROM trailers WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function update(id, body) {
  const f = sanitize(body);
  const { rowCount } = await db.pool.query(
    'UPDATE trailers SET name=$2, capacity=$3, balance=$4, residual=$5, mileage=$6, license_plate=$7, garage_number=$8 WHERE id=$1',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.licensePlate, f.garageNumber]
  );
  if (!rowCount) throw new HttpError(404, 'Прицеп не найден');
  const { rows } = await db.pool.query('SELECT * FROM trailers WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM trailers WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Прицеп не найден');
}

module.exports = { list, create, update, remove };
