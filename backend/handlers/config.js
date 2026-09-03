const db = require('../db');
const { num } = require('../validate');
const { genToken } = require('../tokens');

// Осталось только общее для всех заводов: цена топлива и надбавка (техника
// общая). Выработка/амортизация/коммуналка теперь у каждого завода свои —
// см. handlers/plants.js. Auth-хэши в этой же таблице, но наружу не отдаются.
// Общий токен подмены (universal_worker_token) отдаётся только admin — как и
// access_token у заводов, это чувствительный секрет, дающий доступ ко всем
// заводам сразу.
async function get(role) {
  const { rows } = await db.pool.query(
    'SELECT fuel_price_default, urea_price_default, neighbor_city_surcharge, universal_worker_token, universal_token_last_used_at, universal_token_last_used_ip FROM config WHERE id = 1'
  );
  const row = rows[0];
  const out = {
    fuelPriceDefault: Number(row.fuel_price_default),
    ureaPriceDefault: Number(row.urea_price_default),
    neighborCitySurcharge: Number(row.neighbor_city_surcharge)
  };
  if (role === 'admin') {
    out.universalWorkerToken = row.universal_worker_token;
    out.universalTokenLastUsedAt = row.universal_token_last_used_at ? new Date(row.universal_token_last_used_at).toISOString() : null;
    out.universalTokenLastUsedIp = row.universal_token_last_used_ip || null;
  }
  return out;
}

async function update(body, role) {
  const sets = [];
  const values = [];
  if (body.fuelPriceDefault !== undefined) {
    values.push(num(body.fuelPriceDefault, 'fuelPriceDefault'));
    sets.push(`fuel_price_default = $${values.length}`);
  }
  if (body.ureaPriceDefault !== undefined) {
    values.push(num(body.ureaPriceDefault, 'ureaPriceDefault'));
    sets.push(`urea_price_default = $${values.length}`);
  }
  if (body.neighborCitySurcharge !== undefined) {
    values.push(num(body.neighborCitySurcharge, 'neighborCitySurcharge'));
    sets.push(`neighbor_city_surcharge = $${values.length}`);
  }
  if (sets.length) {
    await db.pool.query(`UPDATE config SET ${sets.join(', ')} WHERE id = 1`, values);
  }
  return get(role);
}

// Троттлинг+чистка — та же логика, что у plant_token_usage в handlers/plants.js,
// но т.к. токен один (не по заводу), достаточно поля "последнее использование"
// вместо отдельной таблицы истории.
async function checkUniversalToken(token, ip) {
  if (!token) return false;
  const { rows } = await db.pool.query('SELECT universal_worker_token FROM config WHERE id = 1');
  if (!rows.length || !rows[0].universal_worker_token || rows[0].universal_worker_token !== token) return false;
  await db.pool.query(
    'UPDATE config SET universal_token_last_used_at = now(), universal_token_last_used_ip = $1 WHERE id = 1',
    [ip]
  );
  return true;
}

// Перевыпуск — старая общая ссылка перестаёт работать немедленно (токен
// просто перезаписывается), как и у per-plant access_token.
async function reissueUniversalToken() {
  await db.pool.query('UPDATE config SET universal_worker_token = $1 WHERE id = 1', [genToken()]);
  return get('admin');
}

module.exports = { get, update, checkUniversalToken, reissueUniversalToken };
