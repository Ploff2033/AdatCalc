const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const stock = require('./stock');

// Доля объёма заказа, которую покрывает один рейс путевого листа — заказ
// считает все рейсы равными долями (см. Calc.tripsForVolume на фронте), тот
// же принцип используется и тут для списания остатка на разнесённую часть.
async function orderMaterialsAndFraction(client, orderId, tripCount) {
  const { rows: orderRows } = await client.query('SELECT trip_count FROM orders WHERE id = $1', [orderId]);
  if (!orderRows.length || !(Number(orderRows[0].trip_count) > 0)) return { materials: [], fraction: 0 };
  const { rows: materials } = await client.query('SELECT material_id AS "materialId", qty FROM order_materials WHERE order_id = $1', [orderId]);
  return { materials, fraction: tripCount / Number(orderRows[0].trip_count) };
}

// То же самое для поступления — но поступление всегда ровно один материал +
// один объём (не список позиций рецепта, как у заказа), см. schema.sql
// material_receipts.
async function receiptMaterialAndFraction(client, receiptId, tripCount) {
  const { rows } = await client.query(
    'SELECT trip_count, material_id AS "materialId", qty FROM material_receipts WHERE id = $1',
    [receiptId]
  );
  if (!rows.length || !(Number(rows[0].trip_count) > 0)) return { materialId: null, qty: 0, fraction: 0 };
  return { materialId: rows[0].materialId, qty: Number(rows[0].qty), fraction: tripCount / Number(rows[0].trip_count) };
}

// [column, jsField] — единый источник для INSERT/UPDATE и для чтения строки
// обратно (тот же приём, что у ORDER_COLUMNS в handlers/orders.js).
// mixer_id/mixer_name/mixer_plate — общие колонки под "технику рейса":
// миксер для рейсов заказа на бетон, инертовоз (aggregate_trucks) для
// рейсов поступления инертных, см. комментарий у waybill_entries в
// schema.sql — не переименовывали, чтобы не трогать существующие записи и
// печатные формы.
const COLUMNS = [
  ['order_id', 'orderId'],
  ['receipt_id', 'receiptId'],
  ['plant_id', 'plantId'],
  ['plant_name', 'plantName'],
  ['trip_date', 'tripDate'],
  ['driver_id', 'driverId'],
  ['driver_name', 'driverName'],
  ['driver_license_number', 'driverLicenseNumber'],
  ['mixer_id', 'mixerId'],
  ['mixer_name', 'mixerName'],
  ['mixer_plate', 'mixerPlate'],
  ['distance_km', 'distanceKm'],
  ['trip_count', 'tripCount'],
  ['fuel_price_per_liter', 'fuelPricePerLiter'],
  ['fuel_cost_per_trip', 'fuelCostPerTrip'],
  ['address', 'address']
];
const NUMERIC_COLUMNS = new Set(['distance_km', 'trip_count', 'fuel_price_per_liter', 'fuel_cost_per_trip']);

function rowToEntry(row) {
  const out = { id: row.id, createdAt: new Date(row.created_at).toISOString() };
  for (const [col, field] of COLUMNS) {
    out[field] = NUMERIC_COLUMNS.has(col) ? Number(row[col]) : row[col];
  }
  return out;
}

// Время на один рейс — расстояние туда-обратно / средняя скорость + время
// разгрузки (оба параметра настраиваются в Техника → Общие). Погрузка на
// заводе отдельно не считается — предполагается пренебрежимо малой.
function tripHours(distanceKm, cfg) {
  const roundTrip = (distanceKm || 0) * 2;
  const drivingHours = cfg.avgSpeedKmh > 0 ? roundTrip / cfg.avgSpeedKmh : 0;
  return drivingHours + (cfg.unloadMinutes || 0) / 60;
}

async function getLimitsConfig() {
  const { rows } = await db.pool.query(
    'SELECT driver_shift_hours, vehicle_shift_hours, avg_speed_kmh, unload_minutes FROM config WHERE id = 1'
  );
  const row = rows[0];
  return {
    driverShiftHours: Number(row.driver_shift_hours),
    vehicleShiftHours: Number(row.vehicle_shift_hours),
    avgSpeedKmh: Number(row.avg_speed_kmh),
    unloadMinutes: Number(row.unload_minutes)
  };
}

