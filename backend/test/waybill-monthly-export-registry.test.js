const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const waybillXlsx4s = require('../waybill-xlsx-4s');

function doc(extra) {
  return Object.assign({
    tripDate: '2025-10-03', createdAt: '2025-10-03T09:00:00.000Z', docNumber: 1,
    plantName: 'Завод', driverName: 'Водитель', mixerName: 'Миксер',
    totalFuelLiters: 120, fuelFactLiters: 120, fuelIssued: 122,
    fuelBalanceAtDeparture: 9.6, fuelBalanceAtReturn: 11.6,
    routes: [{ address: 'Карьер', distanceKm: 50, tripCount: 3 }], legs: []
  }, extra);
}

test('ZIP путевых группирует документы по месяцам и добавляет реестр в корень', async () => {
  const first = doc();
  const second = doc({ tripDate: '2025-11-04', createdAt: '2025-11-04T09:00:00.000Z', docNumber: 2, totalFuelLiters: 80, fuelFactLiters: 80, fuelIssued: 80, fuelBalanceAtDeparture: 11.6, fuelBalanceAtReturn: 11.6 });
  const zip = await JSZip.loadAsync(await waybillXlsx4s.buildWaybillsZip([second, first], 'ООО Тест'));
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  assert.strictEqual(names.length, 3);
  assert.ok(names.some((name) => name.startsWith('Октябрь 2025/')));
  assert.ok(names.some((name) => name.startsWith('Ноябрь 2025/')));
  assert.ok(names.includes('Реестр путевых.xlsx'));

  const registry = await JSZip.loadAsync(await zip.file('Реестр путевых.xlsx').async('nodebuffer'));
  const sheet = await registry.file('xl/worksheets/sheet1.xml').async('string');
  const styles = await registry.file('xl/styles.xml').async('string');
  assert.match(styles, /formatCode="#,##0\.0"/);
  assert.match(sheet, /<c r="J2" s="7"/);
  assert.match(sheet, /<c r="J2"[^>]*><v>120<\/v><\/c>/);
  assert.match(sheet, /<c r="K2"[^>]*><v>120<\/v><\/c>/);
  assert.match(sheet, /<c r="L2"[^>]*><v>122<\/v><\/c>/);
  assert.match(sheet, /<c r="L2" s="0"/, 'выдача показывается целыми литрами');
  assert.match(sheet, /<c r="M2"[^>]*><v>9\.6<\/v><\/c>/);
  assert.match(sheet, /<c r="N2"[^>]*><v>11\.6<\/v><\/c>/);
  assert.match(sheet, /<c r="H2"[^>]*><v>3<\/v><\/c>/);
  assert.match(sheet, /<c r="I2"[^>]*><v>300<\/v><\/c>/);
  assert.match(sheet, /<c r="B6"[^>]*><v>2<\/v><\/c>/, 'общее количество путевых');
  assert.match(sheet, /<c r="K6"[^>]*><v>200<\/v><\/c>/, 'общий факт суммируется без строк месячных итогов');
  assert.match(sheet, /<c r="L6"[^>]*><v>202<\/v><\/c>/);
  assert.match(sheet, /<c r="M6"[^>]*\/>/, 'остатки баков не суммируются');
  assert.match(sheet, /<c r="N6"[^>]*\/>/, 'остатки баков не суммируются');
});

test('ZIP только с одним путевым всё равно содержит реестр', async () => {
  const zip = await JSZip.loadAsync(await waybillXlsx4s.buildWaybillsZip([doc()], 'ООО Тест'));
  assert.ok(zip.file('Реестр путевых.xlsx'));
  assert.strictEqual(Object.keys(zip.files).filter((name) => name.startsWith('Октябрь 2025/') && !zip.files[name].dir).length, 1);
});
