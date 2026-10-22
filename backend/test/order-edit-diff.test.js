// Строки журнала исправлений (change order-edit, design.md §6) — без БД.
const test = require('node:test');
const assert = require('node:assert');
const { diffOrder, profitLine, actorLabel } = require('../order-edit-diff');

const BASE = {
  plantName: 'Северный', createdAt: '2026-10-20T11:32:00.000Z', recipeName: 'М300', saleVolume: 10, shipDate: '2026-10-20',
  clientName: 'СтройИнвест', salePrice: 10000, vatApplied: false, mixerName: 'Миксер 1', address: 'ул. Ленина, 5',
  distanceKm: 12, neighborCity: false, deliveryChargePerM3: 600, maxLoadM3: null, fuelPricePerLiter: 75.15, ureaPricePerLiter: 60
};
const edit = (patch) => Object.assign({}, BASE, patch);
const texts = (changes) => changes.map((c) => c.text);

test('Запись журнала: объём, цена и прибыль', () => {
  const changes = diffOrder(BASE, edit({ saleVolume: 12, salePrice: 10700 }));
  assert.deepStrictEqual(texts(changes), ['Объём: 10 → 12 м³', 'Цена: 10 000 → 10 700 ₽']);
  assert.strictEqual(profitLine(34000, 41200), 'Прибыль: 34 000 → 41 200 ₽');
});

test('Цена в заказе с НДС — как отдали клиенту', () => {
  const vat = edit({ vatApplied: true });
  assert.deepStrictEqual(texts(diffOrder(vat, edit({ vatApplied: true, salePrice: 11000 }))), ['Цена: 12 200 → 13 420 ₽ с НДС']);
  assert.deepStrictEqual(texts(diffOrder(BASE, vat)), ['Цена: 10 000 ₽ → 12 200 ₽ с НДС', 'НДС: без НДС → с НДС']);
});

test('Пустой адрес и макс. загрузка по вместимости', () => {
  assert.deepStrictEqual(texts(diffOrder(BASE, edit({ address: '' }))), ['Адрес: ул. Ленина, 5 → —']);
  assert.deepStrictEqual(texts(diffOrder(edit({ maxLoadM3: 5 }), BASE)), ['Макс. загрузка: 5 м³ → по вместимости']);
});

test('Дата в часовом поясе Москвы, дата отгрузки', () => {
  assert.deepStrictEqual(
    texts(diffOrder(BASE, edit({ createdAt: '2026-10-21T11:32:00.000Z', shipDate: '2026-10-21' }))),
    ['Дата: 20.10.2026 14:32 → 21.10.2026 14:32', 'Дата отгрузки: 20.10.2026 → 21.10.2026']
  );
});

test('Самовывоз: миксер без названия, без госномера', () => {
  const changes = diffOrder(BASE, edit({ mixerName: 'Самовывоз' }));
  assert.deepStrictEqual(texts(changes), ['Самовывоз: нет → да', 'Миксер: Миксер 1 → —']);
});

test('Без изменений — пустой список, шум float не считается', () => {
  assert.deepStrictEqual(diffOrder(BASE, edit({})), []);
  assert.deepStrictEqual(diffOrder(BASE, edit({ saleVolume: 10.0000001, fuelPricePerLiter: 75.150004 })), []);
});

test('Подпись того, кто исправил', () => {
  assert.strictEqual(actorLabel('worker', 'Северный'), 'Работник · Северный');
  assert.strictEqual(actorLabel('manager'), 'Менеджер');
  assert.strictEqual(actorLabel('admin'), 'Admin');
});
