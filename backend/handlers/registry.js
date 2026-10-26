const crypto = require('crypto');
const db = require('../db');
const HttpError = require('../http-error');
const { genToken } = require('../tokens');
const calc = require('../registry-calc');
const files = require('../registry-files');
const dictionaries = require('./registry-dictionaries');
const telegram = require('../telegram');

// Реестр оплат (change reestr-oplat): заявки, решения учредителя, оплаты,
// файлы. Статус заявки не хранится — каждый ответ пересчитывает его через
// registry-calc.js::computeState из decision/approved_amount и оплат.
// Доступ (admin / owner по токен-ссылке) проверяется в registry-routes.js,
// здесь — только бизнес-правила.

const MAX_REQUEST_FILES = 10;
const FILE_KINDS = { invoice: 'Счёт', contract: 'Договор', payment_order: 'Платёжка', other: 'Прочее' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- проверки полей ----------

function text(value, field, required, max) {
  const v = typeof value === 'string' ? value.trim() : (value === null || value === undefined ? '' : String(value).trim());
  if (required && !v) throw new HttpError(400, 'Поле «' + field + '» обязательно');
  if (v.length > (max || 500)) throw new HttpError(400, 'Поле «' + field + '» слишком длинное');
  return v;
}

// Сумма в рублях: > 0, не больше 2 знаков после запятой. Принимает и
// "63 800,50" (как вводят руками), и число.
function money(value, field) {
  const raw = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
    throw new HttpError(400, 'Поле «' + field + '» должно быть числом');
  }
  if (n <= 0) throw new HttpError(400, 'Поле «' + field + '» должно быть больше 0');
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new HttpError(400, 'Поле «' + field + '»: не больше двух знаков после запятой');
  if (n >= 1e12) throw new HttpError(400, 'Поле «' + field + '»: слишком большая сумма');
  return Math.round(n * 100) / 100;
}

// ИНН получателя: пусто или 10 / 12 цифр (юрлицо / ИП). Пробелы, которые
// бывают при ручном вводе, отбрасываем.
function inn(value) {
  const v = String(value === null || value === undefined ? '' : value).replace(/\s/g, '');
  if (!v) return null;
  if (!/^(\d{10}|\d{12})$/.test(v)) throw new HttpError(400, 'ИНН получателя должен состоять из 10 или 12 цифр');
  return v;
}

// № счёта отдельно не вводится — он уже записан в «Основании» («Счёт № 531
// от 22.10.2026; договор …»). Сервер извлекает его оттуда при создании и
// правке, чтобы было по чему ловить дубли (lookup), в т.ч. у заявок,
// заведённых вручную. Нет «Счёт № …» в основании — номера нет.
function invoiceFromBasis(basis) {
  const m = /сч[её]т(?:\s+на\s+оплату)?\s*(?:№|N|#)\s*([^\s,;]+)/i.exec(String(basis || ''));
  return m ? m[1].replace(/[.,;:]+$/, '').slice(0, 64) : null;
}

// Для сравнения номеров счетов при поиске дубля: «RU-12 », «ru-12» — один номер.
function normInvoiceNo(value) {
  return String(value || '').replace(/\s/g, '').toLowerCase();
}

function date(value, field, required) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, 'Поле «' + field + '» обязательно');
    return null;
  }
  if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(Date.parse(value + 'T00:00:00Z'))) {
    throw new HttpError(400, 'Поле «' + field + '»: неверная дата');
  }
  return value;
}

// ---------- чтение ----------

function fileOut(f) {
  return {
    id: f.id,
    kind: f.kind,
    kindLabel: FILE_KINDS[f.kind],
    name: f.original_name,
    mime: f.mime,
    size: f.size_bytes,
    url: files.publicPath(f.stored_name),
    paymentId: f.payment_id
  };
}

function money2(v) {
  return v === null || v === undefined ? null : Number(v);
}

