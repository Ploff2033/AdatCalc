const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const stock = require('./stock');

function rowToMaterial(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    name: row.name,
    unit: row.unit,
    price: Number(row.price),
    lossPercent: Number(row.loss_percent),
    // on_hand/reserved — только через handlers/stock.js (reserve/writeoff/
    // release/receipt/adjustment), не через create()/update() ниже — иначе
    // лог движений (stock_movements) разойдётся с реальным остатком.
    // threshold — простая настройка, её можно менять напрямую.
    stockOnHand: Number(row.stock_on_hand),
    stockReserved: Number(row.stock_reserved),
    stockThreshold: Number(row.stock_threshold),
    delivery: {
      ownTransport: row.delivery_own_transport,
      truckId: row.delivery_truck_id,
      distanceKm: Number(row.delivery_distance_km),
      fuelPricePerLiter: Number(row.delivery_fuel_price_per_liter),
      ureaPricePerLiter: Number(row.delivery_urea_price_per_liter),
      driverSurcharge: Number(row.delivery_driver_surcharge),
      manualCostPerUnit: Number(row.delivery_manual_cost_per_unit)
    }
  };
}

async function sanitizeDelivery(client, delivery) {
  const d = delivery || {};
  const ownTransport = !!d.ownTransport;
  if (!ownTransport) {
    return {
      ownTransport: false,
      truckId: null,
      distanceKm: 0,
      fuelPricePerLiter: 0,
      ureaPricePerLiter: 0,
      driverSurcharge: 0,
      manualCostPerUnit: num(d.manualCostPerUnit, 'delivery.manualCostPerUnit')
    };
  }
  const { rows } = await client.query('SELECT id FROM aggregate_trucks WHERE id = $1', [d.truckId]);
  if (!d.truckId || !rows.length) {
    throw new HttpError(400, 'Неизвестная техника в доставке материала');
  }
  return {
    ownTransport: true,
    truckId: d.truckId,
    distanceKm: num(d.distanceKm, 'delivery.distanceKm'),
    fuelPricePerLiter: num(d.fuelPricePerLiter, 'delivery.fuelPricePerLiter'),
    ureaPricePerLiter: num(d.ureaPricePerLiter, 'delivery.ureaPricePerLiter'),
    driverSurcharge: num(d.driverSurcharge, 'delivery.driverSurcharge'),
    manualCostPerUnit: 0
  };
}

// query.plantId задан — только материалы этого завода. Не задан — все (дашборд/экспорт).
async function list(query) {
  let rows;
  if (query && query.plantId) {
    ({ rows } = await db.pool.query('SELECT * FROM materials WHERE plant_id = $1 ORDER BY name', [query.plantId]));
  } else {
    ({ rows } = await db.pool.query('SELECT * FROM materials ORDER BY name'));
  }
  return rows.map(rowToMaterial);
}

