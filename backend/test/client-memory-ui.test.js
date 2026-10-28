// Сценарии спеки orders/client-prefill на чистых функциях
// frontend-v2/js/client-memory.js (подстановка, подсказки, «Вернуть прайс»).
const test = require('node:test');
const assert = require('node:assert');
const CM = require('../../frontend-v2/js/client-memory');

// toLocaleString('ru-RU') разделяет разряды неразрывным пробелом.
const plain = (s) => s.replace(/ | /g, ' ');

const M300 = { id: 'r300', name: 'М300', salePrice: 11000 };
const M350 = { id: 'r350', name: 'М350', salePrice: 11500 };
const MIXERS = [{ id: 'mx1', name: 'Миксер 1', capacity: 8 }];

const stroyinvest = {
  id: 'c1', name: 'СтройИнвест', plantId: 'p1', vatGross: true, termsUpdatedAt: '2026-10-12T10:00:00Z',
  siteAddress: 'ул. Ленина, 5', siteDistanceKm: 12, siteNeighborCity: false, deliveryChargePerM3: 600,
  selfPickup: false, mixerId: 'mx1', maxLoadM3: null,
  prices: [{ recipeId: 'r300', priceNet: 10000, updatedAt: '2026-10-01T09:00:00Z', source: 'crm', sourceLabel: 'CRM · manager' }]
};

test('Постоянный клиент: подстановка условий и цены 12 200 = 10 000 × 1,22', () => {
  const terms = CM.termsToApply(stroyinvest, MIXERS);
  assert.deepStrictEqual(terms, {
    vatGross: true, selfPickup: false, neighborCity: false, maxLoad: null,
    address: 'ул. Ленина, 5', distanceKm: 12, deliveryChargePerM3: 600, mixerId: 'mx1'
  });
  const net = CM.basePriceNet(stroyinvest, M300);
  assert.strictEqual(net, 10000);
  assert.strictEqual(Math.round(net * 1.22), 12200);
});

test('Клиент с самовывозом и ограничением загрузки', () => {
  const c = Object.assign({}, stroyinvest, { selfPickup: true, maxLoadM3: 5 });
  const terms = CM.termsToApply(c, MIXERS);
  assert.strictEqual(terms.selfPickup, true);
  assert.strictEqual(terms.maxLoad, 5);
});

test('Новый клиент без памяти: только режим НДС «без», цена — прайс', () => {
  const fresh = { id: 'c2', name: 'Новый', plantId: 'p1', vatGross: false, termsUpdatedAt: null, prices: [] };
  assert.deepStrictEqual(CM.termsToApply(fresh, MIXERS), { vatGross: false });
  assert.strictEqual(CM.basePriceNet(fresh, M300), 11000);
  assert.strictEqual(CM.basePriceNet(null, M300), 11000);
});

test('Рецепт без цены клиента: прайс 11 500 (14 030 с НДС)', () => {
  const net = CM.basePriceNet(stroyinvest, M350);
  assert.strictEqual(net, 11500);
  assert.strictEqual(Math.round(net * 1.22), 14030);
  assert.strictEqual(plain(CM.priceHint(stroyinvest, M350, true)), 'По прайсу рецепта 14 030 ₽');
});

test('Миксер удалён: не подставляется, остальное подставляется', () => {
  const terms = CM.termsToApply(Object.assign({}, stroyinvest, { mixerId: 'mx3' }), MIXERS);
  assert.strictEqual(terms.mixerId, undefined);
  assert.strictEqual(terms.address, 'ул. Ленина, 5');
  assert.strictEqual(terms.distanceKm, 12);
});

test('Пустые значения памяти не затирают поля формы', () => {
  const partial = Object.assign({}, stroyinvest, { siteAddress: '', siteDistanceKm: null, deliveryChargePerM3: null, mixerId: null });
  const terms = CM.termsToApply(partial, MIXERS);
  for (const k of ['address', 'distanceKm', 'deliveryChargePerM3', 'mixerId']) assert.ok(!(k in terms), k);
});

