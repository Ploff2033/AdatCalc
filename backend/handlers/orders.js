const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const telegram = require('../telegram');
const stock = require('./stock');

// [column, jsField] — единый источник и для INSERT, и для чтения строки обратно.
const ORDER_COLUMNS = [
  ['plant_id', 'plantId'],
  ['plant_name', 'plantName'],
  ['client_id', 'clientId'],
  ['client_name', 'clientName'],
  ['client_type', 'clientType'],
  ['created_at', 'createdAt'],
  ['recipe_name', 'recipeName'],
  ['mixer_name', 'mixerName'],
  ['mixer_plate', 'mixerPlate'],
  ['driver_name', 'driverName'],
  ['driver_license_number', 'driverLicenseNumber'],
  ['address', 'address'],
  ['sale_volume', 'saleVolume'],
  ['distance_km', 'distanceKm'],
  ['fuel_price_per_liter', 'fuelPricePerLiter'],
  ['urea_price_per_liter', 'ureaPricePerLiter'],
  ['urea_cost_per_trip', 'ureaCostPerTrip'],
  ['platon_cost_per_trip', 'platonCostPerTrip'],
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
  ['total_margin_percent', 'totalMarginPercent'],
  ['vat_applied', 'vatApplied'],
  ['ship_date', 'shipDate']
];

