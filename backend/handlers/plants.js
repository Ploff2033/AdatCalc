const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const { genToken } = require('../tokens');

const TOKEN_INVALID_MESSAGE = 'Эта ссылка не привязана к заводу. Обратитесь к администратору за правильной ссылкой.';

// includeToken=true (только для admin) добавляет accessToken и, если строка
// пришла из list()'ного LEFT JOIN LATERAL, последнее использование ссылки.
function rowToPlant(row, includeToken) {
  const out = {
    id: row.id,
    name: row.name,
    targetOutput: Number(row.target_output),
    plantDepr: {
      balance: Number(row.depr_balance),
      residual: Number(row.depr_residual),
      lifespanMonths: Number(row.depr_lifespan_months)
    },
    utilitiesMonthly: Number(row.utilities_monthly),
    plantLocation: row.location_lat != null ? { lat: row.location_lat, lng: row.location_lng } : null
  };
  if (includeToken) {
    out.accessToken = row.access_token;
    out.tokenLastUsedAt = row.token_last_used_at ? new Date(row.token_last_used_at).toISOString() : null;
    out.tokenLastUsedIp = row.token_last_used_ip || null;
  }
  return out;
}

async function getRaw(client, id) {
  const { rows } = await client.query('SELECT * FROM plants WHERE id = $1', [id]);
  return rows[0] || null;
}

// role передаётся из router.js. Для admin — заодно подтягиваем токен доступа
// и последнее использование ссылки (для раздела «Доступы» в Дашборде).
async function list(query, role) {
  if (role === 'admin') {
    const { rows } = await db.pool.query(
      `SELECT p.*, u.ip AS token_last_used_ip, u.used_at AS token_last_used_at
       FROM plants p
       LEFT JOIN LATERAL (
         SELECT ip, used_at FROM plant_token_usage WHERE plant_id = p.id ORDER BY used_at DESC LIMIT 1
       ) u ON true
       ORDER BY p.name`
    );
    return rows.map((r) => rowToPlant(r, true));
  }
  const { rows } = await db.pool.query('SELECT * FROM plants ORDER BY name');
  return rows.map((r) => rowToPlant(r, false));
}

