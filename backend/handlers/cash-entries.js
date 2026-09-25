const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const uploads = require('../uploads');

// Правила по категориям — см. документ "AdatBeton Calc — ДДС и Дашборд
// (MVP)", таблицы "Категории расхода"/"Категории дохода". Продублировано
// на фронте (та же практика, что и с VAT_MULT в нескольких файлах уже) —
// бэкенд остаётся источником истины для валидации.
const EXPENSE_CATEGORIES = {
  fuel: { label: 'Топливо', receiptRequired: true, commentRequired: false },
  salary: { label: 'ЗП', receiptRequired: false, commentRequired: true },
  parts: { label: 'Автозапчасти', receiptRequired: true, commentRequired: false },
  other: { label: 'Другое', receiptRequired: false, commentRequired: true }
};
const INCOME_CATEGORIES = {
  concrete_sale: { label: 'Продажа бетона', receiptRequired: false, commentRequired: false },
  other: { label: 'Прочее', receiptRequired: false, commentRequired: true }
};

// Окно на исправление опечатки — 15-30 минут по документу, берём середину.
const EDIT_WINDOW_MINUTES = 20;

function categoriesFor(type) {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

function rowToEntry(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    plantName: row.plant_name,
    type: row.type,
    category: row.category,
    amount: Number(row.amount), // знаковая: расход отрицателен, доход/сторно-от-расхода положителен
    comment: row.comment || '',
    receiptPath: row.receipt_path,
    orderId: row.order_id,
    // occurred_at — DATE, pg отдаёт уже строкой 'YYYY-MM-DD' (см.
    // types.setTypeParser в db.js — без него тут был бы сдвиг на день назад
    // на сервере в часовом поясе восточнее UTC).
    occurredAt: row.occurred_at || null,
    stornoOfId: row.storno_of_id,
    stornoed: !!row.stornoed,
    insertedAt: new Date(row.inserted_at).toISOString()
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function assertEditable(row) {
  const ageMinutes = (Date.now() - new Date(row.inserted_at).getTime()) / 60000;
  if (ageMinutes > EDIT_WINDOW_MINUTES) {
    throw new HttpError(409, 'Окно редактирования (' + EDIT_WINDOW_MINUTES + ' мин) истекло — исправьте через «Сторно»');
  }
  if (row.storno_of_id) throw new HttpError(409, 'Запись сторно не редактируется и не удаляется');
}

// query.plantId — задан почти всегда (менеджер/админ выбрали завод на
// фронте, анонимный работник получил его из токена, см. router.js). Не
// задан — только у admin, тогда это полный кросс-заводской журнал (см.
// документ: "Для администратора — полный список по всем заводам").
// Прочие роли без plantId получают пустой список, а не чужие заводы.
async function list(query) {
  const q = query || {};
  const conditions = [];
  const params = [];
  if (q.plantId) {
    params.push(q.plantId);
    conditions.push(`c.plant_id = $${params.length}`);
  }
  if (q.type === 'expense' || q.type === 'income') {
    params.push(q.type);
    conditions.push(`c.type = $${params.length}`);
  }
  if (q.category) {
    params.push(q.category);
    conditions.push(`c.category = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    conditions.push(`c.occurred_at >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    conditions.push(`c.occurred_at <= $${params.length}`);
  }
  if (q.noReceipt === '1') {
    conditions.push(`c.receipt_path IS NULL AND c.category = ANY('{fuel,parts}')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name,
            EXISTS(SELECT 1 FROM cash_entries s WHERE s.storno_of_id = c.id) AS stornoed
     FROM cash_entries c JOIN plants p ON p.id = c.plant_id
     ${where}
     ORDER BY c.inserted_at DESC
     LIMIT 500`,
    params
  );
  return rows.map(rowToEntry);
}

async function create(body) {
  const plantId = str(body.plantId, 'plantId');
  const { rows: plantRows } = await db.pool.query('SELECT id FROM plants WHERE id = $1', [plantId]);
  if (!plantRows.length) throw new HttpError(400, 'Неизвестный завод');

  const type = body.type === 'income' ? 'income' : (body.type === 'expense' ? 'expense' : null);
  if (!type) throw new HttpError(400, 'Тип операции должен быть "expense" или "income"');
  const categories = categoriesFor(type);
  const category = categories[body.category] ? body.category : null;
  if (!category) throw new HttpError(400, 'Неизвестная категория для этого типа операции');
  const rule = categories[category];

  const rawAmount = num(body.amount, 'amount');
  if (!(rawAmount > 0)) throw new HttpError(400, 'Сумма должна быть положительной');
  const amount = type === 'expense' ? -rawAmount : rawAmount;

  const comment = (body.comment || '').trim();
  if (rule.commentRequired && !comment) throw new HttpError(400, `Для категории "${rule.label}" комментарий обязателен`);

  let orderId = null;
  if (category === 'concrete_sale') {
    orderId = str(body.orderId, 'orderId');
    const { rows: orderRows } = await db.pool.query('SELECT id FROM orders WHERE id = $1 AND plant_id = $2', [orderId, plantId]);
    if (!orderRows.length) throw new HttpError(400, 'Заказ не найден на этом заводе');
  }

  const occurredAt = body.occurredAt ? str(body.occurredAt, 'occurredAt') : todayStr();

  const id = db.genId('cash');
  let receiptPath = null;
  if (body.receiptDataUrl) receiptPath = await uploads.saveReceiptPhoto(body.receiptDataUrl, id);
  if (rule.receiptRequired && !receiptPath) throw new HttpError(400, `Для категории "${rule.label}" нужно фото чека`);

  await db.pool.query(
    `INSERT INTO cash_entries (id, plant_id, type, category, amount, comment, receipt_path, order_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, plantId, type, category, amount, comment, receiptPath, orderId, occurredAt]
  );
  const { rows } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name, FALSE AS stornoed FROM cash_entries c JOIN plants p ON p.id = c.plant_id WHERE c.id = $1`,
    [id]
  );
  return rowToEntry(rows[0]);
}

async function update(id, body) {
  const { rows } = await db.pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Запись не найдена');
  const current = rows[0];
  await assertEditable(current);

  // Тип и завод не меняются при правке — только категория/сумма/
  // комментарий/чек/дата (тот же принцип, что у заказов: у сущности есть
  // неизменяемое ядро даже в пределах окна редактирования).
  const categories = categoriesFor(current.type);
  const category = body.category !== undefined && categories[body.category] ? body.category : current.category;
  const rule = categories[category];

  const rawAmount = body.amount !== undefined ? num(body.amount, 'amount') : Math.abs(Number(current.amount));
  if (!(rawAmount > 0)) throw new HttpError(400, 'Сумма должна быть положительной');
  const amount = current.type === 'expense' ? -rawAmount : rawAmount;

  const comment = body.comment !== undefined ? String(body.comment).trim() : (current.comment || '');
  if (rule.commentRequired && !comment) throw new HttpError(400, `Для категории "${rule.label}" комментарий обязателен`);

  let receiptPath = current.receipt_path;
  if (body.receiptDataUrl) {
    await uploads.deleteReceiptPhoto(receiptPath);
    receiptPath = await uploads.saveReceiptPhoto(body.receiptDataUrl, id);
  } else if (body.removeReceipt) {
    await uploads.deleteReceiptPhoto(receiptPath);
    receiptPath = null;
  }
  if (rule.receiptRequired && !receiptPath) throw new HttpError(400, `Для категории "${rule.label}" нужно фото чека`);

  const occurredAt = body.occurredAt ? str(body.occurredAt, 'occurredAt') : current.occurred_at;

  await db.pool.query(
    'UPDATE cash_entries SET category=$2, amount=$3, comment=$4, receipt_path=$5, occurred_at=$6 WHERE id=$1',
    [id, category, amount, comment, receiptPath, occurredAt]
  );
  const { rows: full } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name, FALSE AS stornoed FROM cash_entries c JOIN plants p ON p.id = c.plant_id WHERE c.id = $1`,
    [id]
  );
  return rowToEntry(full[0]);
}

async function remove(id) {
  const { rows } = await db.pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Запись не найдена');
  await assertEditable(rows[0]);
  await uploads.deleteReceiptPhoto(rows[0].receipt_path);
  await db.pool.query('DELETE FROM cash_entries WHERE id = $1', [id]);
}

// Сторно — единственный способ исправить запись ПОСЛЕ окна редактирования
// (см. документ): новая запись с противоположной суммой, ссылающаяся на
// исходную. Исходная не трогается и не удаляется — остаётся видна (фронт
// рисует её зачёркнутой по stornoed:true). Доступно на том же уровне
// доступа, что и создание — включая анонимного работника по токену: это
// его собственная ошибка, ему её и исправлять на месте.
async function storno(id, note) {
  const { rows } = await db.pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Запись не найдена');
  const original = rows[0];
  if (original.storno_of_id) throw new HttpError(409, 'Нельзя сторнировать запись сторно');
  const { rows: existing } = await db.pool.query('SELECT id FROM cash_entries WHERE storno_of_id = $1', [id]);
  if (existing.length) throw new HttpError(409, 'Эта запись уже сторнирована');

  const id2 = db.genId('cash');
  const reverseAmount = -Number(original.amount);
  const when = new Date(original.inserted_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const comment = `Отменяет запись от ${when}` + (note ? `: ${note.trim()}` : '');
  await db.pool.query(
    `INSERT INTO cash_entries (id, plant_id, type, category, amount, comment, occurred_at, storno_of_id)
     VALUES ($1,$2,$3,'storno',$4,$5,$6,$7)`,
    [id2, original.plant_id, original.type, reverseAmount, comment, todayStr(), id]
  );
  const { rows: full } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name, FALSE AS stornoed FROM cash_entries c JOIN plants p ON p.id = c.plant_id WHERE c.id = $1`,
    [id2]
  );
  return rowToEntry(full[0]);
}

module.exports = { list, create, update, remove, storno, EXPENSE_CATEGORIES, INCOME_CATEGORIES, EDIT_WINDOW_MINUTES };
