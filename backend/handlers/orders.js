const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const telegram = require('../telegram');

// [column, jsField] — единый источник и для INSERT, и для чтения строки обратно.
const ORDER_COLUMNS = [
  ['plant_id', 'plantId'],
  ['plant_name', 'plantName'],
  ['created_at', 'createdAt'],
  ['recipe_name', 'recipeName'],
  ['mixer_name', 'mixerName'],
  ['sale_volume', 'saleVolume'],
  ['distance_km', 'distanceKm'],
  ['fuel_price_per_liter', 'fuelPricePerLiter'],
  ['neighbor_city', 'neighborCity'],
  ['surcharge_per_trip', 'surchargePerTrip'],
  ['trip_count', 'tripCount'],
  ['round_trip_km', 'roundTripKm'],
  ['fuel_cost_per_trip', 'fuelCostPerTrip'],
  ['amort_cost_per_trip', 'amortCostPerTrip'],
  ['delivery_cost_total', 'deliveryCostTotal'],
  ['delivery_charge_per_m3', 'deliveryChargePerM3'],
  ['delivery_revenue', 'deliveryRevenue'],
  ['delivery_profit', 'deliveryProfit'],
  ['delivery_margin_percent', 'deliveryMarginPercent'],
  ['materials_cost', 'materialsCost'],
  ['payroll_cost', 'payrollCost'],
  ['depr_cost', 'deprCost'],
  ['utilities_cost', 'utilitiesCost'],
  ['cost_per_m3', 'costPerM3'],
  ['sale_price', 'salePrice'],
  ['mix_revenue', 'mixRevenue'],
  ['mix_cost', 'mixCost'],
  ['mix_profit', 'mixProfit'],
  ['mix_margin_percent', 'mixMarginPercent'],
  ['total_revenue', 'totalRevenue'],
  ['total_profit', 'totalProfit'],
  ['profit_per_m3', 'profitPerM3'],
  ['total_margin_percent', 'totalMarginPercent']
];

// Расход материалов по заказу (снимок: название/ед. на момент заказа, а не
// живая ссылка на mat_id — рецепт или материал могут потом измениться/удалиться).
function sanitizeMaterials(materials) {
  if (!Array.isArray(materials)) return [];
  return materials.map((m, i) => ({
    name: str(m && m.name, `materials[${i}].name`),
    unit: str(m && m.unit, `materials[${i}].unit`),
    qty: num(m && m.qty, `materials[${i}].qty`)
  }));
}

// Заказ — снимок расчёта с Главной на момент оформления: цены материалов,
// рецепт и т.п. могут измениться позже, но сам заказ должен остаться таким,
// каким его посчитали и отдали клиенту. Поэтому редактирования нет, только удаление.
function sanitize(body) {
  return {
    createdAt: str(body.createdAt, 'createdAt'),
    plantId: str(body.plantId, 'plantId'),
    plantName: str(body.plantName, 'plantName'),
    recipeName: str(body.recipeName, 'recipeName'),
    mixerName: str(body.mixerName, 'mixerName'),
    saleVolume: num(body.saleVolume, 'saleVolume'),
    distanceKm: num(body.distanceKm, 'distanceKm'),
    fuelPricePerLiter: num(body.fuelPricePerLiter, 'fuelPricePerLiter'),
    neighborCity: !!body.neighborCity,
    surchargePerTrip: num(body.surchargePerTrip, 'surchargePerTrip'),
    tripCount: num(body.tripCount, 'tripCount'),
    roundTripKm: num(body.roundTripKm, 'roundTripKm'),
    fuelCostPerTrip: num(body.fuelCostPerTrip, 'fuelCostPerTrip'),
    amortCostPerTrip: num(body.amortCostPerTrip, 'amortCostPerTrip'),
    deliveryCostTotal: num(body.deliveryCostTotal, 'deliveryCostTotal'),
    deliveryChargePerM3: num(body.deliveryChargePerM3, 'deliveryChargePerM3'),
    deliveryRevenue: num(body.deliveryRevenue, 'deliveryRevenue'),
    deliveryProfit: num(body.deliveryProfit, 'deliveryProfit'),
    deliveryMarginPercent: num(body.deliveryMarginPercent, 'deliveryMarginPercent'),
    materials: sanitizeMaterials(body.materials),
    materialsCost: num(body.materialsCost, 'materialsCost'),
    payrollCost: num(body.payrollCost, 'payrollCost'),
    deprCost: num(body.deprCost, 'deprCost'),
    utilitiesCost: num(body.utilitiesCost, 'utilitiesCost'),
    costPerM3: num(body.costPerM3, 'costPerM3'),
    salePrice: num(body.salePrice, 'salePrice'),
    mixRevenue: num(body.mixRevenue, 'mixRevenue'),
    mixCost: num(body.mixCost, 'mixCost'),
    mixProfit: num(body.mixProfit, 'mixProfit'),
    mixMarginPercent: num(body.mixMarginPercent, 'mixMarginPercent'),
    totalRevenue: num(body.totalRevenue, 'totalRevenue'),
    totalProfit: num(body.totalProfit, 'totalProfit'),
    profitPerM3: num(body.profitPerM3, 'profitPerM3'),
    totalMarginPercent: num(body.totalMarginPercent, 'totalMarginPercent')
  };
}

const ORDER_TEXT_COLUMNS = new Set(['plant_id', 'plant_name', 'recipe_name', 'mixer_name']);

function rowToOrder(row, materialRows) {
  const out = { id: row.id };
  for (const [col, field] of ORDER_COLUMNS) {
    const v = row[col];
    if (col === 'created_at') out[field] = new Date(v).toISOString();
    else if (col === 'neighbor_city' || ORDER_TEXT_COLUMNS.has(col)) out[field] = v;
    else out[field] = Number(v);
  }
  out.materials = materialRows.map((m) => ({ name: m.name, unit: m.unit, qty: Number(m.qty) }));
  return out;
}

async function fetchMaterials(client, orderId) {
  const { rows } = await client.query('SELECT name, unit, qty FROM order_materials WHERE order_id = $1', [orderId]);
  return rows;
}

// query.plantId задан — только заказы этого завода (для незалогиненного
// работника, привязанного к своему заводу по ссылке). Не задан — все
// (админ/менеджер видят общий список с фильтром на фронте).
async function list(query) {
  const client = await db.pool.connect();
  try {
    let rows;
    if (query && query.plantId) {
      ({ rows } = await client.query('SELECT * FROM orders WHERE plant_id = $1 ORDER BY created_at DESC', [query.plantId]));
    } else {
      ({ rows } = await client.query('SELECT * FROM orders ORDER BY created_at DESC'));
    }
    const result = [];
    for (const row of rows) result.push(rowToOrder(row, await fetchMaterials(client, row.id)));
    return result;
  } finally {
    client.release();
  }
}

async function create(body) {
  const f = sanitize(body);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const id = db.genId('ord');
    const cols = ['id', ...ORDER_COLUMNS.map((c) => c[0])];
    const values = [id, ...ORDER_COLUMNS.map((c) => f[c[1]])];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    await client.query(`INSERT INTO orders (${cols.join(',')}) VALUES (${placeholders})`, values);
    for (const m of f.materials) {
      await client.query('INSERT INTO order_materials (order_id, name, unit, qty) VALUES ($1,$2,$3,$4)', [id, m.name, m.unit, m.qty]);
    }
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    const result = rowToOrder(rows[0], f.materials);
    await client.query('COMMIT');
    telegram.notifyOrderCreated(result);
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM orders WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Заказ не найден');
}

module.exports = { list, create, remove, ORDER_COLUMNS };
