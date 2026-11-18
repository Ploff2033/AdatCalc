const XlsxWriter = require('./xlsx-writer');

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const HEAD = XlsxWriter.STYLE.HEAD_PLAIN;
const TEXT = XlsxWriter.STYLE.TEXT;
const NUM = XlsxWriter.STYLE.NUM;
const DECIMAL1 = XlsxWriter.STYLE.DECIMAL1;

function text(v, style) { return { v: v == null ? '' : String(v), style: style == null ? TEXT : style }; }
function num(v, style) { return { v: Number(v) || 0, num: true, style: style == null ? NUM : style }; }
function round1(v) { return Math.round((Number(v) + Number.EPSILON) * 10) / 10; }

function dateParts(doc) {
  const raw = String(doc.tripDate || doc.createdAt || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) return { year: Number(match[1]), month: Number(match[2]), date: `${match[3]}.${match[2]}.${match[1]}` };
  const d = new Date(doc.createdAt);
  if (Number.isNaN(d.getTime())) return { year: 0, month: 0, date: '' };
  return { year: d.getFullYear(), month: d.getMonth() + 1, date: d.toLocaleDateString('ru-RU') };
}

function monthFolder(doc) {
  const p = dateParts(doc);
  return `${MONTHS[p.month - 1] || 'Без месяца'} ${p.year || ''}`.trim();
}

function routeLabel(doc) {
  return (doc.routes || []).map((r) => {
    const point = r.address || r.plantName || r.cargo || '';
    return `${point}${r.tripCount > 1 ? ` (${r.tripCount} рейс.)` : ''}`;
  }).filter(Boolean).join('; ');
}

function documentValues(doc) {
  const routes = doc.routes || [];
  const trips = routes.reduce((sum, r) => sum + (Number(r.tripCount) || 0), 0);
  const km = routes.reduce((sum, r) => sum + (Number(r.distanceKm) || 0) * 2 * (Number(r.tripCount) || 0), 0);
  return {
    month: monthFolder(doc),
    date: dateParts(doc).date,
    number: doc.docNumber || '',
    driver: doc.driverName || '',
    vehicle: [doc.mixerName, doc.mixerPlate].filter(Boolean).join(' '),
    route: routeLabel(doc),
    trips,
    km,
    norm: Number(doc.totalFuelLiters) || 0,
    fact: Number(doc.fuelFactLiters) || 0,
    issued: Number(doc.fuelIssued) || 0,
    departure: doc.fuelBalanceAtDeparture == null ? '' : Number(doc.fuelBalanceAtDeparture),
    arrival: doc.fuelBalanceAtReturn == null ? '' : Number(doc.fuelBalanceAtReturn)
  };
}

function sumRows(rows) {
  return rows.reduce((s, r) => ({
    docs: s.docs + 1,
    trips: s.trips + r.trips,
    km: s.km + r.km,
    norm: round1(s.norm + r.norm),
    fact: round1(s.fact + r.fact),
    issued: s.issued + r.issued
  }), { docs: 0, trips: 0, km: 0, norm: 0, fact: 0, issued: 0 });
}

function totalRow(label, totals) {
  return [text(label, HEAD), num(totals.docs, XlsxWriter.STYLE.DEFAULT), text(''), text(''), text(''), text(''), text(''), num(totals.trips, XlsxWriter.STYLE.DEFAULT), num(totals.km), num(totals.norm, DECIMAL1), num(totals.fact, DECIMAL1), num(totals.issued, XlsxWriter.STYLE.DEFAULT), text(''), text('')];
}

function buildRegistryWorkbook(docs) {
  const headers = ['Месяц', 'Путевых', 'Дата', '№ путевого', 'Водитель', 'Транспорт', 'Маршрут / пункт назначения', 'Рейсов', 'Пробег, км', 'Норма, л', 'Факт, л', 'Выдано, л', 'Остаток при выезде, л', 'Остаток при возвращении, л'];
  const values = docs.map(documentValues);
  const groups = new Map();
  values.forEach((r) => {
    if (!groups.has(r.month)) groups.set(r.month, []);
    groups.get(r.month).push(r);
  });

  const rows = [headers.map((h) => text(h, HEAD))];
  for (const [month, monthRows] of groups) {
    monthRows.forEach((r) => rows.push([
      text(r.month), num(1), text(r.date), text(r.number), text(r.driver), text(r.vehicle), text(r.route),
      num(r.trips, XlsxWriter.STYLE.DEFAULT), num(r.km), num(r.norm, DECIMAL1), num(r.fact, DECIMAL1), num(r.issued, XlsxWriter.STYLE.DEFAULT),
      r.departure === '' ? text('') : num(r.departure, DECIMAL1), r.arrival === '' ? text('') : num(r.arrival, DECIMAL1)
    ]));
    rows.push(totalRow(`Итого за ${month} (${monthRows.length} пут.)`, sumRows(monthRows)));
  }
  rows.push(totalRow('ОБЩИЙ ИТОГ', sumRows(values)));

  return XlsxWriter.build({
    sheetName: 'Реестр',
    rows,
    colWidths: [18, 10, 12, 14, 24, 26, 42, 10, 13, 13, 13, 13, 20, 24]
  });
}

module.exports = { buildRegistryWorkbook, monthFolder, documentValues, sumRows };
