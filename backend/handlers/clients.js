const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

// Память клиента (change client-list): условия на самой строке clients +
// цены по рецептам в client_prices. Отдаётся вместе со списком, чтобы форма
// заказа подставляла её без лишних запросов.
function rowToClient(row, prices) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    createdAt: new Date(row.created_at).toISOString(),
    plantId: row.plant_id || null,
    walkIn: !!row.walk_in,
    vatGross: !!row.vat_gross,
    siteAddress: row.site_address || '',
    siteDistanceKm: row.site_distance_km == null ? null : Number(row.site_distance_km),
    siteNeighborCity: !!row.site_neighbor_city,
    deliveryChargePerM3: row.delivery_charge_per_m3 == null ? null : Number(row.delivery_charge_per_m3),
    selfPickup: !!row.self_pickup,
    mixerId: row.mixer_id || null,
    maxLoadM3: row.max_load_m3 == null ? null : Number(row.max_load_m3),
    termsUpdatedAt: row.terms_updated_at ? new Date(row.terms_updated_at).toISOString() : null,
    termsSource: row.terms_source || null,
    prices: prices || []
  };
}

function rowToPrice(row) {
  return {
    recipeId: row.recipe_id,
    priceNet: Number(row.price_net),
    updatedAt: new Date(row.updated_at).toISOString(),
    source: row.source,
    sourceLabel: row.source_label
  };
}

function sanitizeType(value) {
  return value === 'legal' ? 'legal' : 'individual';
}

// '' / null / undefined → null ("не задано"), иначе число с проверкой знака.
function optNum(value, field, opts) {
  if (value === null || value === undefined || value === '') return null;
  const n = num(value, field);
  if (opts && opts.positive ? !(n > 0) : n < 0) {
    throw new HttpError(400, `Поле "${field}" должно быть ${opts && opts.positive ? 'больше нуля' : 'не меньше нуля'}`);
  }
  return n;
}

async function attachPrices(executor, rows) {
  if (!rows.length) return [];
  const { rows: priceRows } = await executor.query(
    'SELECT * FROM client_prices WHERE client_id = ANY($1) ORDER BY updated_at',
    [rows.map((r) => r.id)]
  );
  const byClient = {};
  for (const p of priceRows) (byClient[p.client_id] = byClient[p.client_id] || []).push(rowToPrice(p));
  return rows.map((r) => rowToClient(r, byClient[r.id]));
}

async function getById(executor, id) {
  const { rows } = await executor.query('SELECT * FROM clients WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Клиент не найден');
  return (await attachPrices(executor, rows))[0];
}

async function assertPlant(executor, plantId) {
  const { rows } = await executor.query('SELECT id FROM plants WHERE id = $1', [plantId]);
  if (!rows.length) throw new HttpError(400, 'Завод не найден');
}

// query.plantId задан — клиенты этого завода плюс "Без завода" (форма
// заказа; у работника plantId всегда из токена, см. scopeByToken в
// router.js). Не задан — все клиенты (экран «Клиенты», manager+).
async function list(query) {
  const plantId = query && query.plantId;
  const { rows } = plantId
    ? await db.pool.query('SELECT * FROM clients WHERE plant_id = $1 OR plant_id IS NULL ORDER BY name', [plantId])
    : await db.pool.query('SELECT * FROM clients ORDER BY name');
  return attachPrices(db.pool, rows);
}

// Открыто ВСЕМ (включая анонимного работника по ссылке): выбор клиента при
// оформлении заказа обязателен, значит и "завести нового на месте" тоже.
// body.plantId уже проверен/подставлен маршрутом (router.js): у работника по
// ссылке завода — завод из токена, а не из тела.
async function create(body) {
  const name = str(body.name, 'name');
  const type = sanitizeType(body.type);
  const plantId = body.plantId || null;
  if (plantId) await assertPlant(db.pool, plantId);
  const id = db.genId('client');
  await db.pool.query('INSERT INTO clients (id, name, type, plant_id) VALUES ($1,$2,$3,$4)', [id, name, type, plantId]);
  return getById(db.pool, id);
}

// Карточка клиента в CRM (manager+). Меняются только поля, пришедшие в теле
// — старый экран, шлющий только name/type, условия не обнулит. Любая правка
// условий — "последняя запись побеждает" наравне с заказом (источник 'crm').
const TERMS_FIELDS = ['vatGross', 'siteAddress', 'siteDistanceKm', 'siteNeighborCity', 'deliveryChargePerM3', 'selfPickup', 'mixerId', 'maxLoadM3'];

