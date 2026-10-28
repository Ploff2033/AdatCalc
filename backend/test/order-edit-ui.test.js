// Сценарии спеки orders/order-edit на чистых функциях
// frontend-v2/js/order-edit.js: кнопка «Исправить», заполнение формы из
// заказа, блокировки, «было → стало», журнал, выход из режима при ошибке.
const test = require('node:test');
const assert = require('node:assert');
const OE = require('../../frontend-v2/js/order-edit');

const HOUR = 3600 * 1000;
const NOW = new Date('2026-10-21T16:00:00.000Z');

const RECIPES = [{ id: 'r300', plantId: 'p1', name: 'М300', salePrice: 11000 }, { id: 'r350', plantId: 'p1', name: 'М350', salePrice: 11500 }];
const MIXERS = [{ id: 'mx1', name: 'Миксер 1', capacity: 8 }];
const CLIENTS = [{ id: 'c1', name: 'СтройИнвест', plantId: 'p1' }];
const DATA = { recipes: RECIPES, mixers: MIXERS, clients: CLIENTS };

function order(patch) {
  return Object.assign({
    id: 'o1', plantId: 'p1', plantName: 'Северный', clientId: 'c1', clientName: 'СтройИнвест',
    createdAt: '2026-10-20T09:00:00.000Z', insertedAt: '2026-10-20T09:00:00.000Z', version: 1,
    recipeId: 'r300', recipeName: 'М300', mixerId: 'mx1', mixerName: 'Миксер 1',
    saleVolume: 10, shipDate: '2026-10-20', salePrice: 10000, vatApplied: false,
    address: 'ул. Ленина, 5', distanceKm: 12, neighborCity: false, deliveryChargePerM3: 600, maxLoadM3: null,
    fuelPricePerLiter: 74, ureaPricePerLiter: 60,
    totalRevenue: 106000, mixCost: 50000, deliveryCostTotal: 6000, totalProfit: 50000,
    cancelledAt: null, hasWaybills: false, edits: []
  }, patch);
}

// Payload формы, как его собирает order-calc.js::toOrderPayload, — для
// заказа без правок совпадает с ним по полям формы.
function payload(o, patch) {
  return Object.assign({
    plantId: o.plantId, createdAt: o.createdAt, recipeName: o.recipeName, saleVolume: o.saleVolume, shipDate: o.shipDate,
    clientId: o.clientId, salePrice: o.salePrice, vatApplied: o.vatApplied, mixerName: o.mixerName, address: o.address,
    distanceKm: o.distanceKm, neighborCity: o.neighborCity, deliveryChargePerM3: o.deliveryChargePerM3, maxLoadM3: o.maxLoadM3,
    fuelPricePerLiter: o.fuelPricePerLiter, ureaPricePerLiter: o.ureaPricePerLiter,
    totalRevenue: o.totalRevenue, mixCost: o.mixCost, deliveryCostTotal: o.deliveryCostTotal, totalProfit: o.totalProfit
  }, patch);
}

// ---- 6.1 Кнопка «Исправить» ----

test('Кнопка у работника: 23 ч — есть, 25 ч — нет', () => {
  const at = (h) => order({ insertedAt: new Date(NOW - h * HOUR).toISOString() });
  assert.strictEqual(OE.canEdit(at(23), { role: null, now: NOW, recipes: RECIPES }).show, true);
  assert.strictEqual(OE.canEdit(at(25), { role: null, now: NOW, recipes: RECIPES }).show, false);
});

test('Окно считается от момента добавления, а не от даты заказа', () => {
  const o = order({ insertedAt: new Date(NOW - 72 * HOUR).toISOString(), createdAt: NOW.toISOString() });
  assert.strictEqual(OE.canEdit(o, { role: null, now: NOW, recipes: RECIPES }).show, false);
});

test('Менеджер и admin — без ограничения по времени', () => {
  const old = order({ insertedAt: '2026-09-01T09:00:00.000Z' });
  assert.strictEqual(OE.canEdit(old, { role: 'manager', now: NOW, recipes: RECIPES }).enabled, true);
  assert.strictEqual(OE.canEdit(old, { role: 'admin', now: NOW, recipes: RECIPES }).enabled, true);
});

test('Отменённый заказ — кнопки нет', () => {
  assert.strictEqual(OE.canEdit(order({ cancelledAt: '2026-10-20T10:00:00.000Z' }), { role: 'admin', now: NOW, recipes: RECIPES }).show, false);
});

test('Рецепт не найден и заблокирован — кнопка неактивна с подсказкой', () => {
  const o = order({ recipeId: null, recipeName: 'М100', hasWaybills: true });
  assert.deepStrictEqual(OE.canEdit(o, { role: 'manager', now: NOW, recipes: RECIPES }), {
    show: true, enabled: false, reason: 'Рецепт заказа не найден, а по заказу есть путевые листы'
  });
  // Без путевых рецепт просто выбирают заново.
  assert.strictEqual(OE.canEdit(order({ recipeId: null, recipeName: 'М100' }), { role: 'manager', now: NOW, recipes: RECIPES }).enabled, true);
});

