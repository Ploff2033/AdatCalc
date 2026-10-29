// Сценарии спеки orders/list-filter на чистых функциях
// frontend-v2/js/order-filter.js: период, список клиентов, поиск, числа,
// пометки, сочетание фильтров, итоги, имя CSV. Даты строятся в местном
// времени (new Date(г, м, д, ч)), чтобы тесты не зависели от пояса машины.
const test = require('node:test');
const assert = require('node:assert');
const OF = require('../../frontend-v2/js/order-filter');

const NOW = new Date(2026, 9, 28, 12, 0); // 28.10.2026 12:00 местного
const CLIENTS = [
  { id: 'c1', name: 'СтройИнвест' },
  { id: 'c2', name: 'Гранит' },
  { id: 'c3', name: 'Монолитстрой' }
];

let seq = 0;
function order(patch) {
  seq++;
  return Object.assign({
    id: 'o' + seq, plantId: 'p1', plantName: 'Северный', clientId: 'c1', clientName: 'СтройИнвест',
    createdAt: new Date(2026, 9, 20, 10).toISOString(), recipeName: 'М300', mixerName: 'Миксер 1',
    saleVolume: 10, address: 'ул. Ленина, 5', totalRevenue: 100000, vatApplied: false, cancelledAt: null, edits: []
  }, patch);
}
function at(y, m, d, h, min) { return new Date(y, m - 1, d, h || 10, min || 0).toISOString(); }
function ids(list) { return list.map((o) => o.id); }
function run(orders, state) {
  return OF.apply(orders, Object.assign({ plantId: '', period: 'all', from: '', to: '', clientKey: '', query: '' }, state), { clients: CLIENTS, now: NOW });
}

// --- Период ---

test('30 дней: с 29.09 00:00 по 28.10 включительно', () => {
  const inside = order({ createdAt: at(2026, 9, 29, 0, 0) });
  const today = order({ createdAt: at(2026, 10, 28, 23, 59) });
  const before = order({ createdAt: at(2026, 9, 28, 23, 50) });
  assert.deepStrictEqual(ids(run([inside, today, before], { period: '30d' }).orders), [inside.id, today.id]);
});

test('Этот месяц: с 01.10 по 28.10, 30.09 не показан', () => {
  const oct1 = order({ createdAt: at(2026, 10, 1, 0, 5) });
  const sep30 = order({ createdAt: at(2026, 9, 30, 18) });
  assert.deepStrictEqual(ids(run([oct1, sep30], { period: 'month' }).orders), [oct1.id]);
});

test('Открытие экрана: «Всё время» показывает всё', () => {
  const old = order({ createdAt: at(2024, 1, 5) });
  const fresh = order({ createdAt: at(2026, 10, 27) });
  assert.deepStrictEqual(ids(run([fresh, old], {}).orders), [fresh.id, old.id]);
});

test('Выбор пункта «Выбрать даты…»: 01.10.2026 и 28.10.2026', () => {
  assert.deepStrictEqual(OF.customDefaults(NOW), { from: '2026-10-01', to: '2026-10-28' });
});

test('Даты перепутаны: меняются местами, обе включительно', () => {
  const d10 = order({ createdAt: at(2026, 10, 10, 0, 1) });
  const d20 = order({ createdAt: at(2026, 10, 20, 23, 59) });
  const d21 = order({ createdAt: at(2026, 10, 21, 0, 1) });
  const d9 = order({ createdAt: at(2026, 10, 9, 23, 59) });
  const r = run([d10, d20, d21, d9], { period: 'custom', from: '2026-10-20', to: '2026-10-10' });
  assert.deepStrictEqual(ids(r.orders), [d10.id, d20.id]);
});

test('Только «по»: всё по 15.10 включительно', () => {
  const old = order({ createdAt: at(2025, 3, 1) });
  const d15 = order({ createdAt: at(2026, 10, 15, 22) });
  const d16 = order({ createdAt: at(2026, 10, 16, 1) });
  assert.deepStrictEqual(ids(run([old, d15, d16], { period: 'custom', from: '', to: '2026-10-15' }).orders), [old.id, d15.id]);
});

