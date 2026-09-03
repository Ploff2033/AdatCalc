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
    fuelRate: Number(row.fuel_rate),
    ureaRate: Number(row.urea_rate),
    platonRatePerKm: Number(row.platon_rate_per_km)
  };
}

function sanitize(body) {
  return {
    name: str(body.name, 'name'),
    capacity: num(body.capacity, 'capacity'),
    balance: num(body.balance, 'balance'),
    residual: num(body.residual, 'residual'),
    mileage: num(body.mileage, 'mileage'),
    fuelRate: num(body.fuelRate, 'fuelRate'),
    ureaRate: num(body.ureaRate, 'ureaRate'),
    platonRatePerKm: num(body.platonRatePerKm, 'platonRatePerKm')
  };
}

async function list() {
  const { rows } = await db.pool.query('SELECT * FROM aggregate_trucks ORDER BY name');
  return rows.map(rowToItem);
}

async function create(body) {
  const f = sanitize(body);
  const id = db.genId('atr');
  await db.pool.query(
    'INSERT INTO aggregate_trucks (id, name, capacity, balance, residual, mileage, fuel_rate, urea_rate, platon_rate_per_km) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.fuelRate, f.ureaRate, f.platonRatePerKm]
  );
  const { rows } = await db.pool.query('SELECT * FROM aggregate_trucks WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function update(id, body) {
  const f = sanitize(body);
  const { rowCount } = await db.pool.query(
    'UPDATE aggregate_trucks SET name=$2, capacity=$3, balance=$4, residual=$5, mileage=$6, fuel_rate=$7, urea_rate=$8, platon_rate_per_km=$9 WHERE id=$1',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.fuelRate, f.ureaRate, f.platonRatePerKm]
  );
  if (!rowCount) throw new HttpError(404, 'Техника не найдена');
  const { rows } = await db.pool.query('SELECT * FROM aggregate_trucks WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function remove(id) {
  const { rows: blocking } = await db.pool.query(
    'SELECT name FROM materials WHERE delivery_own_transport = TRUE AND delivery_truck_id = $1',
    [id]
  );
  if (blocking.length) {
    throw new HttpError(409, 'Техника используется в доставке материалов', {
      blockingMaterials: blocking.map((r) => r.name)
    });
  }
  const { rowCount } = await db.pool.query('DELETE FROM aggregate_trucks WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Техника не найдена');
}

module.exports = { list, create, update, remove };
