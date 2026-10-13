// Минимальные данные реестра напрямую в БД — для тестов, которым нужна
// "уже существующая" заявка, без прохода через handlers/registry.js.
const { db } = require('./db');

let n = 0;

async function unit(name, hidden) {
  const id = 'punit_t' + (++n);
  await db.pool.query('INSERT INTO pay_units (id, name, hidden) VALUES ($1, $2, $3)', [id, name, Boolean(hidden)]);
  return id;
}

async function category(name, hidden) {
  const id = 'pcat_t' + (++n);
  await db.pool.query('INSERT INTO pay_categories (id, name, hidden) VALUES ($1, $2, $3)', [id, name, Boolean(hidden)]);
  return id;
}

async function rawRequest(unitId, categoryId, extra) {
  const id = 'preq_t' + (++n);
  const e = extra || {};
  await db.pool.query(
    `INSERT INTO pay_requests (id, number, unit_id, category_id, recipient, purpose, amount, decision, approved_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, 'T-' + n, unitId, categoryId, e.recipient || 'ООО "Тест"', e.purpose || 'Тест', e.amount || 1000, e.decision || null, e.approved_amount || null]
  );
  return id;
}

module.exports = { unit, category, rawRequest };