// where/params — фрагмент WHERE для pay_requests r. Возвращает заявки со
// всем нужным экрану/экспорту: названия справочников, оплаты, файлы, состояние.
async function loadRequests(where, params) {
  const today = calc.todayMoscow();
  const { rows } = await db.pool.query(
    `SELECT r.*, to_char(r.created_at AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS created_on,
            u.name AS unit_name, c.name AS category_name
     FROM pay_requests r
     JOIN pay_units u ON u.id = r.unit_id
     JOIN pay_categories c ON c.id = r.category_id
     ${where ? 'WHERE ' + where : ''}`,
    params || []
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ rows: pays }, { rows: fls }] = await Promise.all([
    db.pool.query('SELECT * FROM pay_payments WHERE request_id = ANY($1) ORDER BY paid_on, created_at', [ids]),
    db.pool.query('SELECT * FROM pay_files WHERE request_id = ANY($1) ORDER BY created_at', [ids])
  ]);
  return rows.map((r) => {
    const payments = pays.filter((p) => p.request_id === r.id);
    const state = calc.computeState(r, payments, today);
    const myFiles = fls.filter((f) => f.request_id === r.id);
    return {
      id: r.id,
      seq: r.seq,
      number: r.number,
      unitId: r.unit_id,
      unitName: r.unit_name,
      categoryId: r.category_id,
      categoryName: r.category_name,
      applicant: r.applicant,
      basis: r.basis,
      recipientInn: r.recipient_inn,
      invoiceNumber: r.invoice_number,
      recipient: r.recipient,
      purpose: r.purpose,
      amount: Number(r.amount),
      dueDate: r.due_date,
      decision: r.decision,
      approvedAmount: money2(r.approved_amount),
      decisionComment: r.decision_comment,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      createdOn: r.created_on,
      updatedAt: r.updated_at,
      // Спека "Правка и удаление": карточка показывает, что заявку меняли
      // после решения (истории нет — только этот признак и даты).
      editedAfterDecision: Boolean(r.decided_at && r.updated_at > r.decided_at),
      state,
      lastPaidOn: payments.length ? payments[payments.length - 1].paid_on : null,
      payments: payments.map((p) => {
        const f = myFiles.find((x) => x.payment_id === p.id);
        return { id: p.id, paidOn: p.paid_on, amount: Number(p.amount), file: f ? fileOut(f) : null };
      }),
      files: myFiles.filter((f) => !f.payment_id).map(fileOut)
    };
  });
}

// Адаптер под calc.compareForList/computeTotals (они ждут snake_case полей).
function calcView(item) {
  return {
    seq: item.seq,
    due_date: item.dueDate,
    amount: item.amount,
    state: item.state,
    payments: item.payments.map((p) => ({ amount: p.amount, paid_on: p.paidOn }))
  };
}

// query: status, unit, category, from, to ('YYYY-MM-DD', по дате создания,
// МСК), closed ('1' — только закрытые, 'all' — все, иначе — активные).
async function list(query) {
  const q = query || {};
  const cond = [];
  const params = [];
  if (q.unit) { params.push(q.unit); cond.push('r.unit_id = $' + params.length); }
  if (q.category) { params.push(q.category); cond.push('r.category_id = $' + params.length); }
  const from = q.from ? date(q.from, 'с') : null;
  const to = q.to ? date(q.to, 'по') : null;
  if (from) { params.push(from); cond.push("(r.created_at AT TIME ZONE 'Europe/Moscow')::date >= $" + params.length); }
  if (to) { params.push(to); cond.push("(r.created_at AT TIME ZONE 'Europe/Moscow')::date <= $" + params.length); }
  let items = await loadRequests(cond.join(' AND '), params);
  if (q.status) items = items.filter((x) => x.state.status === q.status);
  if (q.closed !== 'all') {
    const wantClosed = q.closed === '1' || q.closed === 'true';
    items = items.filter((x) => x.state.closed === wantClosed);
  }
  items.sort((a, b) => calc.compareForList(calcView(a), calcView(b)));
  const totals = calc.computeTotals(items.map(calcView), (from || to) ? { from, to } : null);
  return { today: calc.todayMoscow(), items, totals };
}

