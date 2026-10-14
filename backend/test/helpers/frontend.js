// Загружает браузерные модули фронтенда (IIFE, пишут в window.*) в отдельный
// vm-контекст, где window === глобальный объект — так order-calc.js видит
// Calc без префикса, как в браузере. Для тестов чистой логики без DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');

function load(files) {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox;
}

module.exports = { load };