async function list() {
  const { rows } = await db.pool.query('SELECT * FROM waybill_entries ORDER BY trip_date DESC, created_at DESC');
  return rows.map(rowToEntry);
}

async function getByIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const { rows } = await db.pool.query('SELECT * FROM waybill_entries WHERE id = ANY($1) ORDER BY trip_date, created_at', [ids]);
  return rows.map(rowToEntry);
}

function sanitize(body) {
  const hasOrder = !!body.orderId;
  const hasReceipt = !!body.receiptId;
  if (hasOrder === hasReceipt) {
    throw new HttpError(400, 'Нужно указать ровно один источник рейса — заказ или поступление');
  }
  return {
    orderId: hasOrder ? str(body.orderId, 'orderId') : null,
    receiptId: hasReceipt ? str(body.receiptId, 'receiptId') : null,
    tripDate: str(body.tripDate, 'tripDate'),
    driverId: str(body.driverId, 'driverId'),
    driverName: str(body.driverName, 'driverName'),
    driverLicenseNumber: (body.driverLicenseNumber || '').trim(),
    mixerId: str(body.mixerId, 'mixerId'),
    mixerName: str(body.mixerName, 'mixerName'),
    mixerPlate: (body.mixerPlate || '').trim(),
    distanceKm: num(body.distanceKm, 'distanceKm'),
    tripCount: num(body.tripCount, 'tripCount')
  };
}

// Дата рейса должна попасть хотя бы в один записанный период работы
// водителя — жёсткая блокировка, то же поведение, что и у дневных лимитов
// часов (не мягкое предупреждение). См. документ "AdatBeton Calc v2 —
// архитектура модулей" (обновление 30.09.2026) и решение пользователя:
// действует всегда, даже если у водителя вообще нет ни одного периода —
// тогда любая дата вне периода (что означает "любая дата вообще").
async function assertDriverWorkPeriod(client, driverId, tripDate) {
  const { rows } = await client.query(
    'SELECT 1 FROM employee_work_periods WHERE employee_id = $1 AND start_date <= $2 AND (end_date IS NULL OR end_date >= $2) LIMIT 1',
    [driverId, tripDate]
  );
  if (!rows.length) {
    throw new HttpError(400, 'Дата рейса не попадает ни в один период работы водителя — добавьте период на карточке сотрудника (Персонал)');
  }
}

