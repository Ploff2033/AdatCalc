const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const TMP_PATH = DB_PATH + '.tmp';

function seedData() {
  return {
    employees: [
      { id: 'emp_seed1', name: 'Иванов Иван', position: 'Оператор БСУ', salary: 65000 },
      { id: 'emp_seed2', name: 'Петров Пётр', position: 'Водитель миксера', salary: 70000 }
    ],
    config: {
      targetOutput: 500,
      plantDepr: { balance: 1200000, residual: 100000, lifespanMonths: 96 },
      utilitiesMonthly: 40000
    },
    materials: [
      { id: 'mat_cement', name: 'Цемент', unit: 'т', price: 9000 },
      { id: 'mat_sand', name: 'Песок', unit: 'т', price: 1100 },
      { id: 'mat_gravel', name: 'Щебень', unit: 'т', price: 1600 },
      { id: 'mat_water', name: 'Вода', unit: 'м³', price: 50 }
    ],
    recipes: [
      {
        id: 'rec_m200',
        name: 'М200',
        items: [
          { materialId: 'mat_cement', qty: 0.35 },
          { materialId: 'mat_sand', qty: 0.7 },
          { materialId: 'mat_gravel', qty: 1.1 },
          { materialId: 'mat_water', qty: 0.18 }
        ]
      }
    ],
    mixers: [
      { id: 'mix_1', name: 'КамАЗ-53229 №1', capacity: 7, balance: 2500000, residual: 250000, mileage: 300000, fuelRate: 35 }
    ]
  };
}

let cache = null;
let writeChain = Promise.resolve();

async function atomicWrite(data) {
  const json = JSON.stringify(data, null, 2);
  await fsp.writeFile(TMP_PATH, json, 'utf8');
  await fsp.rename(TMP_PATH, DB_PATH);
}

async function load() {
  let raw;
  try {
    raw = await fsp.readFile(DB_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = seedData();
      await fsp.mkdir(path.dirname(DB_PATH), { recursive: true });
      await atomicWrite(cache);
      return cache;
    }
    throw err;
  }
  try {
    cache = JSON.parse(raw);
  } catch (err) {
    throw new Error(`data/db.json is corrupted and could not be parsed: ${err.message}`);
  }
  return cache;
}

function get() {
  if (!cache) throw new Error('DB not loaded yet — call load() before get()');
  return cache;
}

// fn receives a deep clone of the current data and returns the new data to persist.
function mutate(fn) {
  const task = writeChain.then(async () => {
    const draft = JSON.parse(JSON.stringify(cache));
    const next = fn(draft);
    await atomicWrite(next);
    cache = next;
    return next;
  });
  // Keep the chain alive even if this mutation fails, so later mutations still run.
  writeChain = task.catch(() => {});
  return task;
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { load, get, mutate, genId, DB_PATH };