// ref — id или номер ("121026-57", из ссылки в Telegram).
async function get(ref) {
  const items = await loadRequests('r.id = $1 OR r.number = $1', [String(ref)]);
  if (!items.length) throw new HttpError(404, 'Заявка не найдена');
  return items[0];
}

// ---------- уведомления ----------

// Ссылка учредителя прямо на карточку заявки (спека notifications,
// "вариант А": с токеном — открывается из Telegram без входа).
async function ownerLink(number, origin) {
  const base = (process.env.PUBLIC_BASE_URL || origin || '').replace(/\/+$/, '');
  const token = await getOwnerToken();
  return base + '/v2/?owner=' + encodeURIComponent(token) + '#/registry' + (number ? '/' + encodeURIComponent(number) : '');
}

function rub(n) {
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₽';
}

function ddmm(iso) {
  const [y, m, d] = iso.split('-');
  return d + '.' + m + '.' + y;
}

async function messageNew(r, origin) {
  const h = telegram.escapeHtml;
  const lines = [
    '🧾 <b>Новая заявка №' + h(r.number) + ' · ' + h(r.recipient) + '</b>',
    'Сумма: ' + rub(r.amount),
    'Подразделение: ' + h(r.unitName) + ' · ' + h(r.categoryName),
    'Цель: ' + h(r.purpose)
  ];
  if (r.dueDate) lines.push('Срок: до ' + ddmm(r.dueDate));
  lines.push('<a href="' + h(await ownerLink(r.number, origin)) + '">Открыть заявку</a>');
  return lines.join('\n');
}

async function messageDecision(r, origin) {
  const h = telegram.escapeHtml;
  let what;
  if (r.decision === 'approved') {
    what = 'одобрено ' + rub(r.approvedAmount) + (r.approvedAmount < r.amount ? ' из ' + rub(r.amount) : '');
  } else if (r.decision === 'rejected') {
    what = 'отклонено';
  } else {
    what = 'отложено';
  }
  const lines = ['<b>Решение по №' + h(r.number) + ': ' + what + '</b>', h(r.recipient) + ' · ' + h(r.purpose)];
  if (r.decisionComment) lines.push('Комментарий: ' + h(r.decisionComment));
  lines.push('<a href="' + h(await ownerLink(r.number, origin)) + '">Открыть заявку</a>');
  return lines.join('\n');
}

function zayavok(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' заявка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' заявки';
  return n + ' заявок';
}

// Одно сообщение на пачку (change reestr-bulk): до 15 строк, дальше «…и ещё N».
const BULK_LINES = 15;
async function messageBulk(info, origin) {
  const h = telegram.escapeHtml;
  const { decision, applied } = info;
  const sum = applied.reduce((s, r) => s + calc.toKop(r.amount), 0) / 100;
  const head = decision === 'approved'
    ? '✅ <b>Одобрено пачкой: ' + zayavok(applied.length) + ' на ' + rub(sum) + '</b>'
    : '⏸ <b>Отложено пачкой: ' + zayavok(applied.length) + '</b>';
  const lines = [head].concat(applied.slice(0, BULK_LINES).map((r) => '№' + h(r.number) + ' · ' + h(r.recipient) + ' · ' + rub(r.amount)));
  if (applied.length > BULK_LINES) lines.push('…и ещё ' + (applied.length - BULK_LINES));
  lines.push('<a href="' + h(await ownerLink('', origin)) + '">Открыть реестр</a>');
  return lines.join('\n');
}

