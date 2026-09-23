const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

// Официальный бланк формы №4-П (Постановление Госкомстата России от
// 28.11.1997 №78) — реальный .xlsx, а не картинка: рамки/шрифты/объединения
// остаются именно теми, что в оригинале, потому что мы не пересобираем файл
// через библиотеку (это ломает форматирование — проверено), а точечно
// подменяем текст внутри xl/worksheets/sheet1.xml (лист "стр1", лицевая
// сторона) прямо в ZIP-контейнере. Всё остальное — стр2 (оборотная сторона,
// талоны заказчика), стили, размеры — копируется из шаблона как есть.
const TEMPLATE_PATH = path.join(__dirname, 'assets', 'waybill-4p-template.xlsx');
const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const SHEET2_PATH = 'xl/worksheets/sheet2.xml';

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

// Адреса пустых объединённых ячеек бланка — сняты вручную по шаблону
// (первая объединённая ячейка сразу справа/ниже соответствующей подписи).
// При замене файла assets/waybill-4p-template.xlsx другой версией бланка
// их придётся снимать заново (см. scratchpad при разработке).
const CELLS = {
  day: 'BG5',
  month: 'BP5',
  year: 'CL5',
  organization: 'Q6',
  mixerName: 'P12',
  mixerPlate: 'Z13',
  driverName: 'I14',
  driverLicenseNumber: 'O16',
  task: 'A31',
  notesLine1: 'EU32',
  notesLine2: 'EU33',
  // Оборотная сторона (стр2, лист sheet2.xml) — поле "Маршрут движения
  // (откуда-куда):" (метка в B11:AA12), пустая область для заполнения сразу
  // после неё — AB11:BQ12 (снято по шаблону так же, как остальные CELLS).
  route: 'AB11'
};

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatNum(n, decimals) {
  if (!isFinite(n)) n = 0;
  var fixed = n.toFixed(decimals || 0);
  var parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join(',');
}

