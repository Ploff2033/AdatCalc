const db = require('../db');
const HttpError = require('../http-error');
const { str } = require('../validate');

// "Другое" — упрощённая техника (погрузчики и т.п.), см. комментарий у
// other_equipment в schema.sql: только имя и гос.номер, без грузоподъёмности/
// амортизации/расхода топлива/Платона/одометра, как у mixers/aggregate-trucks
// — она не участвует в себестоимости доставки или путевых листах, нужна
// только для выбора в "Топливо" в ДДС (см. handlers/cash-entries.js).

function rowToItem(row) {
  return { id: row.id, name: row.name, licensePlate: row.license_plate || '' };
}

function sanitize(body) {
  return {
    name: str(body.name, 'name'),
    licensePlate: (body.licensePlate || '').trim()
  };
}

async function list() {
  const { rows } = await db.pool.query('SELECT * FROM other_equipment ORDER BY name');
  return rows.map(rowToItem);
}

async function create(body) {
  const f = sanitize(body);
  const id = db.genId('oeq');
  await db.pool.query(
    'INSERT INTO other_equipment (id, name, license_plate) VALUES ($1,$2,$3)',
    [id, f.name, f.licensePlate]
  );
  const { rows } = await db.pool.query('SELECT * FROM other_equipment WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function update(id, body) {
  const f = sanitize(body);
  const { rowCount } = await db.pool.query(
    'UPDATE other_equipment SET name=$2, license_plate=$3 WHERE id=$1',
    [id, f.name, f.licensePlate]
  );
  if (!rowCount) throw new HttpError(404, 'Техника не найдена');
  const { rows } = await db.pool.query('SELECT * FROM other_equipment WHERE id = $1', [id]);
  return rowToItem(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM other_equipment WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Техника не найдена');
}

module.exports = { list, create, update, remove };