async function update(id, body) {
  const sets = ['name = $2', 'type = $3'];
  const params = [id, str(body.name, 'name'), sanitizeType(body.type)];
  function set(col, value) { params.push(value); sets.push(`${col} = $${params.length}`); }

  // Разовые покупатели: без завода и без памяти — включение флага стирает
  // завод, условия и цены (чтобы ничего не подставлялось), остальные поля
  // тела при этом игнорируются.
  if (body.walkIn) {
    const { rowCount } = await db.pool.query(
      `UPDATE clients SET name = $2, type = $3, walk_in = TRUE, plant_id = NULL, vat_gross = FALSE, site_address = '',
         site_distance_km = NULL, site_neighbor_city = FALSE, delivery_charge_per_m3 = NULL, self_pickup = FALSE,
         mixer_id = NULL, max_load_m3 = NULL, terms_updated_at = NULL, terms_source = NULL
       WHERE id = $1`,
      params
    );
    if (!rowCount) throw new HttpError(404, 'Клиент не найден');
    await db.pool.query('DELETE FROM client_prices WHERE client_id = $1', [id]);
    return getById(db.pool, id);
  }
  if (body.walkIn === false) set('walk_in', false);

  if (body.plantId !== undefined) {
    const plantId = body.plantId || null;
    if (plantId) await assertPlant(db.pool, plantId);
    set('plant_id', plantId);
  }
  if (body.vatGross !== undefined) set('vat_gross', !!body.vatGross);
  if (body.siteAddress !== undefined) set('site_address', String(body.siteAddress || '').trim());
  if (body.siteDistanceKm !== undefined) set('site_distance_km', optNum(body.siteDistanceKm, 'siteDistanceKm'));
  if (body.siteNeighborCity !== undefined) set('site_neighbor_city', !!body.siteNeighborCity);
  if (body.deliveryChargePerM3 !== undefined) set('delivery_charge_per_m3', optNum(body.deliveryChargePerM3, 'deliveryChargePerM3'));
  if (body.selfPickup !== undefined) set('self_pickup', !!body.selfPickup);
  if (body.maxLoadM3 !== undefined) set('max_load_m3', optNum(body.maxLoadM3, 'maxLoadM3', { positive: true }));
  if (body.mixerId !== undefined) {
    const mixerId = body.mixerId || null;
    if (mixerId) {
      const { rows } = await db.pool.query('SELECT id FROM mixers WHERE id = $1', [mixerId]);
      if (!rows.length) throw new HttpError(400, 'Миксер не найден');
    }
    set('mixer_id', mixerId);
  }
  if (TERMS_FIELDS.some((f) => body[f] !== undefined)) {
    sets.push("terms_source = 'crm'", 'terms_updated_at = now()');
  }

  const { rowCount } = await db.pool.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = $1`, params);
  if (!rowCount) throw new HttpError(404, 'Клиент не найден');
  return getById(db.pool, id);
}

// Цена по рецепту из CRM. Рецепты у каждого завода свои — поэтому клиенту
// "Без завода" цену не поставить, и рецепт обязан быть с завода клиента.
async function setPrice(clientId, recipeId, body, role) {
  const priceNet = optNum(body.priceNet, 'priceNet');
  if (priceNet === null) throw new HttpError(400, 'Поле "priceNet" обязательно');
  const { rows: clientRows } = await db.pool.query('SELECT plant_id, walk_in FROM clients WHERE id = $1', [clientId]);
  if (!clientRows.length) throw new HttpError(404, 'Клиент не найден');
  if (clientRows[0].walk_in) throw new HttpError(400, 'У разовых покупателей нет цен — цена берётся по прайсу или вводится в заказе');
  if (!clientRows[0].plant_id) throw new HttpError(400, 'Сначала выберите завод — рецепты у каждого завода свои');
  const { rows: recipeRows } = await db.pool.query('SELECT plant_id FROM recipes WHERE id = $1', [recipeId]);
  if (!recipeRows.length) throw new HttpError(404, 'Рецепт не найден');
  if (recipeRows[0].plant_id !== clientRows[0].plant_id) throw new HttpError(400, 'Рецепт другого завода');
  await upsertPrice(db.pool, clientId, recipeId, priceNet, 'crm', 'CRM · ' + (role || ''));
  return getById(db.pool, clientId);
}

async function deletePrice(clientId, recipeId) {
  const { rowCount } = await db.pool.query('DELETE FROM client_prices WHERE client_id = $1 AND recipe_id = $2', [clientId, recipeId]);
  if (!rowCount) throw new HttpError(404, 'Цена не найдена');
  return getById(db.pool, clientId);
}

function upsertPrice(executor, clientId, recipeId, priceNet, source, label) {
  return executor.query(
    `INSERT INTO client_prices (client_id, recipe_id, price_net, updated_at, source, source_label)
     VALUES ($1, $2, $3, now(), $4, $5)
     ON CONFLICT (client_id, recipe_id) DO UPDATE
       SET price_net = EXCLUDED.price_net, updated_at = EXCLUDED.updated_at,
           source = EXCLUDED.source, source_label = EXCLUDED.source_label`,
    [clientId, recipeId, priceNet, source, label]
  );
}

// Запись памяти оформленным заказом — вызывается из orders.create ВНУТРИ его
// транзакции (заказ не создан → память не меняется). "Оператор — первая
// инстанция": значения заказа пишутся безусловно. f — sanitize()-тело заказа.
async function applyOrder(executor, f) {
  // Разовые покупатели — без памяти и без завода, заказ их не трогает.
  const { rows: walkRows } = await executor.query('SELECT walk_in FROM clients WHERE id = $1', [f.clientId]);
  if (walkRows.length && walkRows[0].walk_in) return;

  await executor.query('UPDATE clients SET plant_id = $2 WHERE id = $1 AND plant_id IS NULL', [f.clientId, f.plantId]);

  if (f.recipeId) {
    const { rows } = await executor.query('SELECT id FROM recipes WHERE id = $1 AND plant_id = $2', [f.recipeId, f.plantId]);
    if (rows.length) await upsertPrice(executor, f.clientId, f.recipeId, f.salePrice, 'order', 'Заказ · ' + f.plantName);
  }

  if (f.selfPickup) {
    // Разовый самовывоз не затирает объект, миксер и ограничение загрузки.
    await executor.query(
      "UPDATE clients SET vat_gross = $2, self_pickup = TRUE, terms_updated_at = now(), terms_source = 'order' WHERE id = $1",
      [f.clientId, f.vatApplied]
    );
    return;
  }

  if (f.deliveryMode === 'hired') {
    // Разовый найм (change order-hired-delivery): объект и цена доставки —
    // условия клиента, их пишем; миксер, ограничение загрузки и «соседний
    // город» — свойства нашей доставки, их не трогаем. Сам режим и ставка
    // не запоминаются: следующий заказ откроется в режиме «Своя».
    await executor.query(
      `UPDATE clients SET vat_gross = $2, self_pickup = FALSE, site_address = $3, site_distance_km = $4,
         delivery_charge_per_m3 = $5, terms_updated_at = now(), terms_source = 'order'
       WHERE id = $1`,
      [f.clientId, f.vatApplied, f.address, f.distanceKm, f.deliveryChargePerM3]
    );
    return;
  }

  let mixerId = null;
  if (f.mixerId) {
    const { rows } = await executor.query('SELECT id FROM mixers WHERE id = $1', [f.mixerId]);
    if (rows.length) mixerId = f.mixerId;
  }
  // Старое тело без mixerId (закэшированный фронтенд) — миксер в памяти не трогаем.
  const keepMixer = f.mixerId === undefined;
  await executor.query(
    `UPDATE clients SET vat_gross = $2, self_pickup = FALSE, site_address = $3, site_distance_km = $4,
       site_neighbor_city = $5, delivery_charge_per_m3 = $6, max_load_m3 = $7,
       mixer_id = CASE WHEN $9 THEN mixer_id ELSE $8 END,
       terms_updated_at = now(), terms_source = 'order'
     WHERE id = $1`,
    [f.clientId, f.vatApplied, f.address, f.distanceKm, f.neighborCity, f.deliveryChargePerM3, f.maxLoadM3, mixerId, keepMixer]
  );
}

// Удаление не блокируется заказами: orders.client_id — ON DELETE SET NULL,
// снимок имени/типа в заказе остаётся. Память (client_prices) уходит каскадом.
async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM clients WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Клиент не найден');
}

module.exports = { list, create, update, setPrice, deletePrice, applyOrder, remove };
