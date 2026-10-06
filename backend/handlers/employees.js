const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function rowToPeriod(row) {
  return { id: row.id, startDate: row.start_date, endDate: row.end_date || null };
}

// Периоды работы водителя — подгружаются одним запросом на весь список
// сотрудников (не по одному на карточку), см. attachWorkPeriods() ниже.
// Нужны и в rowToDriverOption (не только в полной rowToEmployee) — тот, кто
// распределяет рейс (менеджер/работник по ссылке), должен видеть, на какие
// даты водитель вообще доступен, до того как упрётся в жёсткую блокировку
// на сохранении (см. handlers/waybill-entries.js).
async function loadWorkPeriodsByEmployee(employeeIds) {
  const byEmployee = {};
  if (!employeeIds.length) return byEmployee;
  const { rows } = await db.pool.query(
    'SELECT * FROM employee_work_periods WHERE employee_id = ANY($1) ORDER BY start_date',
    [employeeIds]
  );
  rows.forEach((r) => {
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = [];
    byEmployee[r.employee_id].push(rowToPeriod(r));
  });
  return byEmployee;
}

function rowToEmployee(row, workPeriods) {
  return {
    id: row.id,
    plantId: row.plant_id,
    name: row.name,
    position: row.position,
    salary: Number(row.salary),
    isDriver: !!row.is_driver,
    licenseNumber: row.license_number || '',
    // По просьбе пользователя — админ может скрыть сотрудника из выбора в
    // ДДС (screen-cash.js/mobile-cash.js::renderEmployeePicker), не трогая
    // остальные экраны (Персонал/Путевые листы его всё равно видят).
    showInCash: row.show_in_cash !== false,
    workPeriods: workPeriods || []
  };
}

// Для выбора водителя на Главной (доступно менеджеру и работнику по
// ссылке) — ФИО, номер удостоверения (нужен путевому листу), периоды
// работы (нужны путевому листу поступлений/бетона — см. выше) и отметка
// "водитель", без должности/оклада: это чувствительные данные, которые
// видит только админ (см. read:'admin' в старой версии этого списка и
// ветку ниже).
function rowToDriverOption(row, workPeriods) {
  return { id: row.id, plantId: row.plant_id, name: row.name, licenseNumber: row.license_number || '', isDriver: true, showInCash: row.show_in_cash !== false, workPeriods: workPeriods || [] };
}

async function validatePlantId(plantId) {
  if (!plantId) return null;
  const { rows } = await db.pool.query('SELECT id FROM plants WHERE id = $1', [plantId]);
  if (!rows.length) throw new HttpError(400, 'Неизвестный завод');
  return plantId;
}

// admin — полный список (query.plantId задан — сотрудники этого завода +
// общие; не задан — все, для дашборда). Менеджер/работник (по ссылке) —
// только отмеченные "водитель" сотрудники своего завода, без зарплат.
async function list(query, role) {
  if (role === 'admin') {
    let rows;
    if (query && query.plantId) {
      ({ rows } = await db.pool.query(
        'SELECT * FROM employees WHERE plant_id = $1 OR plant_id IS NULL ORDER BY name',
        [query.plantId]
      ));
    } else {
      ({ rows } = await db.pool.query('SELECT * FROM employees ORDER BY name'));
    }
    const periods = await loadWorkPeriodsByEmployee(rows.map((r) => r.id));
    return rows.map((r) => rowToEmployee(r, periods[r.id]));
  }

  if (!query || !query.plantId) return [];
  const { rows } = await db.pool.query(
    'SELECT id, plant_id, name, license_number, show_in_cash FROM employees WHERE is_driver = TRUE AND (plant_id = $1 OR plant_id IS NULL) ORDER BY name',
    [query.plantId]
  );
  const periods = await loadWorkPeriodsByEmployee(rows.map((r) => r.id));
  return rows.map((r) => rowToDriverOption(r, periods[r.id]));
}

