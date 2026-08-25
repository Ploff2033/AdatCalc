const db = require('../db');

// Публичная агрегированная сумма ФОТ по заводам — нужна для расчёта
// себестоимости на Главной (доступна всем, включая незалогиненных
// работников), но при этом зарплаты конкретных сотрудников
// (GET /api/employees) остаются доступны только админу.
async function get() {
  const { rows } = await db.pool.query(
    `SELECT plant_id, COALESCE(SUM(salary), 0)::float8 AS total FROM employees GROUP BY plant_id`
  );
  const byPlant = {};
  let sharedTotal = 0;
  rows.forEach((r) => {
    if (r.plant_id) byPlant[r.plant_id] = Number(r.total);
    else sharedTotal = Number(r.total);
  });
  return { byPlant, sharedTotal };
}

module.exports = { get };