test('Только «с»: до сегодня', () => {
  const r = OF.periodRange('custom', '2026-10-01', '', NOW);
  assert.strictEqual(r.start.getTime(), new Date(2026, 9, 1).getTime());
  assert.strictEqual(r.end.getTime(), new Date(2026, 9, 29).getTime());
});

// --- Клиенты ---

test('Число заказов: по алфавиту, только с заказами в периоде', () => {
  const orders = [];
  for (let i = 0; i < 14; i++) orders.push(order({ clientId: 'c1', createdAt: at(2026, 10, 5) }));
  for (let i = 0; i < 3; i++) orders.push(order({ clientId: 'c2', clientName: 'Гранит', createdAt: at(2026, 10, 6) }));
  orders.push(order({ clientId: 'c3', clientName: 'Монолитстрой', createdAt: at(2026, 9, 1) }));
  const opts = run(orders, { period: 'month' }).options;
  assert.deepStrictEqual(opts.items.map((it) => it.label + ' · ' + it.count), ['Гранит · 3', 'СтройИнвест · 14']);
});

test('Ввод сужает список и выделяет совпадение', () => {
  const opts = OF.clientOptions([
    order({ clientId: 'c1' }), order({ clientId: 'c2', clientName: 'Гранит' }), order({ clientId: 'c3', clientName: 'Монолитстрой' })
  ], CLIENTS);
  const found = OF.matchOptions(opts.items, 'строй');
  assert.deepStrictEqual(found.map((it) => it.label), ['Монолитстрой', 'СтройИнвест']);
  assert.strictEqual(OF.highlight('Монолитстрой', 'строй'), 'Монолит<b>строй</b>');
  assert.strictEqual(OF.highlight('СтройИнвест', 'строй'), '<b>Строй</b>Инвест');
  assert.strictEqual(OF.highlight('<Тест>', 'х'), '&lt;Тест&gt;');
});

test('Без клиента: отдельный пункт с числом, отбор только таких заказов', () => {
  const none = order({ clientId: null, clientName: '' });
  const withClient = order({ clientId: 'c1' });
  const r = run([none, withClient], { clientKey: 'none' });
  assert.strictEqual(r.options.none, 1);
  assert.deepStrictEqual(ids(r.orders), [none.id]);
});

test('Клиента переименовали: один пункт под нынешним именем', () => {
  const clients = [{ id: 'c1', name: 'СтройИнвест-Групп' }];
  const orders = [];
  for (let i = 0; i < 5; i++) orders.push(order({ clientId: 'c1', clientName: 'СтройИнвест' }));
  for (let i = 0; i < 2; i++) orders.push(order({ clientId: 'c1', clientName: 'СтройИнвест-Групп' }));
  const r = OF.apply(orders, { period: 'all', clientKey: 'id:c1', query: '' }, { clients: clients, now: NOW });
  assert.deepStrictEqual(r.options.items.map((it) => it.label + ' · ' + it.count), ['СтройИнвест-Групп · 7']);
  assert.strictEqual(r.orders.length, 7);
});

test('Клиента удалили: пункт по сохранённому имени', () => {
  const orders = [1, 2, 3].map(() => order({ clientId: null, clientName: 'Ромашка' }));
  const r = run(orders, {});
  const item = r.options.items.find((it) => it.label === 'Ромашка');
  assert.strictEqual(item.count, 3);
  assert.strictEqual(run(orders, { clientKey: item.key }).orders.length, 3);
});

test('Заказ без ссылки с именем живого клиента относится к нему', () => {
  const linked = order({ clientId: 'c2', clientName: 'Гранит' });
  const orphan = order({ clientId: null, clientName: 'гранит' });
  const r = run([linked, orphan], { clientKey: 'id:c2' });
  assert.strictEqual(r.orders.length, 2);
  assert.deepStrictEqual(r.options.items.map((it) => it.count), [2]);
});

