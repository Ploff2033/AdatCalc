// Типы файлов для библиотек распознавания счетов (change reestr-autofill, задача 1.3).
const test = require('node:test');
const assert = require('node:assert');
const { CONTENT_TYPES, COMPRESSIBLE } = require('../static');

test('wasm отдаётся как application/wasm', () => {
  assert.strictEqual(CONTENT_TYPES['.wasm'], 'application/wasm');
});

test('языковые данные — бинарник без сжатия на лету', () => {
  assert.strictEqual(CONTENT_TYPES['.gz'], 'application/octet-stream');
  assert.strictEqual(COMPRESSIBLE.has('.gz'), false);
  assert.strictEqual(COMPRESSIBLE.has('.wasm'), false);
});

test('PDF и JS — как раньше', () => {
  assert.strictEqual(CONTENT_TYPES['.pdf'], 'application/pdf');
  assert.match(CONTENT_TYPES['.js'], /^text\/javascript/);
});
