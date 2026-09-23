const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

// Официальный бланк формы №4-С (повременная), присланный пользователем в
// виде УЖЕ ПУСТОГО файла (без примера) — см. обсуждение перехода с 4-П на
// 4-С (аудиторы настаивают на 4-С). Та же техника патчинга XML внутри ZIP,
// что и в waybill-xlsx.js (форма 4-П) — не пересобираем файл через
// библиотеку, чтобы не сломать официальное форматирование.
//
// Аудиторы явно разрешили НЕ печатать время (только дату, километраж и
// одометр) — поэтому все графы времени (час/мин выезда-возврата, время
// ездок на обороте, "Таксировка"/зарплата) сознательно не заполняются,
// хотя в бланке эти поля есть. Подписи техосмотра/медосмотра тоже не
// заполняются — заполнять нечем (нет такого процесса в системе).
const TEMPLATE_PATH = path.join(__dirname, 'assets', 'waybill-4s-template.xlsx');
const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const SHEET2_PATH = 'xl/worksheets/sheet2.xml';

// Адреса сняты вручную по чистому бланку (см. scratchpad при разработке) —
// при замене файла шаблона другой версией бланка их придётся снимать заново.
const CELLS = {
  // "грузового автомобиля от " и "срок действия: за период с ... по ..." —
  // в бланке это цельные ячейки с текстом лейбла, дата дописывается в ту же
  // строку (а не в отдельную ячейку рядом) — поэтому здесь пишем ПОЛНЫЙ текст
  // целиком, а не только значение.
  dateLine: 'K3',
  periodLine: 'B4',
  organization: 'H6',
  vehicleModel: 'I12',
  vehiclePlate: 'L13',
  driverName: 'E14',
  driverLicense: 'E16',
  // Блок "Работа водителя и автомобиля": строка "выезд из гаража" (13/14 —
  // в этом бланке фактически строка 14) и "возвращение в гараж" (16).
  // Час/минуты (time) сознательно не трогаем.
  depDay: 'AI14',
  depMonth: 'AK14',
  depOdometer: 'AQ14',
  retDay: 'AI16',
  retMonth: 'AK16',
  retOdometer: 'AQ16'
};

// "ЗАДАНИЕ ВОДИТЕЛЮ" — таблица маршрутов. В бланке под неё реально есть
// только 2 строки (37 — обычная, с отдельными графами; 38 — объединённая
// широкая ячейка для клиента/адреса + отдельные графы кол-ва/км/тонн,
// делит высоту со строкой подписи 39). Если маршрутов в документе больше
// двух — редкий случай при лимите 3 поездки на документ (см. router.js) —
// остаток сворачиваем во вторую строку через "/", а не теряем молча.
const TASK_ROW1 = { customer: 'B37', pickup: 'R37', dropoff: 'AB37', cargo: 'AL37', trips: 'AS37', distanceKm: 'AW37' };
const TASK_ROW2_WIDE = 'B38'; // клиент+завод+груз одной строкой (объединённая ячейка)
const TASK_ROW2 = { trips: 'AS38', distanceKm: 'AW38' };

// Обратная сторона: "ПОСЛЕДОВАТЕЛЬНОСТЬ ВЫПОЛНЕНИЯ ЗАДАНИЯ" — под неё в
// бланке ровно 6 строк (8–13и), то есть максимум 3 ездки (пара
// погрузка/разгрузка на каждую) — см. buildWaybill4sDocuments в
// router.js, которая режет документы по 3 поездки именно из-за этого лимита.
const BACK_LEG_FIRST_ROW = 8;
const BACK_POINT_COL = 'A';
const BACK_TRIPNUM_COL = 'J';

