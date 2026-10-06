const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');
const uploads = require('../uploads');
const mailruSync = require('../mailru-sync');

// Правила по категориям — см. документ "AdatBeton Calc — ДДС и Дашборд
// (MVP)", таблицы "Категории расхода"/"Категории дохода". Продублировано
// на фронте (та же практика, что и с VAT_MULT в нескольких файлах уже) —
// бэкенд остаётся источником истины для валидации.
// Топливо/Автозапчасти — по отзыву пользователя фото чека больше не
// обязательно ("не везде дают" — часть заправок/магазинов чек просто не
// выдаёт): было receiptRequired: true, стало false. Поле в форме всё равно
// показывается (см. receiptOptional во фронтовых копиях этой таблицы) —
// просто не блокирует отправку записи при отсутствии фото.
const EXPENSE_CATEGORIES = {
  fuel: { label: 'Топливо', receiptRequired: false, commentRequired: false },
  salary: { label: 'ЗП', receiptRequired: false, commentRequired: true },
  parts: { label: 'Автозапчасти', receiptRequired: false, commentRequired: false },
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
    // По желанию — привязка к сотруднику/технике для "ЗП"/"Топливо" (см.
    // schema.sql), чтобы не писать имя/гос.номер в комментарий руками.
    // Имена резолвит фронт из уже загруженного State.data (employees/
    // mixers/aggregateTrucks) — тут только id, как и с orderId выше.
    employeeId: row.employee_id,
    mixerId: row.mixer_id,
    aggregateTruckId: row.aggregate_truck_id,
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

// Проверяет необязательную привязку к сотруднику/технике. undefined (поле не
// передано) — не трогаем текущее значение; null/'' — явная очистка.
// Сотрудник может быть привязан к заводу или общим (plant_id IS NULL, см.
// schema.sql) — тогда он доступен с любого завода, как и в Персонале/
// Путевых листах. Техника (mixers/aggregate_trucks) вообще без plant_id —
// "общая на все заводы" (см. комментарий в schema.sql), поэтому для неё
// проверяем только факт существования id.
async function optionalEmployeeRef(value, plantId) {
  if (value === undefined) return undefined;
  if (!value) return null;
  const { rows } = await db.pool.query('SELECT id FROM employees WHERE id = $1 AND (plant_id = $2 OR plant_id IS NULL)', [value, plantId]);
  if (!rows.length) throw new HttpError(400, 'Сотрудник не найден на этом заводе');
  return value;
}

async function optionalVehicleRef(value, table) {
  if (value === undefined) return undefined;
  if (!value) return null;
  const { rows } = await db.pool.query(`SELECT id FROM ${table} WHERE id = $1`, [value]);
  if (!rows.length) throw new HttpError(400, 'Техника не найдена: ' + table);
  return value;
}

// role === 'admin' обходит окно по времени (по просьбе пользователя —
// "Админ может править информацию когда угодно"): у него в принципе есть
// полный доступ к данным, временное окно — защита от чужой правки для
// вносящего "на месте", не от админа. Запись сторно не редактируется и не
// удаляется НИКЕМ, включая admin — это уже не окно по времени, а сама суть
// сторно как неизменяемой записи-исправления.
async function assertEditable(row, role) {
  if (row.storno_of_id) throw new HttpError(409, 'Запись сторно не редактируется и не удаляется');
  if (role === 'admin') return;
  const ageMinutes = (Date.now() - new Date(row.inserted_at).getTime()) / 60000;
  if (ageMinutes > EDIT_WINDOW_MINUTES) {
    throw new HttpError(409, 'Окно редактирования (' + EDIT_WINDOW_MINUTES + ' мин) истекло — исправьте через «Сторно»');
  }
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
  // LIMIT 500 — разумный потолок для обычного просмотра журнала, но
  // экспорту "кассовой книги" (screen-cash.js::exportToExcel) нужна ПОЛНАЯ
  // история завода без ограничения — иначе "Текущий остаток" (реальный
  // баланс кассы, считается от самой первой записи) молча искажался бы,
  // как только у завода накопится больше 500 операций за всё время.
  // all=1 снимает лимит, но требует plantId — без него это был бы дамп
  // всей таблицы по всем заводам сразу.
  const noLimit = q.all === '1' && q.plantId;
  const { rows } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name,
            EXISTS(SELECT 1 FROM cash_entries s WHERE s.storno_of_id = c.id) AS stornoed
     FROM cash_entries c JOIN plants p ON p.id = c.plant_id
     ${where}
     ORDER BY c.inserted_at DESC
     ${noLimit ? '' : 'LIMIT 500'}`,
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

  const employeeId = (await optionalEmployeeRef(body.employeeId, plantId)) || null;
  const mixerId = (await optionalVehicleRef(body.mixerId, 'mixers')) || null;
  const aggregateTruckId = (await optionalVehicleRef(body.aggregateTruckId, 'aggregate_trucks')) || null;

  const id = db.genId('cash');
  let receiptPath = null;
  if (body.receiptDataUrl) receiptPath = await uploads.saveReceiptPhoto(body.receiptDataUrl, id);
  if (rule.receiptRequired && !receiptPath) throw new HttpError(400, `Для категории "${rule.label}" нужно фото чека`);

  await db.pool.query(
    `INSERT INTO cash_entries (id, plant_id, type, category, amount, comment, receipt_path, order_id, occurred_at, employee_id, mixer_id, aggregate_truck_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, plantId, type, category, amount, comment, receiptPath, orderId, occurredAt, employeeId, mixerId, aggregateTruckId]
  );
  const { rows } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name, FALSE AS stornoed FROM cash_entries c JOIN plants p ON p.id = c.plant_id WHERE c.id = $1`,
    [id]
  );
  mailruSync.syncPlant(plantId);
  return rowToEntry(rows[0]);
}

async function update(id, body, role) {
  const { rows } = await db.pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Запись не найдена');
  const current = rows[0];
  await assertEditable(current, role);

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

  const employeeIdRef = await optionalEmployeeRef(body.employeeId, current.plant_id);
  const employeeId = employeeIdRef === undefined ? current.employee_id : employeeIdRef;
  const mixerIdRef = await optionalVehicleRef(body.mixerId, 'mixers');
  const mixerId = mixerIdRef === undefined ? current.mixer_id : mixerIdRef;
  const aggregateTruckIdRef = await optionalVehicleRef(body.aggregateTruckId, 'aggregate_trucks');
  const aggregateTruckId = aggregateTruckIdRef === undefined ? current.aggregate_truck_id : aggregateTruckIdRef;

  await db.pool.query(
    'UPDATE cash_entries SET category=$2, amount=$3, comment=$4, receipt_path=$5, occurred_at=$6, employee_id=$7, mixer_id=$8, aggregate_truck_id=$9 WHERE id=$1',
    [id, category, amount, comment, receiptPath, occurredAt, employeeId, mixerId, aggregateTruckId]
  );
  const { rows: full } = await db.pool.query(
    `SELECT c.*, p.name AS plant_name, FALSE AS stornoed FROM cash_entries c JOIN plants p ON p.id = c.plant_id WHERE c.id = $1`,
    [id]
  );
  mailruSync.syncPlant(current.plant_id);
  return rowToEntry(full[0]);
}

async function remove(id, role) {
  const { rows } = await db.pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
  if (!rows.length) throw new HttpError(404, 'Запись не найдена');
  await assertEditable(rows[0], role);
  await uploads.deleteReceiptPhoto(rows[0].receipt_path);
  await db.pool.query('DELETE FROM cash_entries WHERE id = $1', [id]);
  mailruSync.syncPlant(rows[0].plant_id);
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
  mailruSync.syncPlant(original.plant_id);
  return rowToEntry(full[0]);
}

module.exports = { list, create, update, remove, storno, EXPENSE_CATEGORIES, INCOME_CATEGORIES, EDIT_WINDOW_MINUTES };
