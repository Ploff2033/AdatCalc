const db = require('../db');
const { num } = require('../validate');
const { genToken } = require('../tokens');

// Общие для всех заводов настройки (надбавка за рейс, реквизиты, лимиты смен).
// Цены топлива/мочевины и выработка/амортизация/коммуналка — у каждого завода
// свои, см. handlers/plants.js. Auth-хэши в этой же таблице, но наружу не отдаются.
// Общий токен подмены (universal_worker_token) отдаётся только admin — как и
// access_token у заводов, это чувствительный секрет, дающий доступ ко всем
// заводам сразу.
async function get(role) {
  const { rows } = await db.pool.query(
    'SELECT neighbor_city_surcharge, company_requisites, driver_shift_hours, vehicle_shift_hours, avg_speed_kmh, unload_minutes, universal_worker_token, universal_token_last_used_at, universal_token_last_used_ip, rentability_threshold_percent, telegram_bot_token, telegram_chat_id FROM config WHERE id = 1'
  );
  const row = rows[0];
  const out = {
    neighborCitySurcharge: Number(row.neighbor_city_surcharge),
    companyRequisites: row.company_requisites || '',
    driverShiftHours: Number(row.driver_shift_hours),
    vehicleShiftHours: Number(row.vehicle_shift_hours),
    avgSpeedKmh: Number(row.avg_speed_kmh),
    unloadMinutes: Number(row.unload_minutes),
    // Виден всем с ролью (нужен и менеджеру — подсветка заказов ниже порога
    // в списке «Заказы»), в отличие от токенов ниже.
    rentabilityThresholdPercent: Number(row.rentability_threshold_percent)
  };
  if (role === 'admin') {
    out.universalWorkerToken = row.universal_worker_token;
    out.universalTokenLastUsedAt = row.universal_token_last_used_at ? new Date(row.universal_token_last_used_at).toISOString() : null;
    out.universalTokenLastUsedIp = row.universal_token_last_used_ip || null;
    // Telegram-токен — чувствительный секрет, как и access_token заводов,
    // поэтому наружу только admin (как universalWorkerToken выше).
    out.telegramBotToken = row.telegram_bot_token || '';
    out.telegramChatId = row.telegram_chat_id || '';
  }
  return out;
}

async function update(body, role) {
  const sets = [];
  const values = [];
  if (body.neighborCitySurcharge !== undefined) {
    values.push(num(body.neighborCitySurcharge, 'neighborCitySurcharge'));
    sets.push(`neighbor_city_surcharge = $${values.length}`);
  }
  if (body.companyRequisites !== undefined) {
    values.push(String(body.companyRequisites).trim());
    sets.push(`company_requisites = $${values.length}`);
  }
  if (body.driverShiftHours !== undefined) {
    values.push(num(body.driverShiftHours, 'driverShiftHours'));
    sets.push(`driver_shift_hours = $${values.length}`);
  }
  if (body.vehicleShiftHours !== undefined) {
    values.push(num(body.vehicleShiftHours, 'vehicleShiftHours'));
    sets.push(`vehicle_shift_hours = $${values.length}`);
  }
  if (body.avgSpeedKmh !== undefined) {
    values.push(num(body.avgSpeedKmh, 'avgSpeedKmh'));
    sets.push(`avg_speed_kmh = $${values.length}`);
  }
  if (body.unloadMinutes !== undefined) {
    values.push(num(body.unloadMinutes, 'unloadMinutes'));
    sets.push(`unload_minutes = $${values.length}`);
  }
  if (body.rentabilityThresholdPercent !== undefined) {
    values.push(num(body.rentabilityThresholdPercent, 'rentabilityThresholdPercent'));
    sets.push(`rentability_threshold_percent = $${values.length}`);
  }
  // Токен/chat id — секрет той же категории, что universalWorkerToken/
  // access_token заводов: PUT /api/config в router.js открыт manager+, но
  // эти два поля меняются только если запрос реально от admin — менеджеру
  // запрос не упадёт с ошибкой, просто эти поля тихо проигнорируются.
  if (role === 'admin' && body.telegramBotToken !== undefined) {
    values.push(String(body.telegramBotToken).trim());
    sets.push(`telegram_bot_token = $${values.length}`);
  }
  if (role === 'admin' && body.telegramChatId !== undefined) {
    values.push(String(body.telegramChatId).trim());
    sets.push(`telegram_chat_id = $${values.length}`);
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