// Без await у вызывающего: сбой Telegram не должен ни задерживать, ни
// отменять операцию (спека "Сбой отправки не мешает операции").
function notify(buildMessage, r, origin) {
  buildMessage(r, origin)
    .then((msg) => telegram.notifyRegistry(msg))
    .catch((err) => console.error('Реестр оплат: не удалось подготовить уведомление: ' + err.message));
}

// ---------- заявки ----------

async function create(body, ctx) {
  const b = body || {};
  const unitId = text(b.unitId, 'Подразделение', true);
  const categoryId = text(b.categoryId, 'Категория', true);
  const recipient = text(b.recipient, 'Получатель', true);
  const purpose = text(b.purpose, 'Цель расхода', true, 2000);
  const amount = money(b.amount, 'Сумма');
  const applicant = text(b.applicant, 'Заявитель', false);
  const basis = text(b.basis, 'Основание', false, 1000);
  const dueDate = date(b.dueDate, 'Срок оплаты', false);
  const recipientInn = inn(b.recipientInn);
  const invoiceNumber = invoiceFromBasis(basis);
  await dictionaries.assertSelectable('units', unitId);
  await dictionaries.assertSelectable('categories', categoryId);

  const id = db.genId('preq');
  const { rows } = await db.pool.query("SELECT nextval(pg_get_serial_sequence('pay_requests', 'seq')) AS seq");
  const seq = Number(rows[0].seq);
  const number = calc.formatNumber(calc.todayMoscow(), seq);
  await db.pool.query(
    `INSERT INTO pay_requests (id, seq, number, unit_id, category_id, applicant, basis, recipient, purpose, amount, due_date, recipient_inn, invoice_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, seq, number, unitId, categoryId, applicant, basis, recipient, purpose, amount, dueDate, recipientInn, invoiceNumber]
  );
  const created = await get(id);
  notify(messageNew, created, ctx && ctx.origin);
  return created;
}

// Блокировка строки заявки на время проверки+записи — чтобы два
// одновременных действия (решение учредителя и оплата admin) не проверили
// правила по одному и тому же устаревшему состоянию.
async function withLockedRequest(id, fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM pay_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new HttpError(404, 'Заявка не найдена');
    const { rows: pays } = await client.query('SELECT * FROM pay_payments WHERE request_id = $1', [id]);
    const result = await fn(client, rows[0], pays);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function paidKop(pays) {
  return pays.reduce((s, p) => s + calc.toKop(p.amount), 0);
}

// Частичная правка: меняются только переданные поля. Решение не
// сбрасывается (решение интервью); если Сумма стала меньше "К оплате" —
// "К оплате" понижается до Суммы; ниже уже оплаченного Сумму опустить нельзя.
async function update(id, body) {
  const b = body || {};
  await withLockedRequest(id, async (client, cur, pays) => {
    const next = {
      unit_id: b.unitId !== undefined ? text(b.unitId, 'Подразделение', true) : cur.unit_id,
      category_id: b.categoryId !== undefined ? text(b.categoryId, 'Категория', true) : cur.category_id,
      recipient: b.recipient !== undefined ? text(b.recipient, 'Получатель', true) : cur.recipient,
      purpose: b.purpose !== undefined ? text(b.purpose, 'Цель расхода', true, 2000) : cur.purpose,
      amount: b.amount !== undefined ? money(b.amount, 'Сумма') : Number(cur.amount),
      applicant: b.applicant !== undefined ? text(b.applicant, 'Заявитель', false) : cur.applicant,
      basis: b.basis !== undefined ? text(b.basis, 'Основание', false, 1000) : cur.basis,
      due_date: b.dueDate !== undefined ? date(b.dueDate, 'Срок оплаты', false) : cur.due_date,
      recipient_inn: b.recipientInn !== undefined ? inn(b.recipientInn) : cur.recipient_inn,
      invoice_number: null
    };
    next.invoice_number = invoiceFromBasis(next.basis);
    // Скрытое значение нельзя ВЫБРАТЬ, но оставить уже выбранное — можно.
    if (next.unit_id !== cur.unit_id) await dictionaries.assertSelectable('units', next.unit_id);
    if (next.category_id !== cur.category_id) await dictionaries.assertSelectable('categories', next.category_id);
    const amountKop = calc.toKop(next.amount);
    if (amountKop < paidKop(pays)) {
      throw new HttpError(409, 'Сумма не может быть меньше уже оплаченного (' + rub(paidKop(pays) / 100) + ')');
    }
    let approved = cur.approved_amount;
    if (approved !== null && calc.toKop(approved) > amountKop) approved = next.amount;
    await client.query(
      `UPDATE pay_requests SET unit_id=$1, category_id=$2, recipient=$3, purpose=$4, amount=$5, applicant=$6,
         basis=$7, due_date=$8, approved_amount=$9, recipient_inn=$10, invoice_number=$11, updated_at=now() WHERE id=$12`,
      [next.unit_id, next.category_id, next.recipient, next.purpose, next.amount, next.applicant, next.basis, next.due_date, approved, next.recipient_inn, next.invoice_number, id]
    );
  });
  return get(id);
}

async function remove(id) {
  const toDelete = await withLockedRequest(id, async (client, cur, pays) => {
    if (pays.length) throw new HttpError(409, 'По заявке есть оплаты — сначала удалите оплаты');
    const { rows } = await client.query('SELECT stored_name FROM pay_files WHERE request_id = $1', [id]);
    await client.query('DELETE FROM pay_requests WHERE id = $1', [id]);
    return rows.map((r) => r.stored_name);
  });
  // Файлы — после COMMIT: строка БД важнее, осиротевший файл без ссылки безвреден.
  await Promise.all(toDelete.map(files.remove));
}

// Общее ядро решения — для одиночного decide и пакетного decideMany
// (change reestr-bulk): одни и те же проверки и запись. opts.comment —
// новый комментарий; undefined — оставить прежний (так при пачке).
async function applyDecision(client, cur, pays, decision, opts) {
  const o = opts || {};
  const paid = paidKop(pays);
  let approved = null;
  if (decision === 'approved') {
    approved = (o.approvedAmount === undefined || o.approvedAmount === null || o.approvedAmount === '')
      ? Number(cur.amount)
      : money(o.approvedAmount, 'К оплате');
    if (calc.toKop(approved) > calc.toKop(cur.amount)) {
      throw new HttpError(400, '«К оплате» не может быть больше суммы заявки (' + rub(cur.amount) + ')');
    }
    if (calc.toKop(approved) < paid) {
      throw new HttpError(409, '«К оплате» не может быть меньше уже оплаченного (' + rub(paid / 100) + ')');
    }
  } else if (pays.length) {
    throw new HttpError(409, 'По заявке уже есть оплаты — сначала удалите оплаты');
  }
  const comment = o.comment === undefined ? cur.decision_comment : o.comment;
  await client.query(
    'UPDATE pay_requests SET decision=$1, approved_amount=$2, decision_comment=$3, decided_at=now() WHERE id=$4',
    [decision, approved, comment, cur.id]
  );
}

// body: { decision: 'approved'|'rejected'|'postponed', approvedAmount?, comment? }
async function decide(id, body, ctx) {
  const b = body || {};
  if (!['approved', 'rejected', 'postponed'].includes(b.decision)) {
    throw new HttpError(400, 'Неизвестное решение');
  }
  const comment = text(b.comment, 'Комментарий', false, 1000);
  await withLockedRequest(id, (client, cur, pays) => applyDecision(client, cur, pays, b.decision, { approvedAmount: b.approvedAmount, comment }));
  const result = await get(id);
  notify(messageDecision, result, ctx && ctx.origin);
  return result;
}

// Пакетное решение (change reestr-bulk, design §1): «одобрить» на полную
// сумму или «отложить», до 100 заявок. Каждая заявка — своя короткая
// транзакция: изменившиеся за это время пропускаются с причиной, остальные
// применяются (частичное применение — решение интервью). Одно сводное
// уведомление вместо сообщения на каждую заявку.
const BULK_MAX = 100;
const SKIP_REASON = {
  approved: 'уже одобрена',
  partial: 'уже частично оплачена',
  paid: 'уже оплачена',
  rejected: 'уже отклонена'
};

async function decideMany(body, ctx) {
  const b = body || {};
  if (!['approved', 'postponed'].includes(b.decision)) {
    throw new HttpError(400, 'Пачкой можно только одобрить или отложить');
  }
  if (!Array.isArray(b.ids) || !b.ids.length) throw new HttpError(400, 'Не выбрано ни одной заявки');
  const ids = Array.from(new Set(b.ids.map(String)));
  if (ids.length > BULK_MAX) throw new HttpError(400, 'За раз — не больше ' + BULK_MAX + ' заявок');

  const applied = [];
  const skipped = [];
  const today = calc.todayMoscow();
  for (const id of ids) {
    let number = null;
    try {
      const outcome = await withLockedRequest(id, async (client, cur, pays) => {
        number = cur.number;
        const st = calc.computeState(cur, pays, today).status;
        if (st === 'postponed' && b.decision === 'postponed') return 'unchanged';
        if (st !== 'pending' && st !== 'postponed') return SKIP_REASON[st] || 'нельзя изменить';
        await applyDecision(client, cur, pays, b.decision, {});
        return 'applied';
      });
      if (outcome === 'applied' || outcome === 'unchanged') {
        const r = await get(id);
        applied.push({ id: r.id, number: r.number, recipient: r.recipient, amount: r.amount, changed: outcome === 'applied' });
      } else {
        skipped.push({ id, number, reason: outcome });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        skipped.push({ id, number, reason: err.status === 404 ? 'заявка не найдена' : err.message });
      } else {
        console.error('Реестр оплат: пакетное решение, заявка ' + id + ': ' + err.message);
        skipped.push({ id, number, reason: 'ошибка сервера' });
      }
    }
  }
  const changed = applied.filter((x) => x.changed);
  if (changed.length) notify(messageBulk, { decision: b.decision, applied: changed }, ctx && ctx.origin);
  return { applied: applied.map(({ changed: _c, ...rest }) => rest), skipped };
}

// ---------- оплаты ----------

async function addPayment(id, body) {
  const b = body || {};
  const amount = money(b.amount, 'Сумма оплаты');
  const paidOn = date(b.paidOn, 'Дата оплаты', true);
  if (paidOn > calc.todayMoscow()) throw new HttpError(400, 'Дата оплаты не может быть позже сегодняшней');
  let paymentId;
  await withLockedRequest(id, async (client, cur, pays) => {
    const state = calc.computeState(cur, pays, calc.todayMoscow());
    if (state.status !== 'approved' && state.status !== 'partial') {
      throw new HttpError(409, 'Оплату можно внести только по одобренной заявке (сейчас: ' + state.statusLabel + ')');
    }
    if (calc.toKop(amount) > calc.toKop(state.unpaid)) {
      throw new HttpError(409, 'Оплата больше остатка «Не оплачено» (' + rub(state.unpaid) + ') — сначала увеличьте «К оплате»');
    }
    paymentId = db.genId('ppay');
    await client.query('INSERT INTO pay_payments (id, request_id, paid_on, amount) VALUES ($1,$2,$3,$4)', [paymentId, id, paidOn, amount]);
  });
  return get(id);
}

async function removePayment(paymentId) {
  const { rows } = await db.pool.query('SELECT request_id FROM pay_payments WHERE id = $1', [paymentId]);
  if (!rows.length) throw new HttpError(404, 'Оплата не найдена');
  const requestId = rows[0].request_id;
  const stored = await withLockedRequest(requestId, async (client) => {
    const { rows: f } = await client.query('SELECT stored_name FROM pay_files WHERE payment_id = $1', [paymentId]);
    await client.query('DELETE FROM pay_payments WHERE id = $1', [paymentId]);
    return f.map((x) => x.stored_name);
  });
  await Promise.all(stored.map(files.remove));
  return get(requestId);
}

// ---------- файлы ----------

function originalName(raw, ext) {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch (err) { name = String(raw || ''); }
  name = name.replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0, 200);
  return name || ('файл' + ext);
}

async function addRequestFile(id, buf, meta) {
  const type = files.validate(buf);
  const kind = FILE_KINDS[meta && meta.kind] ? meta.kind : 'invoice';
  let stored;
  try {
    await withLockedRequest(id, async (client) => {
      const { rows } = await client.query('SELECT count(*)::int AS n FROM pay_files WHERE request_id = $1 AND payment_id IS NULL', [id]);
      if (rows[0].n >= MAX_REQUEST_FILES) throw new HttpError(409, 'К заявке можно прикрепить не больше ' + MAX_REQUEST_FILES + ' файлов');
      stored = await files.save(buf, type);
      await client.query(
        `INSERT INTO pay_files (id, request_id, kind, original_name, mime, size_bytes, stored_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [db.genId('pfile'), id, kind, originalName(meta && meta.name, type.ext), type.mime, buf.length, stored]
      );
    });
  } catch (err) {
    if (stored) await files.remove(stored);
    throw err;
  }
  return get(id);
}