// Общая проверка + сборка строки — используется и create, и update.
// excludeId исключает саму редактируемую запись из подсчёта уже занятых
// часов/рейсов (иначе редактирование конфликтовало бы само с собой).
//
// Жёсткие правила (см. обсуждение с пользователем — это не мягкие
// подсказки, а то, что реально блокирует сохранение):
// 1. Нельзя разнести больше рейсов, чем есть у источника (заказ/поступление).
// 2. Дневной бюджет времени водителя (config.driverShiftHours) — сумма по
//    ВСЕМ его записям в этот день, независимо от машины/источника.
// 3. Дневной бюджет времени машины (config.vehicleShiftHours) — аналогично,
//    независимо от того, один водитель её вёл или несколько за день, и
//    независимо от того, миксер это или инертовоз (mixer_id общая колонка).
// 4. (новое) Дата рейса — в пределах периода работы водителя.
async function validateAndBuild(client, body, excludeId) {
  const f = sanitize(body);
  if (f.tripCount <= 0) throw new HttpError(400, 'Число рейсов должно быть больше нуля');
  if (f.distanceKm <= 0) throw new HttpError(400, 'Расстояние должно быть больше нуля');

  const cfg = await getLimitsConfig();
  await assertDriverWorkPeriod(client, f.driverId, f.tripDate);

  let plantId, plantName, address, fuelRate;

  if (f.orderId) {
    const { rows: orderRows } = await client.query('SELECT id, plant_id, plant_name, trip_count, address FROM orders WHERE id = $1', [f.orderId]);
    if (!orderRows.length) throw new HttpError(400, 'Заказ не найден');
    const order = orderRows[0];

    let allocatedQuery = 'SELECT COALESCE(SUM(trip_count), 0) AS total FROM waybill_entries WHERE order_id = $1';
    const allocatedParams = [f.orderId];
    if (excludeId) { allocatedQuery += ' AND id != $2'; allocatedParams.push(excludeId); }
    const { rows: allocRows } = await client.query(allocatedQuery, allocatedParams);
    const alreadyAllocated = Number(allocRows[0].total);
    const remaining = Number(order.trip_count) - alreadyAllocated;
    if (f.tripCount > remaining + 1e-9) {
      throw new HttpError(400, `Превышено число рейсов по заказу — осталось разнести ${remaining} из ${Number(order.trip_count)}`);
    }

    plantId = order.plant_id;
    plantName = order.plant_name;
    address = order.address || '';
    const { rows: mixerCardRows } = await client.query('SELECT fuel_rate FROM mixers WHERE id = $1', [f.mixerId]);
    fuelRate = mixerCardRows.length ? Number(mixerCardRows[0].fuel_rate) : 0;
  } else {
    const { rows: receiptRows } = await client.query(
      'SELECT id, plant_id, plant_name, trip_count, cancelled_at, address FROM material_receipts WHERE id = $1',
      [f.receiptId]
    );
    if (!receiptRows.length) throw new HttpError(400, 'Поступление не найдено');
    const receiptRow = receiptRows[0];
    if (receiptRow.cancelled_at) throw new HttpError(400, 'Поступление отменено');

    let allocatedQuery = 'SELECT COALESCE(SUM(trip_count), 0) AS total FROM waybill_entries WHERE receipt_id = $1';
    const allocatedParams = [f.receiptId];
    if (excludeId) { allocatedQuery += ' AND id != $2'; allocatedParams.push(excludeId); }
    const { rows: allocRows } = await client.query(allocatedQuery, allocatedParams);
    const alreadyAllocated = Number(allocRows[0].total);
    const remaining = Number(receiptRow.trip_count) - alreadyAllocated;
    if (f.tripCount > remaining + 1e-9) {
      throw new HttpError(400, `Превышено число рейсов по поступлению — осталось разнести ${remaining} из ${Number(receiptRow.trip_count)}`);
    }

    plantId = receiptRow.plant_id;
    plantName = receiptRow.plant_name;
    // Адрес поставщика ("откуда везли") — тот же смысл для печатной формы
    // путевого листа, что и order.address ("куда везли") для заказов, см.
    // комментарий у material_receipts.address в schema.sql.
    address = receiptRow.address || '';
    const { rows: truckCardRows } = await client.query('SELECT fuel_rate FROM aggregate_trucks WHERE id = $1', [f.mixerId]);
    fuelRate = truckCardRows.length ? Number(truckCardRows[0].fuel_rate) : 0;
  }

  const thisTripHours = tripHours(f.distanceKm, cfg);
  const addedHours = f.tripCount * thisTripHours;

  let driverQuery = 'SELECT trip_count, distance_km FROM waybill_entries WHERE driver_id = $1 AND trip_date = $2';
  const driverParams = [f.driverId, f.tripDate];
  if (excludeId) { driverQuery += ' AND id != $3'; driverParams.push(excludeId); }
  const { rows: driverRows } = await client.query(driverQuery, driverParams);
  const driverUsed = driverRows.reduce((sum, r) => sum + Number(r.trip_count) * tripHours(Number(r.distance_km), cfg), 0);
  if (driverUsed + addedHours > cfg.driverShiftHours + 1e-6) {
    throw new HttpError(400, `Превышен дневной лимит водителя (${cfg.driverShiftHours} ч): уже занято ${driverUsed.toFixed(1)} ч, добавляется ещё ${addedHours.toFixed(1)} ч`);
  }

  let mixerQuery = 'SELECT trip_count, distance_km FROM waybill_entries WHERE mixer_id = $1 AND trip_date = $2';
  const mixerParams = [f.mixerId, f.tripDate];
  if (excludeId) { mixerQuery += ' AND id != $3'; mixerParams.push(excludeId); }
  const { rows: mixerRows } = await client.query(mixerQuery, mixerParams);
  const mixerUsed = mixerRows.reduce((sum, r) => sum + Number(r.trip_count) * tripHours(Number(r.distance_km), cfg), 0);
  if (mixerUsed + addedHours > cfg.vehicleShiftHours + 1e-6) {
    throw new HttpError(400, `Превышен дневной лимит машины (${cfg.vehicleShiftHours} ч): уже занято ${mixerUsed.toFixed(1)} ч, добавляется ещё ${addedHours.toFixed(1)} ч`);
  }

  const roundTrip = f.distanceKm * 2;
  const { rows: plantPriceRows } = await client.query('SELECT fuel_price FROM plants WHERE id = $1', [plantId]);
  const fuelPricePerLiter = plantPriceRows.length ? Number(plantPriceRows[0].fuel_price) : 0;
  const fuelCostPerTrip = roundTrip * (fuelRate / 100) * fuelPricePerLiter;

  return Object.assign({}, f, {
    plantId,
    plantName,
    address,
    fuelPricePerLiter,
    fuelCostPerTrip
  });
}

