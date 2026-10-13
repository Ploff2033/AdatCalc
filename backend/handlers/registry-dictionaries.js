const db = require('../db');
const HttpError = require('../http-error');

// Справочники реестра оплат: категории расходов и подразделения реестра.
// Одинаковая механика у обоих — отличаются только таблица и колонка, по
// которой заявки на них ссылаются. С plants и категориями ДДС не связаны
// (спека payment-registry/dictionaries).
const KINDS = {
  categories: { table: 'pay_categories', usedBy: 'category_id', idPrefix: 'pcat', label: 'Категория' },
  units: { table: 'pay_units', usedBy: 'unit_id', idPrefix: 'punit', label: 'Подразделение' }
};

function kindOf(kind) {
  const k = KINDS[kind];
  if (!k) throw new HttpError(404, 'Неизвестный справочник');
  return k;
}

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new HttpError(400, 'Название не может быть пустым');
  if (name.length > 120) throw new HttpError(400, 'Название слишком длинное');
  return name;
}

function rowOut(row) {
  return { id: row.id, name: row.name, hidden: row.hidden, used: Boolean(row.used) };
}

// Уникальный индекс по lower(name) — последний рубеж; явная проверка до
// него нужна ради понятного текста ошибки вместо 500.
async function assertNoDuplicate(k, name, exceptId) {
  const { rows } = await db.pool.query(
    `SELECT 1 FROM ${k.table} WHERE lower(name) = lower($1) AND id <> $2`,
    [name, exceptId || '']
  );
  if (rows.length) throw new HttpError(409, '«' + name + '» уже есть в справочнике');
}

async function list(kind) {
  const k = kindOf(kind);
  const { rows } = await db.pool.query(
    `SELECT d.*, EXISTS (SELECT 1 FROM pay_requests r WHERE r.${k.usedBy} = d.id) AS used
     FROM ${k.table} d ORDER BY d.hidden, lower(d.name)`
  );
  return rows.map(rowOut);
}

async function create(kind, body) {
  const k = kindOf(kind);
  const name = cleanName(body && body.name);
  await assertNoDuplicate(k, name);
  const id = db.genId(k.idPrefix);
  try {
    await db.pool.query(`INSERT INTO ${k.table} (id, name) VALUES ($1, $2)`, [id, name]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, '«' + name + '» уже есть в справочнике');
    throw err;
  }
  return rowOut({ id, name, hidden: false, used: false });
}

// body: { name?, hidden? } — переименование меняет название везде (заявки
// ссылаются по id), скрытие убирает значение из выбора в форме заявки.
async function update(kind, id, body) {
  const k = kindOf(kind);
  const { rows: cur } = await db.pool.query(`SELECT * FROM ${k.table} WHERE id = $1`, [id]);
  if (!cur.length) throw new HttpError(404, k.label + ' не найдена');
  const name = body && body.name !== undefined ? cleanName(body.name) : cur[0].name;
  const hidden = body && body.hidden !== undefined ? Boolean(body.hidden) : cur[0].hidden;
  if (name !== cur[0].name) await assertNoDuplicate(k, name, id);
  try {
    await db.pool.query(`UPDATE ${k.table} SET name = $1, hidden = $2 WHERE id = $3`, [name, hidden, id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, '«' + name + '» уже есть в справочнике');
    throw err;
  }
  return (await list(kind)).find((x) => x.id === id);
}

async function remove(kind, id) {
  const k = kindOf(kind);
  const { rows } = await db.pool.query(`SELECT 1 FROM pay_requests WHERE ${k.usedBy} = $1 LIMIT 1`, [id]);
  if (rows.length) {
    throw new HttpError(409, 'Значение используется в заявках — удалить нельзя, его можно скрыть');
  }
  const res = await db.pool.query(`DELETE FROM ${k.table} WHERE id = $1`, [id]);
  if (!res.rowCount) throw new HttpError(404, k.label + ' не найдена');
}

// Для handlers/registry.js: значение должно существовать и быть видимым
// (скрытое нельзя выбрать в новой заявке или при смене значения).
async function assertSelectable(kind, id) {
  const k = kindOf(kind);
  const { rows } = await db.pool.query(`SELECT hidden FROM ${k.table} WHERE id = $1`, [id || '']);
  if (!rows.length) throw new HttpError(400, k.label + ' не выбрана или не существует');
  if (rows[0].hidden) throw new HttpError(400, k.label + ' скрыта — выберите другое значение');
}

module.exports = { list, create, update, remove, assertSelectable };
