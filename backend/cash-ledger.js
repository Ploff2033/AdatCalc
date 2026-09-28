// Строит ту же ведомость ДДС, что и ручной экспорт в v2 (см.
// frontend-v2/js/screen-cash.js::exportToExcel — одна строка на операцию, в
// хронологическом порядке, остаток кассы после каждой отдельной записи), но
// на сервере и без периода — для автосинхронизации в Облако Mail.ru нужна
// всегда полная история завода, а не то, что сейчас выбрано в фильтре
// экрана (см. backend/mailru-sync.js). Копия логики, не общий модуль с
// фронтом — тот же принцип, что и с zip-writer.js/xlsx-writer.js рядом.
const db = require('./db');
const XlsxWriter = require('./xlsx-writer');

const LEDGER_INCOME_COLUMNS = ['concrete_sale', 'other'];
const LEDGER_INCOME_LABELS = { concrete_sale: 'Продажа бетона', other: 'Прочее' };
const LEDGER_EXPENSE_COLUMNS = ['fuel', 'salary', 'parts', 'other'];
const LEDGER_EXPENSE_LABELS = { fuel: 'Топливо', salary: 'Зарплата', parts: 'Закупка автозапчастей', other: 'Прочее' };
const CATEGORY_LABELS = { fuel: 'Топливо', salary: 'ЗП', parts: 'Автозапчасти', other: 'Прочее', concrete_sale: 'Продажа бетона', storno: 'Сторно' };

function ledgerDateLabel(occurredAt) {
  const parts = String(occurredAt).slice(0, 10).split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

async function buildLedgerBuffer(plantId, plantName) {
  const { rows } = await db.pool.query(
    `SELECT id, type, category, amount, comment, receipt_path, order_id, occurred_at, inserted_at, storno_of_id
     FROM cash_entries WHERE plant_id = $1 ORDER BY occurred_at, inserted_at`,
    [plantId]
  );
  const byId = {};
  rows.forEach((r) => { byId[r.id] = r; });

  const orderIds = rows.filter((r) => r.order_id).map((r) => r.order_id);
  let ordersById = {};
  if (orderIds.length) {
    const { rows: orderRows } = await db.pool.query(
      'SELECT id, recipe_name, sale_volume, client_name FROM orders WHERE id = ANY($1)',
      [orderIds]
    );
    orderRows.forEach((o) => { ordersById[o.id] = o; });
  }

  let running = 0;
  rows.forEach((r) => { running += Number(r.amount); r.balanceAfter = running; });

  const S = XlsxWriter.STYLE;
  const head = (v, style) => ({ v, style });
  const blank = (style) => ({ v: '', style });
  const row1 = [head('Дата', S.HEAD_PLAIN), head('Приход наличными', S.HEAD_INCOME), blank(S.HEAD_INCOME),
    head('Расход наличных', S.HEAD_EXPENSE), blank(S.HEAD_EXPENSE), blank(S.HEAD_EXPENSE), blank(S.HEAD_EXPENSE),
    head('Примечание', S.HEAD_PLAIN), head('Текущий остаток', S.HEAD_PLAIN)];
  const row2 = [blank(S.HEAD_PLAIN)]
    .concat(LEDGER_INCOME_COLUMNS.map((c) => head(LEDGER_INCOME_LABELS[c], S.HEAD_INCOME)))
    .concat(LEDGER_EXPENSE_COLUMNS.map((c) => head(LEDGER_EXPENSE_LABELS[c], S.HEAD_EXPENSE)))
    .concat([blank(S.HEAD_PLAIN), blank(S.HEAD_PLAIN)]);

  const dataRows = rows.map((e) => {
    const income = {}, expense = {};
    let note;
    if (e.category === 'storno') {
      const orig = e.storno_of_id && byId[e.storno_of_id];
      const origLabel = orig ? (CATEGORY_LABELS[orig.category] || orig.category) : '';
      const amount = Number(e.amount);
      if (amount >= 0) income.other = Math.abs(amount); else expense.other = Math.abs(amount);
      note = 'Сторно' + (origLabel ? ' (' + origLabel + ')' : '') + (e.comment ? ': ' + e.comment : '');
    } else {
      const amount = Number(e.amount);
      if (e.type === 'income') income[e.category] = Math.abs(amount); else expense[e.category] = Math.abs(amount);
      const bits = [];
      if (e.order_id && ordersById[e.order_id]) {
        const order = ordersById[e.order_id];
        bits.push('заказ: ' + order.recipe_name + ' · ' + Number(order.sale_volume).toFixed(1).replace('.', ',') + ' м³' + (order.client_name ? ' · ' + order.client_name : ''));
      }
      if (e.comment) bits.push(e.comment);
      if (e.receipt_path) bits.push('фото: ' + e.receipt_path.split('/').pop());
      note = bits.join(', ');
    }
    const row = [{ v: ledgerDateLabel(e.occurred_at), style: S.TEXT }];
    LEDGER_INCOME_COLUMNS.forEach((c) => row.push({ v: income[c] || '', num: true, style: S.NUM }));
    LEDGER_EXPENSE_COLUMNS.forEach((c) => row.push({ v: expense[c] || '', num: true, style: S.NUM }));
    row.push({ v: note, style: S.NOTE });
    row.push({ v: e.balanceAfter, num: true, style: S.NUM });
    return row;
  });

  return XlsxWriter.build({
    sheetName: 'ДДС',
    rows: [row1, row2].concat(dataRows),
    merges: ['A1:A2', 'B1:C1', 'D1:G1', 'H1:H2', 'I1:I2'],
    colWidths: [12, 16, 12, 12, 12, 20, 12, 42, 14]
  });
}

module.exports = { buildLedgerBuffer };