// ---- 6.2 Журнал ----

test('Просмотр правок: строки журнала, последняя сверху', () => {
  const o = order({
    edits: [
      { editedAt: '2026-10-20T11:40:00.000Z', actor: 'Менеджер', changes: [{ text: 'Цена: 10 000 → 10 700 ₽' }], profit: 'Прибыль: 41 200 → 48 200 ₽' },
      { editedAt: '2026-10-20T11:32:00.000Z', actor: 'Работник · Северный', changes: [{ text: 'Объём: 10 → 12 м³' }], profit: 'Прибыль: 34 000 → 41 200 ₽' }
    ]
  });
  assert.deepStrictEqual(OE.editLines(o), [
    '20.10 14:40 · Менеджер · Цена: 10 000 → 10 700 ₽, Прибыль: 41 200 → 48 200 ₽',
    '20.10 14:32 · Работник · Северный · Объём: 10 → 12 м³, Прибыль: 34 000 → 41 200 ₽'
  ]);
  assert.deepStrictEqual(OE.editLines(order()), []);
});

// ---- 7.1 Режим исправления ----

test('Открытие исправления: плашка, кнопка неактивна без изменений', () => {
  const o = order();
  assert.strictEqual(OE.bannerTitle(o), 'Исправление заказа · СтройИнвест · 20.10.2026');
  assert.strictEqual(OE.isDirty(o, payload(o)), false);
  assert.strictEqual(OE.isDirty(o, payload(o, { saleVolume: 12 })), true);
  assert.strictEqual(OE.isDirty(o, null), false);
});

test('Шум расчёта и минуты даты не считаются изменением', () => {
  const o = order({ createdAt: '2026-10-20T09:00:47.123Z' });
  assert.strictEqual(OE.isDirty(o, payload(o, { salePrice: 10000.0000001, createdAt: '2026-10-20T09:00:00.000Z' })), false);
  assert.strictEqual(OE.isDirty(o, payload(o, { createdAt: '2026-10-20T10:00:00.000Z' })), true);
});

test('Отмена и сохранение выходят из режима', () => {
  OE.start(order());
  assert.strictEqual(OE.current().id, 'o1');
  assert.strictEqual(OE.takeFill('desktop'), true);
  assert.strictEqual(OE.takeFill('desktop'), false, 'форма заполняется один раз');
  assert.strictEqual(OE.takeFill('mobile'), true);
  // Разметку пересобрали (брейкпоинт) — заполнение применяется заново.
  OE.releaseFill('desktop');
  assert.strictEqual(OE.takeFill('desktop'), true);
  OE.finish();
  assert.strictEqual(OE.current(), null);
  assert.strictEqual(OE.takeFill('desktop'), false);
});

// ---- 7.2 Заполнение из заказа ----

test('Заказ с ручными ценами топлива и память клиента не затирает заказ', () => {
  const st = OE.formState(order(), DATA);
  assert.strictEqual(st.fuelPrice, 74);
  assert.strictEqual(st.ureaPrice, 60);
  assert.strictEqual(st.address, 'ул. Ленина, 5');
  assert.strictEqual(st.distanceKm, 12);
  assert.strictEqual(st.recipeId, 'r300');
  assert.strictEqual(st.mixerId, 'mx1');
  assert.strictEqual(st.clientId, 'c1');
});

test('Цена с НДС: режим «с НДС», цена без НДС в заказе', () => {
  const st = OE.formState(order({ vatApplied: true }), DATA);
  assert.strictEqual(st.vatGross, true);
  assert.strictEqual(Math.round(st.priceNet * OE.VAT_MULT), 12200);
});

test('Заказ без ограничения загрузки — поле по вместимости', () => {
  assert.strictEqual(OE.formState(order(), DATA).maxLoad, null);
  assert.strictEqual(OE.formState(order({ maxLoadM3: 5 }), DATA).maxLoad, 5);
});

test('Рецепт удалён — поле пустое; старый заказ — поиск по названию', () => {
  assert.strictEqual(OE.formState(order({ recipeId: null, recipeName: 'М100' }), DATA).recipeId, '');
  assert.strictEqual(OE.formState(order({ recipeId: null, recipeName: 'М350' }), DATA).recipeId, 'r350');
  assert.strictEqual(OE.formState(order({ mixerId: null }), DATA).mixerId, 'mx1');
});

test('Клиент удалён — поле клиента пустое', () => {
  assert.strictEqual(OE.formState(order({ clientId: 'gone' }), DATA).clientId, '');
  assert.strictEqual(OE.formState(order({ clientId: null }), DATA).clientId, '');
});

test('Заказ без даты отгрузки — дата заказа', () => {
  assert.strictEqual(OE.formState(order({ shipDate: null, createdAt: '2026-09-15T10:00:00.000Z' }), DATA).shipDate, '2026-09-15');
  // и такой заказ не считается изменённым сразу после открытия
  const o = order({ shipDate: null, createdAt: '2026-09-15T10:00:00.000Z' });
  assert.strictEqual(OE.isDirty(o, payload(o, { shipDate: '2026-09-15' })), false);
});

