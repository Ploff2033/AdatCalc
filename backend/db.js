const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { hashPassword } = require('./auth');
const { genToken } = require('./tokens');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/calc';

const pool = new Pool({ connectionString: DATABASE_URL });

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  await backfillAccessTokens();
}

// Заводы, созданные до появления access_token (или через ALTER TABLE на уже
// существующей БД), получают токен здесь — идемпотентно, трогает только
// строки с access_token IS NULL, на следующих запусках уже no-op.
async function backfillAccessTokens() {
  const { rows } = await pool.query('SELECT id FROM plants WHERE access_token IS NULL');
  for (const row of rows) {
    await pool.query('UPDATE plants SET access_token = $1 WHERE id = $2', [genToken(), row.id]);
  }
}

// Заполняет базу начальными данными только если она реально пустая (первый
// запуск). На уже существующей базе — no-op, ничего не перезаписывает.
async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM plants');
  if (rows[0].n > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const plantId = 'plant_seed1';
    await client.query(
      `INSERT INTO plants (id, name, target_output, depr_balance, depr_residual, depr_lifespan_months, utilities_monthly)
       VALUES ($1, 'Завод 1', 500, 1200000, 100000, 96, 40000)`,
      [plantId]
    );

    await client.query(
      `INSERT INTO employees (id, plant_id, name, position, salary) VALUES
       ('emp_seed1', $1, 'Иванов Иван', 'Оператор БСУ', 65000),
       ('emp_seed2', $1, 'Петров Пётр', 'Водитель миксера', 70000)`,
      [plantId]
    );

    const admin = hashPassword('AdatBetonAdmin');
    const manager = hashPassword('adatadat');
    await client.query(
      `INSERT INTO config (id, fuel_price_default, neighbor_city_surcharge, admin_salt, admin_hash, manager_salt, manager_hash)
       VALUES (1, 62, 1000, $1, $2, $3, $4)`,
      [admin.salt, admin.hash, manager.salt, manager.hash]
    );

    const materials = [
      ['mat_cement', 'Цемент', 'т', 9000],
      ['mat_sand', 'Песок', 'т', 1100],
      ['mat_gravel', 'Щебень', 'т', 1600],
      ['mat_water', 'Вода', 'м³', 50]
    ];
    for (const [id, name, unit, price] of materials) {
      await client.query(
        `INSERT INTO materials (id, plant_id, name, unit, price) VALUES ($1, $2, $3, $4, $5)`,
        [id, plantId, name, unit, price]
      );
    }

    await client.query(
      `INSERT INTO recipes (id, plant_id, name, sale_price) VALUES ('rec_m200', $1, 'М200', 6800)`,
      [plantId]
    );
    const recipeItems = [
      ['mat_cement', 0.35],
      ['mat_sand', 0.7],
      ['mat_gravel', 1.1],
      ['mat_water', 0.18]
    ];
    for (let i = 0; i < recipeItems.length; i++) {
      await client.query(
        `INSERT INTO recipe_items (recipe_id, material_id, qty, position) VALUES ('rec_m200', $1, $2, $3)`,
        [recipeItems[i][0], recipeItems[i][1], i]
      );
    }

    await client.query(
      `INSERT INTO mixers (id, name, capacity, balance, residual, mileage, fuel_rate)
       VALUES ('mix_1', 'КамАЗ-53229 №1', 7, 2500000, 250000, 300000, 35)`
    );
    await client.query(
      `INSERT INTO aggregate_trucks (id, name, capacity, balance, residual, mileage, fuel_rate)
       VALUES ('atr_1', 'КамАЗ-самосвал №1', 15, 1800000, 200000, 300000, 32)`
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function load() {
  await migrate();
  await seedIfEmpty();
}

module.exports = { pool, genId, load, migrate, seedIfEmpty };
