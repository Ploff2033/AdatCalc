const db = require('../db');
const HttpError = require('../http-error');
const { str } = require('../validate');

function rowToClient(row) {
  return { id: row.id, name: row.name, type: row.type, createdAt: new Date(row.created_at).toISOString() };
}

function sanitizeType(value) {
  return value === 'legal' ? 'legal' : 'individual';
}

// Не привязан к заводу (см. schema.sql) — единый список для всех заводов
// сразу, поэтому в отличие от materials/recipes/employees никакого
// query.plantId тут нет и быть не может.
async function list() {
  const { rows } = await db.pool.query('SELECT * FROM clients ORDER BY name');
  return rows.map(rowToClient);
}

// Открыто ВСЕМ (включая анонимного работника по ссылке — см. router.js:
// opts.create) — выбор клиента при оформлении заказа обязателен для всех,
// а значит и "создать нового прямо на месте" не может быть ограничено
// ролью, иначе работник с новым клиентом просто не сможет оформить заказ.
async function create(body) {
  const name = str(body.name, 'name');
  const type = sanitizeType(body.type);
  const id = db.genId('client');
  await db.pool.query('INSERT INTO clients (id, name, type) VALUES ($1,$2,$3)', [id, name, type]);
  const { rows } = await db.pool.query('SELECT * FROM clients WHERE id = $1', [id]);
  return rowToClient(rows[0]);
}

// Переименование/смена типа существующего клиента — это уже не "оформляю
// заказ и мимоходом завожу нового", а работа со справочником, поэтому
// manager+ (см. router.js).
async function update(id, body) {
  const name = str(body.name, 'name');
  const type = sanitizeType(body.type);
  const { rowCount } = await db.pool.query('UPDATE clients SET name=$2, type=$3 WHERE id=$1', [id, name, type]);
  if (!rowCount) throw new HttpError(404, 'Клиент не найден');
  const { rows } = await db.pool.query('SELECT * FROM clients WHERE id = $1', [id]);
  return rowToClient(rows[0]);
}

// Удаление не блокируется наличием заказов (в отличие от, например, заводов)
// — orders.client_id это ON DELETE SET NULL, а client_name/client_type уже
// снятый снимок на момент заказа (см. schema.sql), так что исторический
// отчёт по клиенту не портится даже после удаления его карточки.
async function remove(id) {
  const { rowCount } = await db.pool.query('DELETE FROM clients WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Клиент не найден');
}

module.exports = { list, create, update, remove };