// "РЕЗУЛЬТАТЫ РАБОТЫ АВТОМОБИЛЯ" — расход ГСМ по норме/факту и общий пробег
// за документ. "Факт" = "норма", потому что расход считается по норме, а не
// по реальным заправкам (см. обсуждение с пользователем — план и факт
// совпадают по построению, это осознанное решение, а не недосмотр).
const CELLS_RESULTS = { fuelNorm: 'A33', fuelFact: 'C33', mileageTotal: 'AD33' };

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

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// Та же setCell, что в waybill-xlsx.js — см. комментарий там: захватывает
// весь <c>...</c> целиком (ячейка может быть self-closing, пустой с телом
// или уже содержать текст лейбла — как здесь у dateLine/periodLine), меняет
// на inlineStr с нужным текстом, сохраняя исходный стиль (s="N").
function setCell(xml, addr, value) {
  if (!value) return xml;
  var escaped = xmlEscape(value);
  var pattern = new RegExp('<c r="' + addr + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  if (!pattern.test(xml)) return xml;
  return xml.replace(pattern, function (match, attrs) {
    var cleanAttrs = attrs.replace(/\st="[^"]*"/, '');
    return '<c r="' + addr + '"' + cleanAttrs + ' t="inlineStr"><is><t xml:space="preserve">' + escaped + '</t></is></c>';
  });
}

// doc — один документ (после разбиения по 3 поездки, см. router.js):
// { createdAt, driverName, driverLicenseNumber, mixerName, mixerPlate,
//   odometerStart, odometerEnd, fuelPricePerLiter,
//   routes: [{ address, plantName, distanceKm, tripCount, fuelCostPerTrip }],
//   legs: [{ plantName, address }] }  — legs: один элемент на каждую
// отдельную поездку в документе (макс. 3), для журнала на обороте.
function buildFrontXml(sheetXml, doc, organization) {
  var d = new Date(doc.createdAt);
  var dateStr = pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();

  var xml = sheetXml;
  xml = setCell(xml, CELLS.dateLine, 'грузового автомобиля от ' + dateStr);
  xml = setCell(xml, CELLS.periodLine, 'срок действия: за период с ' + dateStr + ' по ' + dateStr);
  xml = setCell(xml, CELLS.organization, organization || (doc.routes[0] && doc.routes[0].plantName) || '');
  xml = setCell(xml, CELLS.vehicleModel, doc.mixerName || '');
  xml = setCell(xml, CELLS.vehiclePlate, doc.mixerPlate || '');
  xml = setCell(xml, CELLS.driverName, doc.driverName || '');
  xml = setCell(xml, CELLS.driverLicense, doc.driverLicenseNumber || '');
  xml = setCell(xml, CELLS.depDay, String(d.getDate()));
  xml = setCell(xml, CELLS.depMonth, String(d.getMonth() + 1));
  xml = setCell(xml, CELLS.depOdometer, formatNum(doc.odometerStart, 0));
  xml = setCell(xml, CELLS.retDay, String(d.getDate()));
  xml = setCell(xml, CELLS.retMonth, String(d.getMonth() + 1));
  xml = setCell(xml, CELLS.retOdometer, formatNum(doc.odometerEnd, 0));

  var routes = doc.routes || [];
  if (routes[0]) {
    var r1 = routes[0];
    xml = setCell(xml, TASK_ROW1.customer, r1.address || '');
    xml = setCell(xml, TASK_ROW1.pickup, r1.plantName || '');
    xml = setCell(xml, TASK_ROW1.dropoff, r1.address || '');
    xml = setCell(xml, TASK_ROW1.cargo, 'Бетон');
    xml = setCell(xml, TASK_ROW1.trips, String(r1.tripCount));
    xml = setCell(xml, TASK_ROW1.distanceKm, formatNum(r1.distanceKm, 1));
  }
  if (routes.length > 1) {
    // Остаток (обычно один маршрут, редко больше) — во вторую, объединённую
    // строку: клиент/завод текстом, кол-во и км — суммой/первым значением.
    var rest = routes.slice(1);
    var wideText = rest.map(function (r) {
      return (r.address || '') + ' — ' + (r.plantName || '') + ', Бетон';
    }).join(' / ');
    var restTrips = rest.reduce(function (s, r) { return s + (r.tripCount || 0); }, 0);
    xml = setCell(xml, TASK_ROW2_WIDE, wideText);
    xml = setCell(xml, TASK_ROW2.trips, String(restTrips));
    xml = setCell(xml, TASK_ROW2.distanceKm, formatNum(rest[0].distanceKm, 1));
  }
  return xml;
}

function buildBackXml(sheet2Xml, doc) {
  var xml = sheet2Xml;
  var legs = (doc.legs || []).slice(0, 3);
  legs.forEach(function (leg, i) {
    var pickupRow = BACK_LEG_FIRST_ROW + i * 2;
    var dropoffRow = pickupRow + 1;
    xml = setCell(xml, BACK_POINT_COL + pickupRow, leg.plantName || '');
    xml = setCell(xml, BACK_TRIPNUM_COL + pickupRow, String(i + 1));
    xml = setCell(xml, BACK_POINT_COL + dropoffRow, leg.address || '');
    xml = setCell(xml, BACK_TRIPNUM_COL + dropoffRow, String(i + 1));
  });

  var routes = doc.routes || [];
  var totalLiters = doc.fuelPricePerLiter > 0
    ? routes.reduce(function (s, r) { return s + (r.tripCount || 0) * (r.fuelCostPerTrip || 0); }, 0) / doc.fuelPricePerLiter
    : 0;
  var totalKm = routes.reduce(function (s, r) { return s + (r.distanceKm || 0) * 2 * (r.tripCount || 0); }, 0);
  xml = setCell(xml, CELLS_RESULTS.fuelNorm, formatNum(totalLiters, 1));
  xml = setCell(xml, CELLS_RESULTS.fuelFact, formatNum(totalLiters, 1));
  xml = setCell(xml, CELLS_RESULTS.mileageTotal, formatNum(totalKm, 0));
  return xml;
}

async function buildDocumentWorkbook(doc, organization) {
  var buf = fs.readFileSync(TEMPLATE_PATH);
  var zip = await JSZip.loadAsync(buf);
  var sheetXml = await zip.file(SHEET_PATH).async('string');
  zip.file(SHEET_PATH, buildFrontXml(sheetXml, doc, organization));
  var sheet2Xml = await zip.file(SHEET2_PATH).async('string');
  zip.file(SHEET2_PATH, buildBackXml(sheet2Xml, doc));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function waybillFileName(doc) {
  var date = new Date(doc.createdAt).toISOString().slice(0, 10);
  return 'putevoy-list-4s-' + date + '-' + doc.id + '.xlsx';
}

async function buildWaybillsZip(docs, organization) {
  var archive = new JSZip();
  for (var i = 0; i < docs.length; i++) {
    var buf = await buildDocumentWorkbook(docs[i], organization);
    archive.file(waybillFileName(docs[i]), buf);
  }
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildDocumentWorkbook, buildWaybillsZip, waybillFileName };
