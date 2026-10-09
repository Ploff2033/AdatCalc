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
    platonRatePerKm: Number(row.platon_rate_per_km),
    licensePlate: row.license_plate || '',
    odometerBaselineKm: Number(row.odometer_baseline_km || 0),
    // Гаражный номер — внутренняя нумерация парка, отдельная от гос.номера
    // (по просьбе пользователя), см. тот же комментарий у garage_number в schema.sql.
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
    fuelRate: num(body.fuelRate, 'fuelRate'),
    ureaRate: num(body.ureaRate, 'ureaRate'),
    platonRatePerKm: num(body.platonRatePerKm, 'platonRatePerKm'),
    licensePlate: (body.licensePlate || '').trim(),
    odometerBaselineKm: num(body.odometerBaselineKm, 'odometerBaselineKm'),
    garageNumber: (body.garageNumber || '').trim()
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
    'INSERT INTO mixers (id, name, capacity, balance, residual, mileage, fuel_rate, urea_rate, platon_rate_per_km, license_plate, odometer_baseline_km, garage_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.fuelRate, f.ureaRate, f.platonRatePerKm, f.licensePlate, f.odometerBaselineKm, f.garageNumber]
  );
  const { rows } = await db.pool.query('SELECT * FROM mixers WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function update(id, body) {
  const f = sanitize(body);
  const { rowCount } = await db.pool.query(
    'UPDATE mixers SET name=$2, capacity=$3, balance=$4, residual=$5, mileage=$6, fuel_rate=$7, urea_rate=$8, platon_rate_per_km=$9, license_plate=$10, odometer_baseline_km=$11, garage_number=$12 WHERE id=$1',
    [id, f.name, f.capacity, f.balance, f.residual, f.mileage, f.fuelRate, f.ureaRate, f.platonRatePerKm, f.licensePlate, f.odometerBaselineKm, f.garageNumber]
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