// Платёжка к оплате — одна; новая заменяет старую.
async function setPaymentFile(paymentId, buf, meta) {
  const type = files.validate(buf);
  const { rows } = await db.pool.query('SELECT request_id FROM pay_payments WHERE id = $1', [paymentId]);
  if (!rows.length) throw new HttpError(404, 'Оплата не найдена');
  const requestId = rows[0].request_id;
  let stored;
  let old = [];
  try {
    await withLockedRequest(requestId, async (client) => {
      const { rows: prev } = await client.query('SELECT stored_name FROM pay_files WHERE payment_id = $1', [paymentId]);
      old = prev.map((x) => x.stored_name);
      await client.query('DELETE FROM pay_files WHERE payment_id = $1', [paymentId]);
      stored = await files.save(buf, type);
      await client.query(
        `INSERT INTO pay_files (id, request_id, payment_id, kind, original_name, mime, size_bytes, stored_name)
         VALUES ($1,$2,$3,'payment_order',$4,$5,$6,$7)`,
        [db.genId('pfile'), requestId, paymentId, originalName(meta && meta.name, type.ext), type.mime, buf.length, stored]
      );
    });
  } catch (err) {
    if (stored) await files.remove(stored);
    throw err;
  }
  await Promise.all(old.map(files.remove));
  return get(requestId);
}

