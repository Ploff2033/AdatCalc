#!/usr/bin/env node
// Одноразовая миграция data/db.json -> Postgres.
// Запуск: DATABASE_URL=postgres://... node scripts/migrate-json-to-pg.js [путь-к-db.json] [--force] [--skip-materials-recipes]
//
// По умолчанию отказывается писать в базу, где уже есть данные (таблица
// plants не пуста), чтобы не задвоить записи при случайном повторном
// запуске. --force снимает эту проверку, но существующие строки не
// удаляются — при совпадении id используется ON CONFLICT DO NOTHING,
// т.е. просто ничего не перезапишет и молча пропустит дубликаты.
//
// --skip-materials-recipes — не грузить materials/recipes/recipe_items из
// JSON вообще (для случая, когда актуальные материалы/рецепты берутся из
// отдельного источника, например экспорта тестовой базы — см.
// scripts/export-materials-recipes.sh).
const fs = require('fs');
const path = require('path');
const db = require('../backend/db');
const { ORDER_COLUMNS } = require('../backend/handlers/orders');
const { genToken } = require('../backend/tokens');

async function main() {
  const skipMaterialsRecipes = process.argv.includes('--skip-materials-recipes');
  const args = process.argv.slice(2).filter((a) => a !== '--force' && a !== '--skip-materials-recipes');
  const force = process.argv.includes('--force');
  const jsonPath = args[0] || path.join(__dirname, '..', 'data', 'db.json');

  if (!fs.existsSync(jsonPath)) {
    console.error(`Файл не найден: ${jsonPath}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  await db.migrate(); // создать таблицы, если их ещё нет (не трогает существующие)

  const { rows: countRows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM plants');
  if (countRows[0].n > 0 && !force) {
    console.error(
      'В базе уже есть данные (таблица plants не пуста). ' +
      'Похоже, миграция уже проводилась. Если всё же нужно повторить — запустите с флагом --force.'
    );
    process.exit(1);
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    let n;

    n = 0;
    for (const p of data.plants || []) {
      const depr = p.plantDepr || {};
      const loc = p.plantLocation || null;
      await client.query(
        `INSERT INTO plants (id, name, target_output, depr_balance, depr_residual, depr_lifespan_months, utilities_monthly, location_lat, location_lng, access_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name, p.targetOutput || 0, depr.balance || 0, depr.residual || 0, depr.lifespanMonths || 0, p.utilitiesMonthly || 0, loc ? loc.lat : null, loc ? loc.lng : null, genToken()]
      );
      n++;
    }
    console.log(`plants: ${n}`);

    n = 0;
    for (const e of data.employees || []) {
      await client.query(
        `INSERT INTO employees (id, plant_id, name, position, salary) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.plantId || null, e.name, e.position, e.salary]
      );
      n++;
    }
    console.log(`employees: ${n}`);

    n = 0;
    for (const m of data.mixers || []) {
      await client.query(
        `INSERT INTO mixers (id, name, capacity, balance, residual, mileage, fuel_rate) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.name, m.capacity, m.balance, m.residual, m.mileage, m.fuelRate]
      );
      n++;
    }
    console.log(`mixers: ${n}`);

    n = 0;
    for (const t of data.aggregateTrucks || []) {
      await client.query(
        `INSERT INTO aggregate_trucks (id, name, capacity, balance, residual, mileage, fuel_rate) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.name, t.capacity, t.balance, t.residual, t.mileage, t.fuelRate]
      );
      n++;
    }
    console.log(`aggregateTrucks: ${n}`);

    if (skipMaterialsRecipes) {
      console.log('materials/recipes: пропущено (--skip-materials-recipes)');
    } else {
      n = 0;
      for (const m of data.materials || []) {
        const d = m.delivery || {};
        await client.query(
          `INSERT INTO materials (id, plant_id, name, unit, price, loss_percent, delivery_own_transport, delivery_truck_id, delivery_distance_km, delivery_fuel_price_per_liter, delivery_driver_surcharge, delivery_manual_cost_per_unit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [m.id, m.plantId, m.name, m.unit, m.price, m.lossPercent || 0, !!d.ownTransport, d.truckId || null, d.distanceKm || 0, d.fuelPricePerLiter || 0, d.driverSurcharge || 0, d.manualCostPerUnit || 0]
        );
        n++;
      }
      console.log(`materials: ${n}`);

      n = 0;
      let itemsN = 0;
      for (const r of data.recipes || []) {
        await client.query(
          `INSERT INTO recipes (id, plant_id, name, sale_price) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.plantId, r.name, r.salePrice || 0]
        );
        const items = r.items || [];
        for (let i = 0; i < items.length; i++) {
          await client.query(
            `INSERT INTO recipe_items (recipe_id, material_id, qty, position) VALUES ($1,$2,$3,$4)`,
            [r.id, items[i].materialId, items[i].qty, i]
          );
          itemsN++;
        }
        n++;
      }
      console.log(`recipes: ${n} (recipe_items: ${itemsN})`);
    }

    n = 0;
    let matN = 0;
    for (const o of data.orders || []) {
      const cols = ['id', ...ORDER_COLUMNS.map((c) => c[0])];
      const values = [
        o.id,
        ...ORDER_COLUMNS.map(([, field]) => (field === 'neighborCity' ? !!o[field] : o[field]))
      ];
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await client.query(`INSERT INTO orders (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values);
      for (const mat of o.materials || []) {
        await client.query('INSERT INTO order_materials (order_id, name, unit, qty) VALUES ($1,$2,$3,$4)', [o.id, mat.name, mat.unit, mat.qty]);
        matN++;
      }
      n++;
    }
    console.log(`orders: ${n} (order_materials: ${matN})`);

    if (data.config) {
      const c = data.config;
      const auth = c.auth || {};
      const admin = auth.admin || { salt: '', hash: '' };
      const manager = auth.manager || { salt: '', hash: '' };
      await client.query(
        `INSERT INTO config (id, fuel_price_default, neighbor_city_surcharge, admin_salt, admin_hash, manager_salt, manager_hash)
         VALUES (1, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           fuel_price_default = EXCLUDED.fuel_price_default,
           neighbor_city_surcharge = EXCLUDED.neighbor_city_surcharge,
           admin_salt = EXCLUDED.admin_salt, admin_hash = EXCLUDED.admin_hash,
           manager_salt = EXCLUDED.manager_salt, manager_hash = EXCLUDED.manager_hash`,
        [c.fuelPriceDefault || 0, c.neighborCitySurcharge || 0, admin.salt, admin.hash, manager.salt, manager.hash]
      );
      console.log('config: ok');
    }

    n = 0;
    const now = Date.now();
    for (const s of data.sessions || []) {
      if (Number(s.expiresAt) < now) continue; // протухшие сессии не переносим
      await client.query(
        'INSERT INTO sessions (token, role, expires_at) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',
        [s.token, s.role, s.expiresAt]
      );
      n++;
    }
    console.log(`sessions: ${n}`);

    await client.query('COMMIT');
    console.log('Миграция завершена успешно.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error('Ошибка миграции:', err);
  process.exit(1);
});