test('Подсказка с ценой клиента: «Цена клиента 10 700 ₽ от 01.10.2026 · прайс 11 000 ₽»', () => {
  const c = { prices: [{ recipeId: 'r300', priceNet: 10700, updatedAt: '2026-10-01T09:00:00Z' }] };
  assert.strictEqual(plain(CM.priceHint(c, M300, false)), 'Цена клиента 10 700 ₽ от 01.10.2026 · прайс 11 000 ₽');
  assert.strictEqual(plain(CM.priceHint(c, M300, false, true)), 'Цена клиента 10 700 ₽ от 01.10 · прайс 11 000 ₽');
});

test('Подсказка без цены клиента: «По прайсу рецепта 11 000 ₽»', () => {
  assert.strictEqual(plain(CM.priceHint(null, M300, false)), 'По прайсу рецепта 11 000 ₽');
  assert.strictEqual(plain(CM.priceHint({ prices: [] }, M300, false)), 'По прайсу рецепта 11 000 ₽');
});

test('Возврат к цене клиента: «Вернуть прайс» → 10 700, а без цены — прайс', () => {
  const c = { prices: [{ recipeId: 'r300', priceNet: 10700, updatedAt: '2026-10-01T09:00:00Z' }] };
  assert.strictEqual(CM.basePriceNet(c, M300), 10700);
  assert.strictEqual(CM.basePriceNet(c, M350), 11500);
});

test('Список клиентов завода: свои и «Без завода», по алфавиту; смена завода', () => {
  const list = [{ name: 'Б', plantId: 'p2' }, { name: 'В', plantId: null }, { name: 'А', plantId: 'p1' }];
  assert.deepStrictEqual(CM.clientsForPlant(list, 'p1').map((c) => c.name), ['А', 'В']);
  assert.strictEqual(CM.belongsToPlant(list[2], 'p2'), false);
  assert.strictEqual(CM.belongsToPlant(list[1], 'p2'), true);
});

test('Макс. загрузка: нормализация и подсказки', () => {
  const mx = { capacity: 8 };
  assert.strictEqual(CM.normalizeMaxLoad(8, mx), null);
  assert.strictEqual(CM.normalizeMaxLoad(0, mx), null);
  assert.strictEqual(CM.normalizeMaxLoad(null, mx), null);
  assert.strictEqual(CM.normalizeMaxLoad(5, mx), 5);
  assert.deepStrictEqual(CM.loadHint(mx, 5, 20), { text: 'рейсов: 4 вместо 3', warn: false, limited: true });
  assert.deepStrictEqual(CM.loadHint(mx, 10, 20), { text: 'больше вместимости миксера (8 м³), считаем по 8', warn: true, limited: false });
  assert.strictEqual(CM.loadHint(mx, null, 20).text, 'вместимость миксера 8 м³');
  assert.strictEqual(CM.deliverySummary(4, 5, true, 30), 'Доставка · 4 × 5 м³ · 30 км');
  assert.strictEqual(CM.deliverySummary(3, 8, false, 30), 'Доставка · 3 рейс(ов) · 30 км');
});

test('Разовые покупатели: ничего не подставляется, цена — прайс', () => {
  const fiz = Object.assign({}, stroyinvest, { walkIn: true });
  assert.strictEqual(CM.termsToApply(fiz, MIXERS), null);
  assert.strictEqual(CM.priceFor(fiz, 'r300'), null);
  assert.strictEqual(CM.basePriceNet(fiz, M300), 11000);
  assert.strictEqual(plain(CM.priceHint(fiz, M300, false)), 'По прайсу рецепта 11 000 ₽');
});

// change order-hired-delivery: сводка режима «Найм».
test('Сводка найма: «Доставка · Найм · 500 ₽/м³ · 30 км»', () => {
  assert.strictEqual(CM.deliverySummary(0, 0, false, 30, 500), 'Доставка · Найм · 500 ₽/м³ · 30 км');
  assert.strictEqual(CM.deliverySummary(0, 0, false, 30, 0), 'Доставка · Найм · — ₽/м³ · 30 км');
  assert.strictEqual(CM.deliverySummary(3, 8, false, 30, null), 'Доставка · 3 рейс(ов) · 30 км');
});