async function create(body) {
  const client = await db.pool.connect();
  try {
    const plantId = str(body.plantId, 'plantId');
    const { rows: plantRows } = await client.query('SELECT id FROM plants WHERE id = $1', [plantId]);
    if (!plantRows.length) throw new HttpError(400, 'Неизвестный завод');

    const name = str(body.name, 'name');
    const unit = str(body.unit, 'unit');
    const price = num(body.price, 'price');
    const lossPercent = num(body.lossPercent, 'lossPercent');
    const stockThreshold = body.stockThreshold !== undefined ? num(body.stockThreshold, 'stockThreshold') : 0;
    const d = await sanitizeDelivery(client, body.delivery);

    const id = db.genId('mat');
    await client.query(
      `INSERT INTO materials (id, plant_id, name, unit, price, loss_percent, delivery_own_transport, delivery_truck_id, delivery_distance_km, delivery_fuel_price_per_liter, delivery_urea_price_per_liter, delivery_driver_surcharge, delivery_manual_cost_per_unit, stock_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, plantId, name, unit, price, lossPercent, d.ownTransport, d.truckId, d.distanceKm, d.fuelPricePerLiter, d.ureaPricePerLiter, d.driverSurcharge, d.manualCostPerUnit, stockThreshold]
    );
    const { rows } = await client.query('SELECT * FROM materials WHERE id = $1', [id]);
    return rowToMaterial(rows[0]);
  } finally {
    client.release();
  }
}

async function update(id, body) {
  const client = await db.pool.connect();
  try {
    const { rows: existing } = await client.query('SELECT id, stock_threshold FROM materials WHERE id = $1', [id]);
    if (!existing.length) throw new HttpError(404, 'Материал не найден');

    const plantId = str(body.plantId, 'plantId');
    const { rows: plantRows } = await client.query('SELECT id FROM plants WHERE id = $1', [plantId]);
    if (!plantRows.length) throw new HttpError(400, 'Неизвестный завод');

    const name = str(body.name, 'name');
    const unit = str(body.unit, 'unit');
    const price = num(body.price, 'price');
    const lossPercent = num(body.lossPercent, 'lossPercent');
    const stockThreshold = body.stockThreshold !== undefined ? num(body.stockThreshold, 'stockThreshold') : Number(existing[0].stock_threshold);
    const d = await sanitizeDelivery(client, body.delivery);

    await client.query(
      `UPDATE materials SET plant_id=$2, name=$3, unit=$4, price=$5, loss_percent=$6, delivery_own_transport=$7, delivery_truck_id=$8, delivery_distance_km=$9, delivery_fuel_price_per_liter=$10, delivery_urea_price_per_liter=$11, delivery_driver_surcharge=$12, delivery_manual_cost_per_unit=$13, stock_threshold=$14
       WHERE id=$1`,
      [id, plantId, name, unit, price, lossPercent, d.ownTransport, d.truckId, d.distanceKm, d.fuelPricePerLiter, d.ureaPricePerLiter, d.driverSurcharge, d.manualCostPerUnit, stockThreshold]
    );
    const { rows } = await client.query('SELECT * FROM materials WHERE id = $1', [id]);
    return rowToMaterial(rows[0]);
  } finally {
    client.release();
  }
}

// Приход/корректировка остатка — единственный способ менять on_hand,
// кроме автоматических reserve/writeoff/release при заказах (см. комментарий
// у rowToMaterial). kind различает семантику (приход — только положительное
// число, корректировка — знаковое) в самом handlers/stock.js.
async function stockAdjustment(id, body) {
  const kind = body.kind === 'receipt' ? 'receipt' : (body.kind === 'adjustment' ? 'adjustment' : null);
  if (!kind) throw new HttpError(400, 'kind должен быть "receipt" или "adjustment"');
  const qty = num(body.qty, 'qty');
  const note = body.note ? String(body.note).trim() : null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = kind === 'receipt'
      ? await stock.receipt(client, id, qty, note)
      : await stock.adjustment(client, id, qty, note);
    if (!result) throw new HttpError(404, 'Материал не найден');
    const { rows } = await client.query('SELECT * FROM materials WHERE id = $1', [id]);
    await client.query('COMMIT');
    return rowToMaterial(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function remove(id) {
  const { rows: existing } = await db.pool.query('SELECT id FROM materials WHERE id = $1', [id]);
  if (!existing.length) throw new HttpError(404, 'Материал не найден');

  const { rows: blocking } = await db.pool.query(
    `SELECT DISTINCT r.name FROM recipe_items ri JOIN recipes r ON r.id = ri.recipe_id WHERE ri.material_id = $1`,
    [id]
  );
  if (blocking.length) {
    throw new HttpError(409, 'Материал используется в рецептах и не может быть удалён', {
      blockingRecipes: blocking.map((r) => r.name)
    });
  }
  await db.pool.query('DELETE FROM materials WHERE id = $1', [id]);
}

module.exports = { list, create, update, remove, stockAdjustment };
