const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const telegram = require('../telegram');
const stock = require('./stock');
const clients = require('./clients');
const { diffOrder, profitLine, actorLabel } = require('../order-edit-diff');

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
  ['ship_date', 'shipDate'],
  // Снимок ограниченной загрузки миксера (change client-list) — NULL, если
  // рейсы посчитаны по полной вместимости.
  ['max_load_m3', 'maxLoadM3'],
  // Снимки ссылок на рецепт/миксер (change order-edit) — форма исправления
  // находит по ним рецепт и миксер; у старых заказов NULL, ищем по названию.
  ['recipe_id', 'recipeId'],
  ['mixer_id', 'mixerId'],
  // Режим доставки и ставка найма (change order-hired-delivery): own /
  // pickup / hired; ставка — только у hired, у остальных NULL.
  ['delivery_mode', 'deliveryMode'],
  ['hire_rate_per_m3', 'hireRatePerM3']
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
// каким его посчитали и отдали клиенту. Исправить ошибку ввода можно через
// update() ниже (change order-edit) — тот же снимок, посчитанный заново,
// с журналом правок.
function sanitize(body) {
  const f = {
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
    shipDate: body.shipDate ? str(body.shipDate, 'shipDate') : null,
    maxLoadM3: sanitizeMaxLoad(body.maxLoadM3),
    // Только для памяти клиента (clients.applyOrder), в orders не пишутся.
    // undefined у recipeId/mixerId — старое тело (закэшированный фронтенд):
    // цена и миксер в память тогда не попадают. Режим доставки без явного
    // поля — по прежнему признаку самовывоза (см. sanitizeDeliveryMode).
    recipeId: body.recipeId ? String(body.recipeId) : undefined,
    mixerId: body.mixerId === undefined ? undefined : (body.mixerId ? String(body.mixerId) : null),
    deliveryMode: sanitizeDeliveryMode(body),
    hireRatePerM3: null
  };
  // Наёмный заказ (change order-hired-delivery): ставка обязательна, рейсов
  // нет — иначе заказ попал бы в разнесение по путевым листам. Миксера и
  // ограничения загрузки у него нет.
  if (f.deliveryMode === 'hired') {
    const rate = Number(body.hireRatePerM3);
    if (!(rate > 0)) throw new HttpError(400, 'Укажите ставку найма');
    if (f.tripCount !== 0) throw new HttpError(400, 'У заказа на наёмной технике не может быть рейсов');
    f.hireRatePerM3 = rate;
    f.mixerId = f.mixerId === undefined ? undefined : null;
    f.maxLoadM3 = null;
  }
  // Для памяти клиента (clients.applyOrder) — самовывоз выводится из режима.
  f.selfPickup = f.deliveryMode === 'pickup';
  return f;
}

const DELIVERY_MODES = new Set(['own', 'pickup', 'hired']);
const SELF_PICKUP = 'Самовывоз';
const HIRED = 'Найм';

// Явный режим из тела; у старого тела (закэшированный фронтенд) режима нет —
// выводим из прежнего признака selfPickup или снимка mixerName.
function sanitizeDeliveryMode(body) {
  if (body.deliveryMode !== undefined && body.deliveryMode !== null) {
    if (!DELIVERY_MODES.has(body.deliveryMode)) throw new HttpError(400, 'Неизвестный режим доставки');
    return body.deliveryMode;
  }
  if (body.selfPickup !== undefined) return body.selfPickup ? 'pickup' : 'own';
  if (body.mixerName === SELF_PICKUP) return 'pickup';
  if (body.mixerName === HIRED) return 'hired';
  return 'own';
}

function sanitizeMaxLoad(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = num(value, 'maxLoadM3');
  if (!(n > 0)) throw new HttpError(400, 'Поле "maxLoadM3" должно быть больше нуля');
  return n;
}