// Ячейка в шаблоне пустая — либо самозакрывающаяся <c r="X" s="N"/>, либо
// <c r="X" s="N"></c>. В обоих случаях подменяем на inlineStr с нужным
// текстом, сохраняя исходный s="N" (стиль ячейки — рамки, шрифт, выравнивание
// бланка), чтобы визуально ничего кроме текста не изменилось.
function setCell(xml, addr, value) {
  if (!value) return xml;
  var escaped = xmlEscape(value);
  // Ячейка в шаблоне бывает самозакрывающейся (пустая) или с телом (напр.
  // A31 хранит "18" — номер графы бланка, который наше значение заменяет) —
  // нужно захватить весь <c>...</c> целиком, а не только открывающий тег.
  var pattern = new RegExp('<c r="' + addr + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  if (!pattern.test(xml)) return xml;
  return xml.replace(pattern, function (match, attrs) {
    var cleanAttrs = attrs.replace(/\st="[^"]*"/, '');
    return '<c r="' + addr + '"' + cleanAttrs + ' t="inlineStr"><is><t xml:space="preserve">' + escaped + '</t></is></c>';
  });
}

// order.driverName/mixerPlate — снимок на момент рейса (см. handlers/orders.js).
// order.routes — необязательный список маршрутов ОДНОГО путевого листа: когда
// несколько записей путевых листов (handlers/waybill-entries.js) за один
// день у одного и того же водителя и машины относятся к разным заказам/
// расстояниям, роутер (router.js) группирует их в один order с несколькими
// routes вместо нескольких файлов — кол-во путевых листов должно зависеть
// от комбинаций водитель+машина за день, а не от кол-ва записей/заказов.
// Каждый route — { distanceKm, tripCount, fuelCostPerTrip }. Если routes нет
// (обычный заказ из handlers/orders.js), ведём себя как раньше — один
// маршрут из distanceKm/tripCount/fuelCostPerTrip самого order.
// organization — реквизиты организации (config.companyRequisites, см.
// handlers/config.js); если не заданы админом, подставляется название завода.
function buildOrderXml(sheetXml, order, organization) {
  var d = new Date(order.createdAt);
  var routes = (order.routes && order.routes.length)
    ? order.routes
    : [{ distanceKm: order.distanceKm, tripCount: order.tripCount, fuelCostPerTrip: order.fuelCostPerTrip }];
  var totalTripCount = routes.reduce(function (s, r) { return s + (r.tripCount || 0); }, 0);
  var totalDistanceKm = routes.reduce(function (s, r) { return s + (r.distanceKm || 0) * 2 * (r.tripCount || 0); }, 0);
  var totalLiters = order.fuelPricePerLiter > 0
    ? routes.reduce(function (s, r) { return s + (r.tripCount || 0) * (r.fuelCostPerTrip || 0); }, 0) / order.fuelPricePerLiter
    : 0;
  var taskText = routes.length === 1
    ? 'Бетон, ' + formatNum(routes[0].distanceKm, 1) + ' км в одну сторону, ' + routes[0].tripCount + ' рейс(ов)'
    : 'Бетон: ' + routes.map(function (r) {
        return formatNum(r.distanceKm, 1) + ' км — ' + r.tripCount + ' рейс(ов)';
      }).join('; ');

  var xml = sheetXml;
  xml = setCell(xml, CELLS.day, String(d.getDate()));
  xml = setCell(xml, CELLS.month, MONTHS_GENITIVE[d.getMonth()]);
  xml = setCell(xml, CELLS.year, String(d.getFullYear()));
  xml = setCell(xml, CELLS.organization, organization || order.plantName);
  xml = setCell(xml, CELLS.mixerName, order.mixerName);
  xml = setCell(xml, CELLS.mixerPlate, order.mixerPlate || '');
  xml = setCell(xml, CELLS.driverName, order.driverName || '');
  xml = setCell(xml, CELLS.driverLicenseNumber, order.driverLicenseNumber || '');
  xml = setCell(xml, CELLS.task, taskText);
  xml = setCell(xml, CELLS.notesLine1, 'Расч. расход топлива по норме: ' + formatNum(totalLiters, 1) + ' л');
  xml = setCell(xml, CELLS.notesLine2, '(' + totalTripCount + ' рейс, ' + formatNum(totalDistanceKm, 0) + ' км)');
  return xml;
}

// Оборотная сторона (стр2) — поле "Маршрут движения (откуда-куда)": печатаем
// "Название завода → адрес доставки". Адрес у самовывоза/старых заказов без
// адреса может быть пустым — тогда просто не трогаем ячейку (setCell
// пропускает пустые значения), а не пишем "→ " в никуда.
function buildRouteXml(sheet2Xml, order) {
  if (!order.address) return sheet2Xml;
  var routeText = (order.plantName || '') + ' → ' + order.address;
  return setCell(sheet2Xml, CELLS.route, routeText);
}

async function buildOrderWorkbook(order, organization) {
  var buf = fs.readFileSync(TEMPLATE_PATH);
  var zip = await JSZip.loadAsync(buf);
  var sheetXml = await zip.file(SHEET_PATH).async('string');
  zip.file(SHEET_PATH, buildOrderXml(sheetXml, order, organization));
  var sheet2Xml = await zip.file(SHEET2_PATH).async('string');
  zip.file(SHEET2_PATH, buildRouteXml(sheet2Xml, order));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function waybillFileName(order) {
  var date = new Date(order.createdAt).toISOString().slice(0, 10);
  return 'putevoy-list-' + date + '-' + order.id + '.xlsx';
}

// Несколько заказов — .xlsx для Excel это одна книга, а не "страницы", поэтому
// пачкой отдаём zip-архив с отдельным файлом на каждый заказ, а не пытаемся
// склеить их в один файл.
async function buildWaybillsZip(orders, organization) {
  var archive = new JSZip();
  for (var i = 0; i < orders.length; i++) {
    var buf = await buildOrderWorkbook(orders[i], organization);
    archive.file(waybillFileName(orders[i]), buf);
  }
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildOrderWorkbook, buildWaybillsZip, waybillFileName };