// Расход материалов по заказу (снимок: название/ед. на момент заказа, а не
// живая ссылка на mat_id — рецепт или материал могут потом измениться/удалиться).
// materialId — опциональный (может отсутствовать у совсем старых клиентов),
// но именно по нему handlers/stock.js бронирует/списывает остаток; без него
// позиция просто не участвует в остатках (см. schema.sql).
function sanitizeMaterials(materials) {
  if (!Array.isArray(materials)) return [];
  return materials.map((m, i) => ({
    name: str(m && m.name, `materials[${i}].name`),
    unit: str(m && m.unit, `materials[${i}].unit`),
    qty: num(m && m.qty, `materials[${i}].qty`),
    materialId: (m && m.materialId) ? String(m.materialId) : null
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
    // Клиент обязателен для новых заказов (модуль от 25.09.2026, см.
    // schema.sql) — clientId проверяется на существование ниже, в create(),
    // а не здесь, потому что это уже требует запроса к БД, а sanitize() —
    // чисто синхронная валидация формы.
    clientId: str(body.clientId, 'clientId'),
    clientName: str(body.clientName, 'clientName'),
    clientType: body.clientType === 'legal' ? 'legal' : 'individual',
    recipeName: str(body.recipeName, 'recipeName'),
    mixerName: str(body.mixerName, 'mixerName'),
    mixerPlate: (body.mixerPlate || '').trim(),
    driverName: (body.driverName || '').trim(),
    driverLicenseNumber: (body.driverLicenseNumber || '').trim(),
    address: (body.address || '').trim(),
    saleVolume: num(body.saleVolume, 'saleVolume'),
    distanceKm: num(body.distanceKm, 'distanceKm'),
    fuelPricePerLiter: num(body.fuelPricePerLiter, 'fuelPricePerLiter'),
    ureaPricePerLiter: num(body.ureaPricePerLiter, 'ureaPricePerLiter'),
    ureaCostPerTrip: num(body.ureaCostPerTrip, 'ureaCostPerTrip'),
    platonCostPerTrip: num(body.platonCostPerTrip, 'platonCostPerTrip'),
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
    totalMarginPercent: num(body.totalMarginPercent, 'totalMarginPercent'),
    vatApplied: !!body.vatApplied,
    // Опциональна — старые клиенты (или заказ без выбранной даты отгрузки)
    // её не присылают, тогда в БД остаётся NULL.
    shipDate: body.shipDate ? str(body.shipDate, 'shipDate') : null
  };
}

// Обнаружено между делом при проверке Фазы 2: 'address' сюда не попадал —
// адрес доставки читался как Number(v), т.е. NaN у любого реального адреса
// (NaN — falsy, поэтому `order.address ? ... : ''` во фронтенде просто
// молча скрывал адрес, а не показывал "NaN"). Заказы БЕЗ адреса — те же
// самые '' → Number('')=0, тоже falsy — оттого баг был не видно на глаз.
const ORDER_TEXT_COLUMNS = new Set(['plant_id', 'plant_name', 'client_id', 'client_name', 'client_type', 'recipe_name', 'mixer_name', 'mixer_plate', 'driver_name', 'driver_license_number', 'address']);

function rowToOrder(row, materialRows) {
  const out = { id: row.id };
  for (const [col, field] of ORDER_COLUMNS) {
    const v = row[col];
    if (col === 'created_at') out[field] = new Date(v).toISOString();
    // ship_date — DATE, не TIMESTAMPTZ: pg уже отдаёт его строкой
    // 'YYYY-MM-DD' (см. types.setTypeParser в db.js) — просто пропускаем
    // как есть, Number(v) тут было бы неверно (Number(null)=0, а не "нет даты").
    else if (col === 'ship_date') out[field] = v || null;
    else if (col === 'neighbor_city' || col === 'vat_applied' || ORDER_TEXT_COLUMNS.has(col)) out[field] = v;
    else out[field] = Number(v);
  }
  // cancelled_at не входит в ORDER_COLUMNS (не участвует в INSERT при
  // создании заказа — проставляется только позже, через cancel()).
  out.cancelledAt = row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null;
  out.materials = materialRows.map((m) => ({ name: m.name, unit: m.unit, qty: Number(m.qty), materialId: m.material_id }));
  return out;
}

async function fetchMaterials(client, orderId) {
  const { rows } = await client.query('SELECT name, unit, qty, material_id FROM order_materials WHERE order_id = $1', [orderId]);
  return rows;
}

// query.plantId задан — только заказы этого завода (для незалогиненного
// работника, привязанного к своему заводу по ссылке). Не задан — все
// (админ/менеджер видят общий список с фильтром на фронте).
//
// Работник (role falsy — анонимный доступ по токену) видит только заказы
// ЗА ТЕКУЩУЮ НЕДЕЛЮ (с понедельника): вся история заказов завода —
// коммерческая информация, которая не должна быть доступна просто по
// ссылке, но недели достаточно, чтобы проверить недавние заказы и не
// задублировать (раньше был день — не хватало, чтобы свериться с вчера/
// позавчера). Ограничение проверяется здесь, на бэкенде, а не только
// скрытием в интерфейсе — иначе достаточно дёрнуть API напрямую, чтобы
// получить всю историю.
async function list(query, role) {
  const client = await db.pool.connect();
  try {
    const conditions = [];
    const params = [];
    if (query && query.plantId) {
      params.push(query.plantId);
      conditions.push(`plant_id = $${params.length}`);
    }
    if (!role) {
      // Раньше — "с начала ТЕКУЩЕЙ календарной недели" (date_trunc('week', …)):
      // граница обнулялась каждый понедельник, и работник, зашедший в
      // понедельник утром, разом терял видимость заказов за всё воскресенье
      // (и вообще всю прошлую неделю) — "не видит уже заполненных заказов",
      // реальный баг, найден пользователем. Скользящее окно "последние 7
      // дней" не привязано к границе недели и не проседает так резко.
      conditions.push(`created_at >= now() - interval '7 days'`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, params);
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
    const { rows: clientRows } = await client.query('SELECT id FROM clients WHERE id = $1', [f.clientId]);
    if (!clientRows.length) throw new HttpError(400, 'Неизвестный клиент');
    const id = db.genId('ord');
    const cols = ['id', ...ORDER_COLUMNS.map((c) => c[0])];
    const values = [id, ...ORDER_COLUMNS.map((c) => f[c[1]])];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    await client.query(`INSERT INTO orders (${cols.join(',')}) VALUES (${placeholders})`, values);
    for (const m of f.materials) {
      await client.query('INSERT INTO order_materials (order_id, name, unit, qty, material_id) VALUES ($1,$2,$3,$4,$5)', [id, m.name, m.unit, m.qty, m.materialId]);
    }
    // Бронь остатков — в той же транзакции, что и сам заказ: если бронь не
    // удалась (например гонка с одновременным удалением материала), заказ
    // тоже не создастся, а не повиснет наполовину оформленным.
    await stock.reserve(client, id, f.materials.map((m) => ({ materialId: m.materialId, qty: m.qty })));
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    const result = rowToOrder(rows[0], f.materials.map((m) => ({ name: m.name, unit: m.unit, qty: m.qty, material_id: m.materialId })));
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

// Полное удаление — теперь только admin (см. router.js). Снимает ещё не
// списанную бронь ПЕРЕД удалением строки заказа (release() читает историю
// по order_id — должна успеть отработать, пока заказ ещё существует), чтобы
// бронь не повисла, если админ удалил заказ, не отменив его сначала.
// release() идемпотентен: если заказ уже был отменён — просто найдёт 0.
async function remove(id) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM orders WHERE id = $1', [id]);
    if (!rows.length) throw new HttpError(404, 'Заказ не найден');
    await stock.release(client, id, 'Удаление заказа');
    await client.query('DELETE FROM orders WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Отмена — в отличие от remove() заказ остаётся в истории (только
// cancelled_at), доступна менеджеру и выше (не только admin), и только пока
// по заказу нет путевых листов — если рейсы уже начали возить, отменять
// поздно, сначала нужно разобраться с уже выехавшими машинами вручную.
async function cancel(id) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, cancelled_at FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Заказ не найден');
    if (rows[0].cancelled_at) throw new HttpError(409, 'Заказ уже отменён');
    const { rows: wbRows } = await client.query('SELECT 1 FROM waybill_entries WHERE order_id = $1 LIMIT 1', [id]);
    if (wbRows.length) throw new HttpError(409, 'По заказу уже есть путевые листы — отменить нельзя');
    await stock.release(client, id, 'Отмена заказа');
    await client.query('UPDATE orders SET cancelled_at = now() WHERE id = $1', [id]);
    const { rows: full } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    const result = rowToOrder(full[0], await fetchMaterials(client, id));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Дата и завод — единственные поля уже оформленного заказа, которые можно
// поменять (остальное — неизменяемый снимок расчёта, см. sanitize() выше).
// Нужно на случай, если заказ завели не на тот завод: раньше его приходилось
// удалять и заводить заново на верном заводе, из-за чего терялась исходная
// дата/время — теперь и то, и другое можно поправить прямо в заказе.
async function updateDate(id, createdAtRaw, plantIdRaw) {
  const createdAt = str(createdAtRaw, 'createdAt');
  const client = await db.pool.connect();
  try {
    let plantName;
    if (plantIdRaw != null) {
      const plantId = str(plantIdRaw, 'plantId');
      const { rows: plantRows } = await client.query('SELECT name FROM plants WHERE id = $1', [plantId]);
      if (!plantRows.length) throw new HttpError(400, 'Завод не найден');
      plantName = plantRows[0].name;
      const { rowCount } = await client.query(
        'UPDATE orders SET created_at = $1, plant_id = $2, plant_name = $3 WHERE id = $4',
        [createdAt, plantId, plantName, id]
      );
      if (!rowCount) throw new HttpError(404, 'Заказ не найден');
    } else {
      const { rowCount } = await client.query('UPDATE orders SET created_at = $1 WHERE id = $2', [createdAt, id]);
      if (!rowCount) throw new HttpError(404, 'Заказ не найден');
    }
    const { rows: full } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (!full.length) throw new HttpError(404, 'Заказ не найден');
    return rowToOrder(full[0], await fetchMaterials(client, id));
  } finally {
    client.release();
  }
}

// Для печати путевых листов — сколько угодно заказов по их id одним запросом.
async function getByIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = ANY($1) ORDER BY created_at', [ids]);
    const result = [];
    for (const row of rows) result.push(rowToOrder(row, await fetchMaterials(client, row.id)));
    return result;
  } finally {
    client.release();
  }
}

module.exports = { list, create, remove, cancel, updateDate, getByIds, ORDER_COLUMNS };