// Применяет эффект на остаток (списание доли заказа ИЛИ приход доли
// поступления) — общая точка для create/update/remove, чтобы не дублировать
// ветвление orderId/receiptId в трёх местах.
async function applyStockEffect(client, orderId, receiptId, tripCount, fraction, note) {
  if (orderId) {
    const effect = await orderMaterialsAndFraction(client, orderId, tripCount);
    await stock.writeoff(client, orderId, effect.materials, effect.fraction * fraction, note);
  } else {
    const effect = await receiptMaterialAndFraction(client, receiptId, tripCount);
    await stock.receiptFromWaybill(client, receiptId, effect.materialId, effect.qty, effect.fraction * fraction, note);
  }
}

async function create(body) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const f = await validateAndBuild(client, body, null);
    const id = db.genId('wbe');
    const cols = COLUMNS.map((c) => c[0]);
    const values = COLUMNS.map((c) => f[c[1]]);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
    await client.query(`INSERT INTO waybill_entries (id, ${cols.join(',')}) VALUES ($1, ${placeholders})`, [id, ...values]);
    // Эффект на остаток на долю объёма этого рейса — списание для заказа на
    // бетон, приход для поступления инертных (см. applyStockEffect выше).
    await applyStockEffect(client, f.orderId, f.receiptId, f.tripCount, 1, 'Путевой лист');
    const { rows } = await client.query('SELECT * FROM waybill_entries WHERE id = $1', [id]);
    await client.query('COMMIT');
    return rowToEntry(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(id, body) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id, order_id, receipt_id, trip_count FROM waybill_entries WHERE id = $1', [id]);
    if (!existing.length) throw new HttpError(404, 'Запись не найдена');
    const old = existing[0];
    const f = await validateAndBuild(client, body, id);
    const cols = COLUMNS.map((c) => c[0]);
    const values = COLUMNS.map((c) => f[c[1]]);
    const sets = cols.map((col, i) => `${col} = $${i + 2}`).join(',');
    await client.query(`UPDATE waybill_entries SET ${sets} WHERE id = $1`, [id, ...values]);
    // Реверс старого эффекта (со старым orderId/receiptId/tripCount —
    // источник мог тоже поменяться), затем новый — симметрично create()/remove().
    await applyStockEffect(client, old.order_id, old.receipt_id, Number(old.trip_count), -1, 'Путевой лист (изменение)');
    await applyStockEffect(client, f.orderId, f.receiptId, f.tripCount, 1, 'Путевой лист (изменение)');
    const { rows } = await client.query('SELECT * FROM waybill_entries WHERE id = $1', [id]);
    await client.query('COMMIT');
    return rowToEntry(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function remove(id) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT order_id, receipt_id, trip_count FROM waybill_entries WHERE id = $1', [id]);
    if (!rows.length) throw new HttpError(404, 'Запись не найдена');
    await client.query('DELETE FROM waybill_entries WHERE id = $1', [id]);
    await applyStockEffect(client, rows[0].order_id, rows[0].receipt_id, Number(rows[0].trip_count), -1, 'Удаление записи путевого листа');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { list, create, update, remove, getByIds, tripHours, getLimitsConfig };
