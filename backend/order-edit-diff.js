// Что изменилось в заказе при исправлении (change order-edit) — для журнала
// order_edits и сообщения в чат заказов. Чистые функции без БД: на входе два
// заказа в форме rowToOrder() (camelCase), на выходе готовые строки.
//
// Сравниваются только поля формы, которые вводит оператор, — внутренние поля
// расчёта (себестоимость, рейсы, выручка) в журнал не идут, их видно в самом
// заказе; прибыль — отдельной строкой (profitLine). Сравнение — по уже
// отформатированным значениям: числа выводятся с точностью до сотых, так что
// шум float (10 vs 10.0000001) изменением не считается.

const VAT_MULT = 1.22;
const SELF_PICKUP = 'Самовывоз';
const HIRED = 'Найм';
const DELIVERY_MODE_LABELS = { own: 'Своя', pickup: 'Самовывоз', hired: 'Найм' };

// ru-RU разделяет разряды неразрывным пробелом — в журнале и Telegram нужен
// обычный, иначе строки не совпадают с тем, что набирают в тестах и поиске.
function number(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/\s/g, ' ');
}

function moscowDateTime(iso) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso))) parts[p.type] = p.value;
  return parts.day + '.' + parts.month + '.' + parts.year + ' ' + parts.hour + ':' + parts.minute;
}

function moscowDate(iso) {
  return moscowDateTime(iso).slice(0, 10);
}

function plainDate(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return d + '.' + m + '.' + y;
}

// Режим доставки (change order-hired-delivery); у заказа без поля режима
// (в журнале — снимок до выкатки) — по прежнему признаку в mixerName.
function deliveryMode(o) {
  if (o.deliveryMode) return o.deliveryMode;
  if (o.mixerName === SELF_PICKUP) return 'pickup';
  if (o.mixerName === HIRED) return 'hired';
  return 'own';
}
const yesNo = (v) => (v ? 'да' : 'нет');
const text = (v) => ({ value: v ? String(v) : '—', unit: '' });

// Каждое поле → { value, unit }: при одинаковой единице строка журнала
// короче — «Объём: 10 → 12 м³», при разной — «10 000 ₽ → 12 200 ₽ с НДС».
const FIELDS = [
  ['plant', 'Завод', (o) => text(o.plantName)],
  ['createdAt', 'Дата', (o) => text(moscowDateTime(o.createdAt))],
  ['recipe', 'Рецепт', (o) => text(o.recipeName)],
  ['saleVolume', 'Объём', (o) => ({ value: number(o.saleVolume), unit: 'м³' })],
  ['shipDate', 'Дата отгрузки', (o) => text(plainDate(o.shipDate))],
  ['client', 'Клиент', (o) => text(o.clientName)],
  // Цена — в том виде, в каком её отдали клиенту (с НДС, если он применялся).
  ['salePrice', 'Цена', (o) => (o.vatApplied
    ? { value: number(Math.round(o.salePrice * VAT_MULT * 100) / 100), unit: '₽ с НДС' }
    : { value: number(o.salePrice), unit: '₽' })],
  ['vatApplied', 'НДС', (o) => text(o.vatApplied ? 'с НДС' : 'без НДС')],
  ['deliveryMode', 'Доставка', (o) => text(DELIVERY_MODE_LABELS[deliveryMode(o)])],
  ['hireRatePerM3', 'Ставка найма', (o) => (o.hireRatePerM3 == null ? { value: '—', unit: '₽/м³' } : { value: number(o.hireRatePerM3), unit: '₽/м³' })],
  ['address', 'Адрес', (o) => text(o.address)],
  ['distanceKm', 'Км', (o) => ({ value: number(o.distanceKm), unit: 'км' })],
  ['neighborCity', 'Соседний город', (o) => text(yesNo(o.neighborCity))],
  ['deliveryChargePerM3', 'Цена доставки', (o) => ({ value: number(o.deliveryChargePerM3), unit: '₽/м³' })],
  // Только название — госномер в журнал не пишем.
  ['mixer', 'Миксер', (o) => text(deliveryMode(o) === 'own' ? o.mixerName : '')],
  ['maxLoadM3', 'Макс. загрузка', (o) => (o.maxLoadM3 == null ? text('по вместимости') : { value: number(o.maxLoadM3), unit: 'м³' })],
  ['fuelPricePerLiter', 'Цена топлива', (o) => ({ value: number(o.fuelPricePerLiter), unit: '₽/л' })],
  ['ureaPricePerLiter', 'Цена мочевины', (o) => ({ value: number(o.ureaPricePerLiter), unit: '₽/л' })]
];

function joined(v) {
  return v.unit ? v.value + ' ' + v.unit : v.value;
}

function line(label, a, b) {
  const pair = a.unit === b.unit && a.unit
    ? a.value + ' → ' + b.value + ' ' + a.unit
    : joined(a) + ' → ' + joined(b);
  return label + ': ' + pair;
}

// [{ field, label, before, after, text }] — только изменённые поля, в
// порядке формы. Пустой список — исправление ничего не поменяло.
function diffOrder(before, after) {
  const changes = [];
  for (const [field, label, fmt] of FIELDS) {
    const a = fmt(before);
    const b = fmt(after);
    if (joined(a) === joined(b)) continue;
    changes.push({ field, label, before: joined(a), after: joined(b), text: line(label, a, b) });
  }
  return changes;
}

function profitLine(profitBefore, profitAfter) {
  return line('Прибыль', { value: number(Math.round(profitBefore)), unit: '₽' }, { value: number(Math.round(profitAfter)), unit: '₽' });
}

// «Работник · Северный» / «Менеджер» / «Admin».
function actorLabel(role, plantName) {
  if (role === 'admin') return 'Admin';
  if (role === 'manager') return 'Менеджер';
  return plantName ? 'Работник · ' + plantName : 'Работник';
}

module.exports = { diffOrder, profitLine, actorLabel, moscowDateTime, moscowDate, plainDate };