async function create(body) {
  const name = str(body.name, 'name');
  const targetOutput = body.targetOutput !== undefined ? num(body.targetOutput, 'targetOutput') : 0;
  const utilitiesMonthly = body.utilitiesMonthly !== undefined ? num(body.utilitiesMonthly, 'utilitiesMonthly') : 0;
  let deprBalance = 0, deprResidual = 0, deprLifespan = 0;
  if (body.plantDepr !== undefined) {
    const pd = body.plantDepr || {};
    deprBalance = num(pd.balance, 'plantDepr.balance');
    deprResidual = num(pd.residual, 'plantDepr.residual');
    deprLifespan = num(pd.lifespanMonths, 'plantDepr.lifespanMonths');
  }
  let lat = null, lng = null;
  if (body.plantLocation) {
    lat = num(body.plantLocation.lat, 'plantLocation.lat');
    lng = num(body.plantLocation.lng, 'plantLocation.lng');
  }

  const id = db.genId('plant');
  await db.pool.query(
    `INSERT INTO plants (id, name, target_output, depr_balance, depr_residual, depr_lifespan_months, utilities_monthly, location_lat, location_lng, access_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, name, targetOutput, deprBalance, deprResidual, deprLifespan, utilitiesMonthly, lat, lng, genToken()]
  );
  return rowToPlant(await getRaw(db.pool, id), true);
}

async function update(id, body) {
  const current = await getRaw(db.pool, id);
  if (!current) throw new HttpError(404, 'Завод не найден');

  const name = str(body.name, 'name');
  const targetOutput = body.targetOutput !== undefined ? num(body.targetOutput, 'targetOutput') : Number(current.target_output);
  const utilitiesMonthly = body.utilitiesMonthly !== undefined ? num(body.utilitiesMonthly, 'utilitiesMonthly') : Number(current.utilities_monthly);
  let deprBalance = Number(current.depr_balance), deprResidual = Number(current.depr_residual), deprLifespan = Number(current.depr_lifespan_months);
  if (body.plantDepr !== undefined) {
    const pd = body.plantDepr || {};
    deprBalance = num(pd.balance, 'plantDepr.balance');
    deprResidual = num(pd.residual, 'plantDepr.residual');
    deprLifespan = num(pd.lifespanMonths, 'plantDepr.lifespanMonths');
  }
  let lat = current.location_lat, lng = current.location_lng;
  if (body.plantLocation !== undefined) {
    const pl = body.plantLocation;
    lat = pl ? num(pl.lat, 'plantLocation.lat') : null;
    lng = pl ? num(pl.lng, 'plantLocation.lng') : null;
  }

  await db.pool.query(
    `UPDATE plants SET name=$2, target_output=$3, depr_balance=$4, depr_residual=$5, depr_lifespan_months=$6, utilities_monthly=$7, location_lat=$8, location_lng=$9
     WHERE id=$1`,
    [id, name, targetOutput, deprBalance, deprResidual, deprLifespan, utilitiesMonthly, lat, lng]
  );
  return rowToPlant(await getRaw(db.pool, id), true);
}

async function remove(id) {
  const { rows: countRows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM plants');
  if (countRows[0].n <= 1) throw new HttpError(409, 'Нельзя удалить последний завод');

  const current = await getRaw(db.pool, id);
  if (!current) throw new HttpError(404, 'Завод не найден');

  const { rows: blocking } = await db.pool.query(
    `SELECT
       (SELECT COUNT(*) FROM materials WHERE plant_id = $1) AS materials,
       (SELECT COUNT(*) FROM recipes WHERE plant_id = $1) AS recipes,
       (SELECT COUNT(*) FROM employees WHERE plant_id = $1) AS employees`,
    [id]
  );
  const b = blocking[0];
  if (Number(b.materials) > 0 || Number(b.recipes) > 0 || Number(b.employees) > 0) {
    throw new HttpError(409, 'На заводе есть материалы, рецепты или сотрудники — сначала перенесите или удалите их');
  }

  await db.pool.query('DELETE FROM plants WHERE id = $1', [id]);
}

// Троттлинг: не чаще раза в 10 минут на пару завод+IP, иначе таблица растёт
// на каждый запрос со страницы работника (там их несколько на одну загрузку).
// Плюс чистка записей старше 90 дней при каждой новой — история не копится бесконечно.
async function logTokenUsage(plantId, ip) {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM plant_token_usage
       WHERE plant_id = $1 AND ip IS NOT DISTINCT FROM $2 AND used_at > now() - interval '10 minutes'
       LIMIT 1`,
      [plantId, ip]
    );
    if (rows.length) return;
    await client.query('INSERT INTO plant_token_usage (plant_id, ip) VALUES ($1, $2)', [plantId, ip]);
    await client.query(`DELETE FROM plant_token_usage WHERE plant_id = $1 AND used_at < now() - interval '90 days'`, [plantId]);
  } finally {
    client.release();
  }
}

// Резолвит завод по токену ссылки работника — используется и для начального
// перехода по ссылке, и на каждый последующий запрос с фронтенда работника
// (см. scopeByToken в router.js). Ошибка — тот же текст, что фронтенд раньше
// показывал сам при отсутствии/невалидности ?plant= в URL.
async function resolveToken(token, ip) {
  if (!token) throw new HttpError(404, TOKEN_INVALID_MESSAGE);
  const { rows } = await db.pool.query('SELECT * FROM plants WHERE access_token = $1', [token]);
  if (!rows.length) throw new HttpError(404, TOKEN_INVALID_MESSAGE);
  await logTokenUsage(rows[0].id, ip);
  return rowToPlant(rows[0], false);
}

// Генерирует новый токен и сохраняет — старая ссылка перестаёт резолвиться немедленно.
async function reissueToken(id) {
  const current = await getRaw(db.pool, id);
  if (!current) throw new HttpError(404, 'Завод не найден');
  await db.pool.query('UPDATE plants SET access_token = $1 WHERE id = $2', [genToken(), id]);
  return rowToPlant(await getRaw(db.pool, id), true);
}

module.exports = { list, create, update, remove, resolveToken, reissueToken };