// Обнаружено между делом при проверке Фазы 2: 'address' сюда не попадал —
// адрес доставки читался как Number(v), т.е. NaN у любого реального адреса
// (NaN — falsy, поэтому `order.address ? ... : ''` во фронтенде просто
// молча скрывал адрес, а не показывал "NaN"). Заказы БЕЗ адреса — те же
// самые '' → Number('')=0, тоже falsy — оттого баг был не видно на глаз.
const ORDER_TEXT_COLUMNS = new Set(['plant_id', 'plant_name', 'client_id', 'client_name', 'client_type', 'recipe_name', 'mixer_name', 'mixer_plate', 'driver_name', 'driver_license_number', 'address', 'recipe_id', 'mixer_id', 'delivery_mode']);

function rowToOrder(row, materialRows) {
  const out = { id: row.id };
  for (const [col, field] of ORDER_COLUMNS) {
    const v = row[col];
    if (col === 'created_at') out[field] = new Date(v).toISOString();
    // ship_date — DATE, не TIMESTAMPTZ: pg уже отдаёт его строкой
    // 'YYYY-MM-DD' (см. types.setTypeParser в db.js) — просто пропускаем
    // как есть, Number(v) тут было бы неверно (Number(null)=0, а не "нет даты").
    else if (col === 'ship_date') out[field] = v || null;
    else if (col === 'max_load_m3' || col === 'hire_rate_per_m3') out[field] = v == null ? null : Number(v);
    else if (col === 'neighbor_city' || col === 'vat_applied' || ORDER_TEXT_COLUMNS.has(col)) out[field] = v;
    else out[field] = Number(v);
  }
  // cancelled_at не входит в ORDER_COLUMNS (не участвует в INSERT при
  // создании заказа — проставляется только позже, через cancel()).
  out.cancelledAt = row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null;
  // inserted_at/version — тоже вне ORDER_COLUMNS: проставляет БД (DEFAULT),
  // из тела запроса не читаются никогда (change order-edit).
  out.insertedAt = new Date(row.inserted_at).toISOString();
  out.version = Number(row.version);
  out.materials = materialRows.map((m) => ({ name: m.name, unit: m.unit, qty: Number(m.qty), materialId: m.material_id }));
  return out;
}

// Журнал правок и признак путевых листов (change order-edit) — одним
// запросом на весь список, а не по запросу на заказ: форме исправления
// нужно знать, какие поля блокировать, списку — что показать под «испр.».
async function attachEditInfo(client, list) {
  if (!list.length) return list;
  const ids = list.map((o) => o.id);
  const { rows: editRows } = await client.query(
    'SELECT * FROM order_edits WHERE order_id = ANY($1) ORDER BY edited_at DESC, id DESC',
    [ids]
  );
  const { rows: wbRows } = await client.query('SELECT DISTINCT order_id FROM waybill_entries WHERE order_id = ANY($1)', [ids]);
  const withWaybills = new Set(wbRows.map((r) => r.order_id));
  const byOrder = {};
  for (const r of editRows) {
    (byOrder[r.order_id] = byOrder[r.order_id] || []).push({
      id: r.id,
      editedAt: new Date(r.edited_at).toISOString(),
      actorRole: r.actor_role,
      actor: actorLabel(r.actor_role, r.actor_plant_name),
      changes: r.changes,
      profit: profitLine(Number(r.profit_before), Number(r.profit_after))
    });
  }
  for (const o of list) {
    o.edits = byOrder[o.id] || [];
    o.hasWaybills = withWaybills.has(o.id);
  }
  return list;
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
    return attachEditInfo(client, result);
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
    // Память клиента — в той же транзакции: заказ не создан, память не меняется.
    await clients.applyOrder(client, f);
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

const WORKER_WINDOW_HOURS = 24;

const differs = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) > 0.005;

// Поля, которые нельзя менять, пока по заказу есть путевые листы: от них
// зависят материалы и число рейсов, а по рейсам уже списана доля брони
// (waybill-entries.js: рейсы записи / orders.trip_count); режим доставки —
// тоже: найм и самовывоз без рейсов. Адрес, км и цены — можно: путевой лист хранит свой снимок адреса и км.
function lockedFieldsChanged(row, f) {
  const recipeChanged = row.recipe_id && f.recipeId ? row.recipe_id !== f.recipeId : row.recipe_name !== f.recipeName;
  const mixerChanged = row.mixer_id && f.mixerId ? row.mixer_id !== f.mixerId : row.mixer_name !== f.mixerName;
  const rowLoad = row.max_load_m3 == null ? null : Number(row.max_load_m3);
  const loadChanged = (rowLoad == null) !== (f.maxLoadM3 == null) || (rowLoad != null && differs(rowLoad, f.maxLoadM3));
  return recipeChanged || mixerChanged || loadChanged ||
    differs(row.sale_volume, f.saleVolume) || differs(row.trip_count, f.tripCount) ||
    row.delivery_mode !== f.deliveryMode;
}

