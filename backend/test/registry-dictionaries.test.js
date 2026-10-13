// Сценарии спеки payment-registry/dictionaries.
const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, resetRegistry, close } = require('./helpers/db');
const fx = require('./helpers/fixtures');
const dict = require('../handlers/registry-dictionaries');

test.after(close);
test.beforeEach(async () => { if (await require('./helpers/db').ready()) await resetRegistry(); });

test('Добавление категории: появляется среди видимых', async (t) => {
  if (!(await requireDb(t))) return;
  await dict.create('categories', { name: 'Аренда' });
  const list = await dict.list('categories');
  assert.deepStrictEqual(list.filter((x) => !x.hidden).map((x) => x.name), ['Аренда']);
});

test('Дубль без учёта регистра отклоняется', async (t) => {
  if (!(await requireDb(t))) return;
  await dict.create('categories', { name: 'Материалы' });
  await assert.rejects(dict.create('categories', { name: 'материалы' }), { status: 409 });
});

test('Пустое название отклоняется', async (t) => {
  if (!(await requireDb(t))) return;
  await assert.rejects(dict.create('units', { name: '   ' }), { status: 400 });
});

test('Переименование подразделения видно в заявках', async (t) => {
  if (!(await requireDb(t))) return;
  const u = await fx.unit('Стройка');
  const c = await fx.category('Материалы');
  const r = await fx.rawRequest(u, c);
  await dict.update('units', u, { name: 'Стройка ЖК Солнечный' });
  const { rows } = await db.pool.query('SELECT u.name FROM pay_requests r JOIN pay_units u ON u.id = r.unit_id WHERE r.id = $1', [r]);
  assert.strictEqual(rows[0].name, 'Стройка ЖК Солнечный');
});

test('Скрытие используемой категории: скрыта, но заявка её показывает', async (t) => {
  if (!(await requireDb(t))) return;
  const u = await fx.unit('Джага');
  const c = await fx.category('Топливо');
  const r = await fx.rawRequest(u, c);
  const updated = await dict.update('categories', c, { hidden: true });
  assert.strictEqual(updated.hidden, true);
  await assert.rejects(dict.assertSelectable('categories', c), { status: 400 });
  const { rows } = await db.pool.query('SELECT c.name FROM pay_requests r JOIN pay_categories c ON c.id = r.category_id WHERE r.id = $1', [r]);
  assert.strictEqual(rows[0].name, 'Топливо');
});

test('Удаление используемого значения отклоняется, неиспользуемого — проходит', async (t) => {
  if (!(await requireDb(t))) return;
  const u = await fx.unit('Теберда');
  const c = await fx.category('Сырьё');
  await fx.rawRequest(u, c);
  await assert.rejects(dict.remove('units', u), (err) => err.status === 409 && /скрыть/.test(err.message));
  const free = await fx.unit('Офис');
  await dict.remove('units', free);
  assert.ok(!(await dict.list('units')).some((x) => x.id === free));
});

test('Новый завод не меняет подразделения реестра', async (t) => {
  if (!(await requireDb(t))) return;
  await fx.unit('Стройка');
  const before = await dict.list('units');
  const plants = require('../handlers/plants');
  const p = await plants.create({ name: 'Тестовый завод ' + Date.now() });
  try {
    assert.deepStrictEqual(await dict.list('units'), before);
  } finally {
    await db.pool.query('DELETE FROM plants WHERE id = $1', [p.id]);
  }
});