async function removeFile(fileId) {
  const { rows } = await db.pool.query('DELETE FROM pay_files WHERE id = $1 RETURNING request_id, stored_name', [fileId]);
  if (!rows.length) throw new HttpError(404, 'Файл не найден');
  await files.remove(rows[0].stored_name);
  return get(rows[0].request_id);
}

// ---------- подсказки ----------

async function suggest(field, q) {
  const col = field === 'applicant' ? 'applicant' : field === 'recipient' ? 'recipient' : null;
  if (!col) throw new HttpError(400, 'Неизвестное поле для подсказок');
  const needle = '%' + String(q || '').trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const { rows } = await db.pool.query(
    `SELECT ${col} AS v, max(created_at) AS last FROM pay_requests
     WHERE ${col} <> '' AND ${col} ILIKE $1 GROUP BY ${col} ORDER BY last DESC LIMIT 10`,
    [needle]
  );
  return rows.map((r) => r.v);
}

// ---------- автозаполнение из счёта ----------

// Один запрос на распознанный файл (design §4): что подставить из последней
// заявки этого получателя и есть ли уже заявка с тем же счётом. Скрытые
// значения справочников не подставляются — их нельзя выбрать в новой заявке.
async function lookup(query) {
  const q = query || {};
  const recipientInn = q.inn ? inn(q.inn) : null;
  if (!recipientInn) return { defaults: null, duplicates: [] };
  const { rows } = await db.pool.query(
    `SELECT r.number, r.applicant, r.unit_id, u.hidden AS unit_hidden, r.category_id, c.hidden AS category_hidden
     FROM pay_requests r
     JOIN pay_units u ON u.id = r.unit_id
     JOIN pay_categories c ON c.id = r.category_id
     WHERE r.recipient_inn = $1
     ORDER BY r.created_at DESC, r.seq DESC LIMIT 1`,
    [recipientInn]
  );
  const last = rows[0];
  const defaults = last ? {
    unitId: last.unit_hidden ? null : last.unit_id,
    categoryId: last.category_hidden ? null : last.category_id,
    applicant: last.applicant || '',
    fromNumber: last.number
  } : null;
  let duplicates = [];
  const no = normInvoiceNo(q.invoiceNumber);
  if (no) {
    const { rows: dup } = await db.pool.query(
      `SELECT id, number FROM pay_requests
       WHERE recipient_inn = $1 AND lower(regexp_replace(coalesce(invoice_number, ''), '\\s', '', 'g')) = $2
       ORDER BY created_at DESC`,
      [recipientInn, no]
    );
    duplicates = dup.map((d) => ({ id: d.id, number: d.number }));
  }
  return { defaults, duplicates };
}