// actor: { role: 'worker' | 'manager' | 'admin', plantId } — plantId только
// у работника по ссылке своего завода; у общей ссылки null (любой завод).
function assertWorkerMayEdit(row, f, actor) {
  if (actor.role !== 'worker') return;
  if (!row.within_window) throw new HttpError(403, 'Исправить заказ можно в течение суток — обратитесь к менеджеру');
  if (actor.plantId && actor.plantId !== row.plant_id) throw new HttpError(403, 'Заказ другого завода');
  if (f.plantId !== row.plant_id) throw new HttpError(403, 'Перенести заказ на другой завод может только менеджер');
}

// Журнал правки + текст для чата — общий для update() и updateDate().
// Вызывается внутри транзакции, возвращает то, что отправить после COMMIT.
async function recordEdit(client, before, after, actor, plantName) {
  const changes = diffOrder(before, after);
  if (!changes.length) return null;
  const actorPlantName = actor.role === 'worker' ? (plantName || after.plantName) : '';
  await client.query(
    `INSERT INTO order_edits (id, order_id, actor_role, actor_plant_name, changes, profit_before, profit_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [db.genId('oed'), after.id, actor.role, actorPlantName, JSON.stringify(changes), before.totalProfit, after.totalProfit]
  );
  return { order: after, changes, profit: profitLine(before.totalProfit, after.totalProfit), actor: actorLabel(actor.role, actorPlantName) };
}

// Исправление оформленного заказа (change order-edit). Тело — тот же payload,
// что при оформлении (frontend-v2/js/order-calc.js::toOrderPayload, расчёт
// уже сделан формой), плюс version — версия заказа, открытая в форме.
async function update(id, body, actor) {
  const f = sanitize(body);
  const version = num(body && body.version, 'version');
  const client = await db.pool.connect();
  let notice = null;
  let result;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *, inserted_at >= now() - interval '${WORKER_WINDOW_HOURS} hours' AS within_window FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) throw new HttpError(404, 'Заказ не найден');
    const row = rows[0];
    if (row.cancelled_at) throw new HttpError(409, 'Заказ отменён');
    if (Number(row.version) !== version) throw new HttpError(409, 'Заказ уже исправили — откройте заново');
    assertWorkerMayEdit(row, f, actor);

    const { rows: plantRows } = await client.query('SELECT name FROM plants WHERE id = $1', [f.plantId]);
    if (!plantRows.length) throw new HttpError(400, 'Завод не найден');
    f.plantName = plantRows[0].name;
    const { rows: clientRows } = await client.query('SELECT id FROM clients WHERE id = $1', [f.clientId]);
    if (!clientRows.length) throw new HttpError(400, 'Неизвестный клиент');

    const { rows: wbRows } = await client.query('SELECT 1 FROM waybill_entries WHERE order_id = $1 LIMIT 1', [id]);
    const hasWaybills = wbRows.length > 0;
    if (hasWaybills && lockedFieldsChanged(row, f)) throw new HttpError(409, 'По заказу есть путевые листы — сначала удалите их');

    const beforeMaterials = await fetchMaterials(client, id);
    const before = rowToOrder(row, beforeMaterials);
    const draft = rowToOrder(Object.assign({}, row, Object.fromEntries(ORDER_COLUMNS.map(([col, field]) => [col, f[field] === undefined ? null : f[field]]))), beforeMaterials);
    if (!diffOrder(before, draft).length) {
      await client.query('ROLLBACK');
      return before;
    }

    const sets = ORDER_COLUMNS.map(([col], i) => `${col} = $${i + 2}`).join(', ');
    await client.query(
      `UPDATE orders SET ${sets}, version = version + 1 WHERE id = $1`,
      [id, ...ORDER_COLUMNS.map(([, field]) => (f[field] === undefined ? null : f[field]))]
    );

    // Бронь: без путевых — снимаем остаток прежней и ставим новую по
    // пересчитанному составу. С путевыми состав и бронь не трогаем вовсе:
    // release() снял бы только несписанный остаток, а reserve() поставил бы
    // полную бронь — уже списанная доля задвоилась бы. Объём и рецепт в этом
    // случае и так заблокированы.
    let materials = beforeMaterials;
    if (!hasWaybills) {
      await stock.release(client, id, 'Исправление заказа');
      await client.query('DELETE FROM order_materials WHERE order_id = $1', [id]);
      for (const m of f.materials) {
        await client.query('INSERT INTO order_materials (order_id, name, unit, qty, material_id) VALUES ($1,$2,$3,$4,$5)', [id, m.name, m.unit, m.qty, m.materialId]);
      }
      await stock.reserve(client, id, f.materials.map((m) => ({ materialId: m.materialId, qty: m.qty })));
      materials = f.materials.map((m) => ({ name: m.name, unit: m.unit, qty: m.qty, material_id: m.materialId }));
    }

    // Память клиента — только если это последний неотменённый заказ клиента
    // (уже с новыми client_id/created_at): правка старого заказа не должна
    // откатить условия, обновлённые более свежим. Память прежнего клиента
    // при смене клиента не трогаем — восстановить её не из чего.
    const { rows: lastRows } = await client.query(
      'SELECT id FROM orders WHERE client_id = $1 AND cancelled_at IS NULL ORDER BY created_at DESC, inserted_at DESC LIMIT 1',
      [f.clientId]
    );
    if (lastRows.length && lastRows[0].id === id) await clients.applyOrder(client, f);

    const { rows: full } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    result = rowToOrder(full[0], materials);
    notice = await recordEdit(client, before, result, actor, actor.role === 'worker' ? before.plantName : '');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (notice) telegram.notifyOrderEdited(notice);
  return result;
}

// Смена даты и/или завода — прежний маршрут, им пользуется интерфейс v1
// (в v2 дата и завод правятся в форме исправления, update() выше). Ответ
// для v1 тот же, но правка тоже идёт в журнал и в чат заказов (change
// order-edit) — иначе через v1 можно было бы обойти контроль. Только
// менеджер и выше (см. router.js), поэтому actor — роль из сессии.
async function updateDate(id, createdAtRaw, plantIdRaw, role) {
  const createdAt = str(createdAtRaw, 'createdAt');
  const actor = { role: role === 'admin' ? 'admin' : 'manager', plantId: null };
  const client = await db.pool.connect();
  let notice = null;
  let result;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Заказ не найден');
    const materials = await fetchMaterials(client, id);
    const before = rowToOrder(rows[0], materials);
    let plantId = rows[0].plant_id;
    let plantName = rows[0].plant_name;
    if (plantIdRaw != null) {
      plantId = str(plantIdRaw, 'plantId');
      const { rows: plantRows } = await client.query('SELECT name FROM plants WHERE id = $1', [plantId]);
      if (!plantRows.length) throw new HttpError(400, 'Завод не найден');
      plantName = plantRows[0].name;
    }
    await client.query('UPDATE orders SET created_at = $1, plant_id = $2, plant_name = $3 WHERE id = $4', [createdAt, plantId, plantName, id]);
    const { rows: full } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    result = rowToOrder(full[0], materials);
    notice = await recordEdit(client, before, result, actor, '');
    if (notice) {
      await client.query('UPDATE orders SET version = version + 1 WHERE id = $1', [id]);
      result.version += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (notice) telegram.notifyOrderEdited(notice);
  return result;
}

// Для печати путевых листов — сколько угодно заказов по их id одним запросом.
async function getByIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = ANY($1) ORDER BY created_at', [ids]);
    const result = [];
    for (const row of rows) result.push(rowToOrder(row, await fetchMaterials(client, row.id)));
    return attachEditInfo(client, result);
  } finally {
    client.release();
  }
}

module.exports = { list, create, update, remove, cancel, updateDate, getByIds, ORDER_COLUMNS };
