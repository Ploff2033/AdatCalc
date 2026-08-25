const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    capacity: Number(row.capacity),
    balance: Number(row.balance),
    residual: Number(row.residual),
    mileage: Number(row.mileage),
    fuelRate: Number(row.fuel_rate)
  };
}

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
  const { rows } = await db.pool.query('SELECT * FROM mixers ORDER BY name');
  return rows.map(rowToItem);
}

async function create(body) {
  const f = sanitize(body);
  const id = db.genId('mix');
  await db.pool.query(
    'INSERT INTO mixers (id, name, capacity, balance, residual, mileage, fuel_rate) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.fuelRate]
  );
  const { rows } = await db.pool.query('SELECT * FROM mixers WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function update(id, body) {
  const f = sanitize(body);
  const { rowCount } = await db.pool.query(
    'UPDATE mixers SET name=$2, capacity=$3, balance=$4, residual=$5, mileage=$6, fuel_rate=$7 WHERE id=$1',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.fuelRate]
  );
  if (!rowCount) throw new HttpError(404, 'Миксер не найден');
  const { rows } = await db.pool.query('SELECT * FROM mixers WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM mixers WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Миксер не найден');
}

module.exports = { list, create, update, remove };
