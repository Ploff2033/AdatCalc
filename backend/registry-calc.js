// Реестр оплат — чистая логика без БД: статус заявки, "Не оплачено",
// просрочка, номер, порядок списка, итоги. Статус в БД не хранится (см.
// комментарий к pay_requests в schema.sql) — всё вычисляется здесь, одними
// и теми же функциями и для экрана, и для итогов, и для проверок в
// handlers/registry.js. Деньги считаются в копейках (целые), чтобы
// 0.1 + 0.2 не давало расхождений в сравнениях "оплата не больше остатка".

const STATUS_LABELS = {
  pending: 'Ожидает решения',
  approved: 'Одобрена',
  partial: 'Частично оплачена',
  paid: 'Оплачена',
  rejected: 'Отклонена',
  postponed: 'Отложена'
};

// Порядок групп в списке (спека "Порядок списка"): ждут решения →
// одобрены/частично → отложены; закрытые (оплачена/отклонена) — отдельно.
const GROUP_OF_STATUS = { pending: 0, approved: 1, partial: 1, postponed: 2, paid: 3, rejected: 3 };
const CLOSED_STATUSES = ['paid', 'rejected'];

function toKop(value) {
  if (value === null || value === undefined || value === '') return 0;
  return Math.round(Number(value) * 100);
}

function fromKop(kop) {
  return kop / 100;
}

// "Сегодня" по Москве, а не по часовому поясу контейнера (обычно UTC):
// иначе после 21:00 МСК номер заявки получил бы вчерашнюю дату, а оплата
// "сегодняшним" числом отклонялась бы как будущая.
function todayMoscow(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now || new Date());
}

// '2026-10-12', 57 → '121026-57'
function formatNumber(isoDate, seq) {
  const [y, m, d] = String(isoDate).split('-');
  return d + m + y.slice(2) + '-' + seq;
}

// request: { amount, decision, approved_amount, due_date }; payments: [{ amount }].
// Возвращает суммы в рублях (числа), статус и признак просрочки.
function computeState(request, payments, today) {
  const amountKop = toKop(request.amount);
  const paidKop = (payments || []).reduce((sum, p) => sum + toKop(p.amount), 0);
  let status;
  let unpaidKop;
  let toPayKop = null;
  if (request.decision === 'approved') {
    toPayKop = toKop(request.approved_amount);
    unpaidKop = toPayKop - paidKop;
    if (paidKop === 0) status = 'approved';
    else if (paidKop < toPayKop) status = 'partial';
    else status = 'paid';
  } else if (request.decision === 'rejected') {
    status = 'rejected';
    unpaidKop = 0;
  } else if (request.decision === 'postponed') {
    status = 'postponed';
    unpaidKop = amountKop;
  } else {
    status = 'pending';
    unpaidKop = amountKop;
  }
  const overdue = Boolean(request.due_date && today && request.due_date < today && unpaidKop > 0);
  return {
    status,
    statusLabel: STATUS_LABELS[status],
    closed: CLOSED_STATUSES.includes(status),
    group: GROUP_OF_STATUS[status],
    paid: fromKop(paidKop),
    toPay: toPayKop === null ? null : fromKop(toPayKop),
    unpaid: fromKop(unpaidKop),
    overdue
  };
}

// Сравнение для списка: группа, внутри — срок (ближайший первым, без срока
// в конце), при равенстве — по номеру. Закрытые — свежие сверху.
// a/b: { seq, due_date, state }.
function compareForList(a, b) {
  if (a.state.group !== b.state.group) return a.state.group - b.state.group;
  if (a.state.group === 3) return b.seq - a.seq;
  const da = a.due_date || null;
  const dbb = b.due_date || null;
  if (da !== dbb) {
    if (!da) return 1;
    if (!dbb) return -1;
    return da < dbb ? -1 : 1;
  }
  return a.seq - b.seq;
}

function inPeriod(isoDate, period) {
  if (!period) return true;
  if (period.from && isoDate < period.from) return false;
  if (period.to && isoDate > period.to) return false;
  return true;
}

// Итоги над списком (спека "Итоги"). items: [{ amount, state, payments }]
// — уже отфильтрованные. "Оплачено" — сумма оплат, датированных периодом
// (period: { from, to } в 'YYYY-MM-DD', любое может отсутствовать).
function computeTotals(items, period) {
  const t = {
    pending: { sum: 0, count: 0 },
    toPay: { sum: 0, count: 0 },
    overdue: { sum: 0, count: 0 },
    paid: { sum: 0, count: 0 },
    groups: { 0: { sum: 0, count: 0 }, 1: { sum: 0, count: 0 }, 2: { sum: 0, count: 0 }, 3: { sum: 0, count: 0 } }
  };
  items.forEach((item) => {
    const s = item.state;
    const unpaidKop = toKop(s.unpaid);
    if (s.status === 'pending') {
      t.pending.sum += toKop(item.amount);
      t.pending.count++;
    }
    if (s.status === 'approved' || s.status === 'partial') {
      t.toPay.sum += unpaidKop;
      t.toPay.count++;
    }
    if (s.overdue) {
      t.overdue.sum += unpaidKop;
      t.overdue.count++;
    }
    const paidHere = (item.payments || []).filter((p) => inPeriod(p.paid_on, period));
    if (paidHere.length) {
      t.paid.sum += paidHere.reduce((sum, p) => sum + toKop(p.amount), 0);
      t.paid.count++;
    }
    t.groups[s.group].sum += unpaidKop;
    t.groups[s.group].count++;
  });
  [t.pending, t.toPay, t.overdue, t.paid].concat(Object.values(t.groups)).forEach((x) => { x.sum = fromKop(x.sum); });
  return t;
}

module.exports = {
  STATUS_LABELS,
  CLOSED_STATUSES,
  toKop,
  fromKop,
  todayMoscow,
  formatNumber,
  computeState,
  compareForList,
  computeTotals
};
