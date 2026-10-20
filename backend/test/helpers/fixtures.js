// Минимальные данные реестра напрямую в БД — для тестов, которым нужна
// "уже существующая" заявка, без прохода через handlers/registry.js.
const { db } = require('./db');

let n = 0;

async function unit(name, hidden) {
  const id = 'punit_t' + (++n);
  await db.pool.query('INSERT INTO pay_units (id, name, hidden) VALUES ($1, $2, $3)', [id, name, Boolean(hidden)]);
  return id;
}

async function category(name, hidden) {
  const id = 'pcat_t' + (++n);
  await db.pool.query('INSERT INTO pay_categories (id, name, hidden) VALUES ($1, $2, $3)', [id, name, Boolean(hidden)]);
  return id;
}

async function rawRequest(unitId, categoryId, extra) {
  const id = 'preq_t' + (++n);
  const e = extra || {};
  await db.pool.query(
    `INSERT INTO pay_requests (id, number, unit_id, category_id, recipient, purpose, amount, decision, approved_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, 'T-' + n, unitId, categoryId, e.recipient || 'ООО "Тест"', e.purpose || 'Тест', e.amount || 1000, e.decision || null, e.approved_amount || null]
  );
  return id;
}

// ---- Клиенты и заказы (change client-list) ----
// Префиксы tplant_/trec_/tmix_ — их удаляет resetClients() в helpers/db.js.

async function plant(name) {
  const id = 'tplant_' + (++n);
  const token = 'ttoken_' + n + '_' + Date.now();
  await db.pool.query('INSERT INTO plants (id, name, access_token) VALUES ($1, $2, $3)', [id, name, token]);
  return { id, name, token };
}

async function recipe(plantId, name, salePrice) {
  const id = 'trec_' + (++n);
  await db.pool.query('INSERT INTO recipes (id, plant_id, name, sale_price) VALUES ($1, $2, $3, $4)', [id, plantId, name, salePrice]);
  return { id, name, salePrice };
}

// opts (необязательно): fuelRate (л/100км, по умолчанию 30), baselineKm —
// базовый пробег для одометра путевых листов.
async function mixer(name, capacity, opts) {
  const o = opts || {};
  const id = 'tmix_' + (++n);
  await db.pool.query(
    'INSERT INTO mixers (id, name, capacity, balance, residual, mileage, fuel_rate, odometer_baseline_km) VALUES ($1, $2, $3, 0, 0, 1, $4, $5)',
    [id, name, capacity, o.fuelRate != null ? o.fuelRate : 30, o.baselineKm || 0]
  );
  return { id, name, capacity };
}

// Клиент напрямую в БД (как "существующий до выкатки", если plantId не задан).
async function client(name, plantId, type) {
  const id = 'tcl_' + (++n);
  await db.pool.query('INSERT INTO clients (id, name, type, plant_id) VALUES ($1, $2, $3, $4)', [id, name, type || 'individual', plantId || null]);
  return { id, name };
}

// Минимальное валидное тело POST /api/orders (расчётные поля — нули, кроме
// тех, что важны для памяти/рейсов). materials: [] — бронь остатков не нужна.
function orderBody(p, c, r, m, extra) {
  const zero = {};
  for (const f of ['ureaPricePerLiter', 'ureaCostPerTrip', 'platonCostPerTrip', 'surchargePerTrip', 'roundTripKm',
    'fuelCostPerTrip', 'amortCostPerTrip', 'deliveryCostTotal', 'deliveryRevenue', 'deliveryProfit', 'deliveryMarginPercent',
    'materialsCost', 'payrollCost', 'deprCost', 'utilitiesCost', 'costPerM3', 'mixRevenue', 'mixCost', 'mixProfit',
    'mixMarginPercent', 'totalRevenue', 'totalProfit', 'profitPerM3', 'totalMarginPercent']) zero[f] = 0;
  return Object.assign(zero, {
    createdAt: new Date().toISOString(),
    plantId: p.id, plantName: p.name,
    clientId: c.id, clientName: c.name, clientType: 'individual',
    recipeId: r.id, recipeName: r.name,
    mixerId: m ? m.id : null, mixerName: m ? m.name : 'Самовывоз',
    selfPickup: !m,
    address: m ? 'ул. Ленина, 5' : '',
    saleVolume: 10, distanceKm: m ? 12 : 0, fuelPricePerLiter: 75,
    neighborCity: false, tripCount: m ? 2 : 0, deliveryChargePerM3: m ? 500 : 0,
    salePrice: r.salePrice, vatApplied: false, materials: []
  }, extra);
}

// Материал с остатком на складе (для списания по рейсам путевого листа).
async function material(plantId, name, onHand) {
  const id = 'tmat_' + (++n);
  await db.pool.query(
    "INSERT INTO materials (id, plant_id, name, unit, price, stock_on_hand) VALUES ($1, $2, $3, 'т', 9000, $4)",
    [id, plantId, name, onHand]
  );
  return { id, name };
}

// Водитель с открытым периодом работы (путевой лист требует период).
async function driver(plantId, name) {
  const id = 'temp_' + (++n);
  await db.pool.query("INSERT INTO employees (id, plant_id, name, position, salary, is_driver) VALUES ($1, $2, $3, 'Водитель', 0, TRUE)", [id, plantId, name]);
  await db.pool.query("INSERT INTO employee_work_periods (employee_id, start_date) VALUES ($1, '2020-01-01')", [id]);
  return { id, name };
}

// Запись рейса путевого листа напрямую в БД — минуя проверки лимитов
// handlers/waybill-entries.js, чтобы тест задавал ровно нужную историю
// (дата, порядок создания, ставка). orderId — любой существующий заказ
// (источник рейса обязателен по схеме). o: { date, km, trips, fuelRate,
// createdAt, price, plantId, plantName }.
async function waybillEntry(orderId, drv, veh, o) {
  const id = 'twbe_' + (++n);
  const km = o.km != null ? o.km : 50;
  const rate = o.fuelRate != null ? o.fuelRate : 40;
  const price = o.price != null ? o.price : 75;
  await db.pool.query(
    `INSERT INTO waybill_entries (id, order_id, plant_id, plant_name, trip_date, driver_id, driver_name, mixer_id, mixer_name,
       distance_km, trip_count, fuel_price_per_liter, fuel_cost_per_trip, fuel_rate, address, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ул. Ленина, 5', $15)`,
    [id, orderId, o.plantId || 'tplant_x', o.plantName || 'Тест', o.date, drv.id, drv.name, veh.id, veh.name,
      km, o.trips || 1, price, 2 * km * (rate / 100) * price, rate, o.createdAt || new Date().toISOString()]
  );
  return id;
}

module.exports = { unit, category, rawRequest, plant, recipe, mixer, client, orderBody, material, driver, waybillEntry };