test('Самовывоз: доставка пустая, изменений нет', () => {
  const o = order({ mixerName: 'Самовывоз', mixerId: null, distanceKm: 0, address: '', deliveryChargePerM3: 0 });
  const st = OE.formState(o, DATA);
  assert.strictEqual(st.selfPickup, true);
  assert.strictEqual(st.mixerId, '');
  assert.strictEqual(st.distanceKm, '');
  assert.strictEqual(OE.isDirty(o, payload(o)), false);
});

// ---- 7.3 Было → стало, блокировки ----

test('Исправили объём: блок «было → стало»', () => {
  const o = order({ mixerName: 'Самовывоз', totalRevenue: 100000, mixCost: 50000, deliveryCostTotal: 0, totalProfit: 50000 });
  const rows = OE.beforeAfter(o, payload(o, { saleVolume: 12, totalRevenue: 120000, mixCost: 60000, deliveryCostTotal: 0, totalProfit: 60000 }));
  assert.deepStrictEqual(rows.map((r) => [r.label, r.before, r.after]), [
    ['Выручка', 100000, 120000], ['Себестоимость', 50000, 60000], ['Прибыль', 50000, 60000]
  ]);
});

test('Цены справочника изменились — прибыль ниже при той же форме', () => {
  const o = order({ mixerName: 'Самовывоз', totalRevenue: 100000, mixCost: 50000, deliveryCostTotal: 0, totalProfit: 50000 });
  const rows = OE.beforeAfter(o, payload(o, { address: 'ул. Мира, 1', mixCost: 52000, totalProfit: 48000 }));
  assert.deepStrictEqual(rows[2], { label: 'Прибыль', before: 50000, after: 48000 });
  assert.strictEqual(rows[0].after, 100000);
});

test('Блокировка полей при путевых листах', () => {
  assert.deepStrictEqual(OE.lockedFields(order({ hasWaybills: true })), ['recipeId', 'saleVolume', 'deliveryMode', 'mixerId', 'maxLoad']); // change order-hired-delivery
  assert.deepStrictEqual(OE.lockedFields(order()), []);
});

// ---- 7.4 Ошибки сохранения ----

test('409 «уже исправили» — выход из режима; блокировка — остаёмся', () => {
  const err = (status, message) => Object.assign(new Error(message), { status });
  assert.strictEqual(OE.isTerminalError(err(409, 'Заказ уже исправили — откройте заново')), true);
  assert.strictEqual(OE.isTerminalError(err(403, 'Исправить заказ можно в течение суток — обратитесь к менеджеру')), true);
  assert.strictEqual(OE.isTerminalError(err(409, OE.LOCKED_HINT)), false);
  assert.strictEqual(OE.isTerminalError(err(400, 'Неизвестный клиент')), false);
});

// ---- Найм (change order-hired-delivery) ----
const hiredOrder = (patch) => order(Object.assign({ deliveryMode: 'hired', hireRatePerM3: 500, mixerId: null, mixerName: 'Найм',
  address: 'пос. Северный', distanceKm: 30, deliveryChargePerM3: 700 }, patch));
const hiredPayload = (o, patch) => payload(o, Object.assign({ deliveryMode: 'hired', hireRatePerM3: o.hireRatePerM3 }, patch));

test('Наёмный заказ: форма из заказа — «Найм», 500 ₽/м³, адрес и 30 км', () => {
  const st = OE.formState(hiredOrder(), DATA);
  assert.strictEqual(st.deliveryMode, 'hired');
  assert.strictEqual(st.hireRate, 500);
  assert.strictEqual(st.address, 'пос. Северный');
  assert.strictEqual(st.distanceKm, 30);
  assert.strictEqual(st.mixerId, '');
  assert.strictEqual(st.selfPickup, false);
});

test('Наёмный заказ: без правок не изменён, правка только ставки — изменён', () => {
  const o = hiredOrder();
  assert.strictEqual(OE.isDirty(o, hiredPayload(o)), false);
  assert.strictEqual(OE.isDirty(o, hiredPayload(o, { hireRatePerM3: 550 })), true);
});

test('Смена режима — изменение; старые заказы без поля режима читаются по mixerName', () => {
  const own = order();
  assert.strictEqual(OE.isDirty(own, payload(own, { deliveryMode: 'own' })), false);
  assert.strictEqual(OE.isDirty(own, payload(own, { deliveryMode: 'hired', mixerName: 'Найм', hireRatePerM3: 500 })), true);
  assert.strictEqual(OE.formState(order({ mixerName: 'Самовывоз', mixerId: null }), DATA).deliveryMode, 'pickup');
  assert.strictEqual(OE.formState(own, DATA).deliveryMode, 'own');
  assert.strictEqual(OE.formState(own, DATA).hireRate, null);
});

test('Блокировка режима при путевых листах', () => {
  assert.ok(OE.lockedFields(hiredOrder({ hasWaybills: true })).includes('deliveryMode'));
  assert.ok(!OE.lockedFields(hiredOrder({ hasWaybills: true })).includes('hireRate'));
});