test('Смена периода: пропавший клиент сбрасывается на «Все клиенты»', () => {
  const granit = order({ clientId: 'c2', clientName: 'Гранит', createdAt: at(2026, 8, 1) });
  const stroy = order({ clientId: 'c1', createdAt: at(2026, 10, 27) });
  const r = run([granit, stroy], { period: '30d', clientKey: 'id:c2' });
  assert.strictEqual(r.clientKey, '');
  assert.deepStrictEqual(ids(r.orders), [stroy.id]);
});

// --- Поиск ---

test('Часть адреса', () => {
  const lenina = order({ address: 'ул. Ленина, 5' });
  const mira = order({ address: 'пр. Мира, 12' });
  assert.deepStrictEqual(ids(run([lenina, mira], { query: '  ленина ' }).orders), [lenina.id]);
});

test('Несколько слов — через «И»', () => {
  const a = order({ recipeName: 'М300', address: 'ул. Ленина, 5' });
  const b = order({ recipeName: 'М300', address: 'ул. Кирова, 3' });
  const c = order({ recipeName: 'М350', address: 'ул. Ленина, 7' });
  assert.deepStrictEqual(ids(run([a, b, c], { query: 'м300 ленина' }).orders), [a.id]);
});

test('Буква «ё»: «отменен» находит отменённые', () => {
  const cancelled = order({ cancelledAt: at(2026, 10, 21) });
  const active = order({});
  assert.deepStrictEqual(ids(run([cancelled, active], { query: 'отменен' }).orders), [cancelled.id]);
  assert.deepStrictEqual(ids(run([cancelled, active], { query: 'Отменён' }).orders), [cancelled.id]);
});

test('Клиент в поиске не участвует', () => {
  assert.strictEqual(run([order({ clientName: 'СтройИнвест' })], { query: 'стройинвест' }).orders.length, 0);
});

test('Объём точно: 12 не находит 120 и 1,2', () => {
  const base = { address: 'ул. Кирова, 3', mixerName: 'Миксер 1' };
  const v12 = order(Object.assign({ saleVolume: 12 }, base));
  const v120 = order(Object.assign({ saleVolume: 120 }, base));
  const v12d = order(Object.assign({ saleVolume: 1.2 }, base));
  assert.deepStrictEqual(ids(run([v12, v120, v12d], { query: '12' }).orders), [v12.id]);
});

test('Число в адресе', () => {
  const o = order({ saleVolume: 8, address: 'ул. Мира, 12' });
  assert.deepStrictEqual(ids(run([o], { query: '12' }).orders), [o.id]);
});

test('Дробный объём: «12,5» и «12.5»', () => {
  const o = order({ saleVolume: 12.5, address: 'ул. Кирова, 3' });
  assert.strictEqual(run([o], { query: '12,5' }).orders.length, 1);
  assert.strictEqual(run([o], { query: '12.5' }).orders.length, 1);
});

test('Найм: и новый режим, и старый заказ с миксером «Найм»', () => {
  const hired = order({ deliveryMode: 'hired', mixerName: 'Найм' });
  const legacy = order({ mixerName: 'Найм' });
  const own = order({ deliveryMode: 'own' });
  assert.deepStrictEqual(ids(run([hired, legacy, own], { query: 'найм' }).orders), [hired.id, legacy.id]);
});

test('Пометки «самовывоз» и «с ндс»', () => {
  const pickup = order({ deliveryMode: 'pickup', mixerName: 'Самовывоз' });
  const vat = order({ vatApplied: true });
  assert.deepStrictEqual(ids(run([pickup, vat], { query: 'самовывоз' }).orders), [pickup.id]);
  assert.deepStrictEqual(ids(run([pickup, vat], { query: 'с ндс' }).orders), [vat.id]);
});

test('Исправленные: «испр»', () => {
  const edited = order({ edits: [{ editedAt: at(2026, 10, 21), actor: 'Менеджер', changes: [{ text: 'Объём: 10 → 12 м³' }], profit: 'Прибыль: 1 → 2' }] });
  const plain = order({});
  assert.deepStrictEqual(ids(run([edited, plain], { query: 'испр' }).orders), [edited.id]);
});

// --- Сочетание фильтров ---

