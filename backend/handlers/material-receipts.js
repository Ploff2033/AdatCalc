const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const stock = require('./stock');

// Поступление инертного материала на завод — снимок на момент оформления
// (не живая ссылка), см. подробный комментарий у CREATE TABLE material_receipts
// в schema.sql. Одна запись = один материал + один объём (как заказ на бетон).

function rowToReceipt(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    plantName: row.plant_name,
    materialId: row.material_id,
    materialName: row.material_name,
    unit: row.unit,
    qty: Number(row.qty),
    truckId: row.truck_id,
    truckName: row.truck_name,
    distanceKm: Number(row.distance_km),
    tripCount: Number(row.trip_count),
    createdAt: new Date(row.created_at).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null
  };
}

// query.plantId не задан — только у admin (полный кросс-заводской список,
// тот же принцип, что и у orders.js::list). Прочие роли без plantId
// получают пустой список.
async function list(query, role) {
  const q = query || {};
  const conditions = [];
  const params = [];
  if (q.plantId) {
    params.push(q.plantId);
    conditions.push(`plant_id = $${params.length}`);
  } else if (role !== 'admin') {
    return [];
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.pool.query(`SELECT * FROM material_receipts ${where} ORDER BY created_at DESC`, params);
  return rows.map(rowToReceipt);
}

async function create(body) {
  const plantId = str(body.plantId, 'plantId');
  const materialId = str(body.materialId, 'materialId');
  const qty = num(body.qty, 'qty');
  if (!(qty > 0)) throw new HttpError(400, 'Объём должен быть больше нуля');
  const truckId = str(body.truckId, 'truckId');
  const distanceKm = num(body.distanceKm, 'distanceKm');
  if (!(distanceKm > 0)) throw new HttpError(400, 'Расстояние должно быть больше нуля');

  const { rows: plantRows } = await db.pool.query('SELECT name FROM plants WHERE id = $1', [plantId]);
  if (!plantRows.length) throw new HttpError(400, 'Неизвестный завод');

  const { rows: matRows } = await db.pool.query('SELECT name, unit FROM materials WHERE id = $1 AND plant_id = $2', [materialId, plantId]);
  if (!matRows.length) throw new HttpError(400, 'Материал не найден на этом заводе');

  const { rows: truckRows } = await db.pool.query('SELECT name, capacity FROM aggregate_trucks WHERE id = $1', [truckId]);
  if (!truckRows.length) throw new HttpError(400, 'Техника не найдена');
  const capacity = Number(truckRows[0].capacity);
  if (!(capacity > 0)) throw new HttpError(400, 'У выбранной техники не задана грузоподъёмность');

  // Та же формула, что и Calc.tripsForVolume на фронте (см. документ:
  // "рейсов = округление_вверх(объём / грузоподъёмность_техники)").
  const tripCount = Math.max(1, Math.ceil(qty / capacity));

  const id = db.genId('rcpt');
  await db.pool.query(
    `INSERT INTO material_receipts (id, plant_id, plant_name, material_id, material_name, unit, qty, truck_id, truck_name, distance_km, trip_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, plantId, plantRows[0].name, materialId, matRows[0].name, matRows[0].unit, qty, truckId, truckRows[0].name, distanceKm, tripCount]
  );
  const { rows } = await db.pool.query('SELECT * FROM material_receipts WHERE id = $1', [id]);
  return rowToReceipt(rows[0]);
}

// Отмена — только пока по поступлению ещё не разнесено ни одного путевого
// листа (тот же принцип, что и orders.js::cancel). Бронь тут снимать
// нечего — поступления не резервируют остаток, они его создают по факту
// прихода (см. handlers/waybill-entries.js — стоимость этой записи в
// движении остатка "receipt", не "reserve").
async function cancel(id) {
  const { rows } = await db.pool.query('SELECT id, cancelled_at FROM material_receipts WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Поступление не найдено');
  if (rows[0].cancelled_at) throw new HttpError(409, 'Поступление уже отменено');
  const { rows: wbRows } = await db.pool.query('SELECT 1 FROM waybill_entries WHERE receipt_id = $1 LIMIT 1', [id]);
  if (wbRows.length) throw new HttpError(409, 'По поступлению уже разнесены путевые листы — сначала удалите их');
  await db.pool.query('UPDATE material_receipts SET cancelled_at = now() WHERE id = $1', [id]);
  const { rows: full } = await db.pool.query('SELECT * FROM material_receipts WHERE id = $1', [id]);
  return rowToReceipt(full[0]);
}

async function remove(id) {
  const { rows: wbRows } = await db.pool.query('SELECT 1 FROM waybill_entries WHERE receipt_id = $1 LIMIT 1', [id]);
  if (wbRows.length) throw new HttpError(409, 'По поступлению уже разнесены путевые листы — сначала удалите их');
  const { rowCount } = await db.pool.query('DELETE FROM material_receipts WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Поступление не найдено');
}

module.exports = { list, create, cancel, remove };
