const db = require('../db');

// Публичная агрегированная сумма ФОТ — нужна для расчёта себестоимости на
// Главной (доступна всем, включая незалогиненных работников), но при этом
// зарплаты конкретных сотрудников (GET /api/employees) остаются доступны
// только админу.
async function get() {
  const total = db.get().employees.reduce((sum, e) => sum + (e.salary || 0), 0);
  return { payrollMonthlyTotal: total };
}

module.exports = { get };
