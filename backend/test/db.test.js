const test = require('node:test');
const assert = require('node:assert');
const { db, requireDb, close } = require('./helpers/db');

test.after(close);

test('тестовая БД отвечает', async (t) => {
  if (!(await requireDb(t))) return;
  const { rows } = await db.pool.query('SELECT 1 AS one');
  assert.strictEqual(rows[0].one, 1);
});