async function create(body) {
  const name = str(body.name, 'name');
  const position = str(body.position, 'position');
  const salary = num(body.salary, 'salary');
  const plantId = await validatePlantId(body.plantId || null);
  const isDriver = !!body.isDriver;
  const licenseNumber = (body.licenseNumber || '').trim();
  // showInCash не присылают старые формы (например, если когда-нибудь
  // появится импорт без этого поля) — по умолчанию TRUE, как и в schema.sql,
  // явно скрыть можно только body.showInCash === false.
  const showInCash = body.showInCash !== false;

  const id = db.genId('emp');
  await db.pool.query(
    'INSERT INTO employees (id, plant_id, name, position, salary, is_driver, license_number, show_in_cash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, plantId, name, position, salary, isDriver, licenseNumber, showInCash]
  );
  const { rows } = await db.pool.query('SELECT * FROM employees WHERE id = $1', [id]);
  return rowToEmployee(rows[0], []);
}

async function update(id, body) {
  const { rows: existing } = await db.pool.query('SELECT id FROM employees WHERE id = $1', [id]);
  if (!existing.length) throw new HttpError(404, 'Сотрудник не найден');

  const name = str(body.name, 'name');
  const position = str(body.position, 'position');
  const salary = num(body.salary, 'salary');
  const plantId = await validatePlantId(body.plantId || null);
  const isDriver = !!body.isDriver;
  const licenseNumber = (body.licenseNumber || '').trim();
  const showInCash = body.showInCash !== false;

  await db.pool.query(
    'UPDATE employees SET name=$2, position=$3, salary=$4, plant_id=$5, is_driver=$6, license_number=$7, show_in_cash=$8 WHERE id=$1',
    [id, name, position, salary, plantId, isDriver, licenseNumber, showInCash]
  );
  const { rows } = await db.pool.query('SELECT * FROM employees WHERE id = $1', [id]);
  const periods = await loadWorkPeriodsByEmployee([id]);
  return rowToEmployee(rows[0], periods[id]);
}

// ---- Периоды работы водителя (см. employee_work_periods в schema.sql) ----

async function addWorkPeriod(employeeId, body) {
  const { rows: existing } = await db.pool.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
  if (!existing.length) throw new HttpError(404, 'Сотрудник не найден');
  const startDate = str(body.startDate, 'startDate');
  const endDate = body.endDate ? str(body.endDate, 'endDate') : null;
  if (endDate && endDate < startDate) throw new HttpError(400, 'Дата окончания раньше даты начала');
  const { rows } = await db.pool.query(
    'INSERT INTO employee_work_periods (employee_id, start_date, end_date) VALUES ($1,$2,$3) RETURNING *',
    [employeeId, startDate, endDate]
  );
  return rowToPeriod(rows[0]);
}

async function updateWorkPeriod(employeeId, periodId, body) {
  const { rows: existing } = await db.pool.query(
    'SELECT id FROM employee_work_periods WHERE id = $1 AND employee_id = $2',
    [periodId, employeeId]
  );
  if (!existing.length) throw new HttpError(404, 'Период не найден');
  const startDate = str(body.startDate, 'startDate');
  const endDate = body.endDate ? str(body.endDate, 'endDate') : null;
  if (endDate && endDate < startDate) throw new HttpError(400, 'Дата окончания раньше даты начала');
  const { rows } = await db.pool.query(
    'UPDATE employee_work_periods SET start_date=$3, end_date=$4 WHERE id=$1 AND employee_id=$2 RETURNING *',
    [periodId, employeeId, startDate, endDate]
  );
  return rowToPeriod(rows[0]);
}

async function removeWorkPeriod(employeeId, periodId) {
  const { rowCount } = await db.pool.query(
    'DELETE FROM employee_work_periods WHERE id = $1 AND employee_id = $2',
    [periodId, employeeId]
  );
  if (!rowCount) throw new HttpError(404, 'Период не найден');
}

async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM employees WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Сотрудник не найден');
}

module.exports = { list, create, update, remove, addWorkPeriod, updateWorkPeriod, removeWorkPeriod };