// ---------- учредитель и настройки ----------

async function getOwnerToken() {
  const { rows } = await db.pool.query('SELECT owner_token FROM config WHERE id = 1');
  return (rows[0] && rows[0].owner_token) || '';
}

// Сравнение в постоянное время — токен учредителя даёт право решения.
async function checkOwnerToken(token) {
  if (!token || typeof token !== 'string') return false;
  const actual = await getOwnerToken();
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function reissueOwnerToken() {
  await db.pool.query('UPDATE config SET owner_token = $1 WHERE id = 1', [genToken()]);
  return getSettings();
}

async function getSettings() {
  const { rows } = await db.pool.query('SELECT owner_token, telegram_registry_chat_id, telegram_registry_thread_id FROM config WHERE id = 1');
  const row = rows[0] || {};
  return {
    ownerToken: row.owner_token || '',
    telegramRegistryChatId: row.telegram_registry_chat_id || '',
    // Тема (Topic) реестра в той же супергруппе, что и заказы/остатки — см.
    // schema.sql. Пусто — сообщение идёт в общую ленту чата без темы.
    telegramRegistryThreadId: row.telegram_registry_thread_id || ''
  };
}

async function updateSettings(body) {
  if (body && body.telegramRegistryChatId !== undefined) {
    const chat = text(body.telegramRegistryChatId, 'ID чата реестра', false, 64);
    await db.pool.query('UPDATE config SET telegram_registry_chat_id = $1 WHERE id = 1', [chat || null]);
  }
  if (body && body.telegramRegistryThreadId !== undefined) {
    const thread = text(body.telegramRegistryThreadId, 'ID темы реестра', false, 64);
    await db.pool.query('UPDATE config SET telegram_registry_thread_id = $1 WHERE id = 1', [thread || null]);
  }
  return getSettings();
}

module.exports = {
  FILE_KINDS,
  list,
  get,
  create,
  update,
  remove,
  decide,
  decideMany,
  addPayment,
  removePayment,
  addRequestFile,
  setPaymentFile,
  removeFile,
  suggest,
  lookup,
  getOwnerToken,
  checkOwnerToken,
  reissueOwnerToken,
  getSettings,
  updateSettings
};