test('Клиент и объём: «СтройИнвест» + «12» + «Этот месяц»', () => {
  const s12 = order({ clientId: 'c1', saleVolume: 12, createdAt: at(2026, 10, 7, 9, 10) });
  const s8 = order({ clientId: 'c1', saleVolume: 8, createdAt: at(2026, 10, 15) });
  const g12 = order({ clientId: 'c2', clientName: 'Гранит', saleVolume: 12, createdAt: at(2026, 10, 7, 11) });
  const r = run([s8, g12, s12], { period: 'month', clientKey: 'id:c1', query: '12' });
  assert.deepStrictEqual(ids(r.orders), [s12.id]);
});

test('Завод складывается с остальными фильтрами', () => {
  const north = order({ plantId: 'p1' });
  const south = order({ plantId: 'p2', plantName: 'Южный' });
  assert.deepStrictEqual(ids(run([north, south], { plantId: 'p2' }).orders), [south.id]);
});

test('Отменённый заказ в отборе остаётся', () => {
  const cancelled = order({ clientId: 'c1', saleVolume: 10, cancelledAt: at(2026, 10, 21) });
  assert.deepStrictEqual(ids(run([cancelled], { clientKey: 'id:c1' }).orders), [cancelled.id]);
});

// --- Итоги ---

test('Итоги по клиенту: 3 заказа, 30 м³, 366 000 ₽', () => {
  const t = OF.totals([
    order({ saleVolume: 10, totalRevenue: 120000 }), order({ saleVolume: 8, totalRevenue: 96000 }), order({ saleVolume: 12, totalRevenue: 150000 })
  ]);
  assert.deepStrictEqual(t, { count: 3, volume: 30, pay: 366000 });
});

test('Итоги дня: 3 заказа · 30 м³ · 229 200 ₽', () => {
  const t = OF.totals([
    order({ saleVolume: 18, totalRevenue: 151200 }), order({ saleVolume: 8, totalRevenue: 52800 }), order({ saleVolume: 4, totalRevenue: 25200 })
  ]);
  assert.deepStrictEqual(t, { count: 3, volume: 30, pay: 229200 });
  assert.strictEqual(OF.countLabel(t.count), '3 заказа');
});

test('Итоги дня по отбору: только заказ выбранного клиента', () => {
  const day = (h) => at(2026, 10, 7, h);
  const r = run([
    order({ clientId: 'c1', saleVolume: 12, totalRevenue: 79200, createdAt: day(9) }),
    order({ clientId: 'c2', clientName: 'Гранит', saleVolume: 8, createdAt: day(11) }),
    order({ clientId: 'c3', clientName: 'Монолитстрой', saleVolume: 4, createdAt: day(12) })
  ], { clientKey: 'id:c1' });
  assert.deepStrictEqual(OF.totals(r.orders), { count: 1, volume: 12, pay: 79200 });
});

test('Склонение числа заказов', () => {
  assert.deepStrictEqual([1, 3, 5, 11, 12, 21, 22, 25, 111].map(OF.countLabel),
    ['1 заказ', '3 заказа', '5 заказов', '11 заказов', '12 заказов', '21 заказ', '22 заказа', '25 заказов', '111 заказов']);
});

test('Пустой результат: нули в итогах', () => {
  const r = run([order({ address: 'ул. Ленина, 5' })], { query: 'гагарина' });
  assert.strictEqual(r.orders.length, 0);
  assert.deepStrictEqual(OF.totals(r.orders), { count: 0, volume: 0, pay: 0 });
});

// --- Имя CSV ---

test('Имя файла: «Этот месяц»', () => {
  assert.strictEqual(OF.csvFileName(OF.periodRange('month', '', '', NOW), NOW), 'zakazy-2026-10-01_2026-10-28.csv');
});

test('Имя файла без нижней границы', () => {
  assert.strictEqual(OF.csvFileName(OF.periodRange('custom', '', '2026-10-15', NOW), NOW), 'zakazy-po-2026-10-15.csv');
});

test('Имя файла: «Всё время» — прежнее', () => {
  assert.strictEqual(OF.csvFileName(OF.periodRange('all', '', '', NOW), NOW), 'zakazy-' + NOW.toISOString().slice(0, 10) + '.csv');
});
