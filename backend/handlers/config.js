const db = require('../db');
const { num } = require('../validate');

// Осталось только общее для всех заводов: цена топлива и надбавка (техника
// общая). Выработка/амортизация/коммуналка теперь у каждого завода свои —
// см. handlers/plants.js. Auth-хэши в этой же таблице, но наружу не отдаются.
async function get() {
  const { rows } = await db.pool.query('SELECT fuel_price_default, neighbor_city_surcharge FROM config WHERE id = 1');
  const row = rows[0];
  return {
    fuelPriceDefault: Number(row.fuel_price_default),
    neighborCitySurcharge: Number(row.neighbor_city_surcharge)
  };
}

async function update(body) {
  const sets = [];
  const values = [];
  if (body.fuelPriceDefault !== undefined) {
    values.push(num(body.fuelPriceDefault, 'fuelPriceDefault'));
    sets.push(`fuel_price_default = $${values.length}`);
  }
  if (body.neighborCitySurcharge !== undefined) {
    values.push(num(body.neighborCitySurcharge, 'neighborCitySurcharge'));
    sets.push(`neighbor_city_surcharge = $${values.length}`);
  }
  if (sets.length) {
    await db.pool.query(`UPDATE config SET ${sets.join(', ')} WHERE id = 1`, values);
  }
  return get();
}

module.exports = { get, update };
