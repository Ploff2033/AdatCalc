const db = require('../db');
const HttpError = require('../http-error');
const { str, num } = require('../validate');

function sanitize(body) {
  return {
    name: str(body.name, 'name'),
    position: str(body.position, 'position'),
    salary: num(body.salary, 'salary')
  };
}

async function list() {
  return db.get().employees;
}

async function create(body) {
  const item = { id: db.genId('emp'), ...sanitize(body) };
  await db.mutate((draft) => {
    draft.employees.push(item);
    return draft;
  });
  return item;
}

async function update(id, body) {
  const fields = sanitize(body);
  let updated = null;
  await db.mutate((draft) => {
    const idx = draft.employees.findIndex((e) => e.id === id);
    if (idx === -1) throw new HttpError(404, 'Сотрудник не найден');
    draft.employees[idx] = { id, ...fields };
    updated = draft.employees[idx];
    return draft;
  });
  return updated;
}

async function remove(id) {
  await db.mutate((draft) => {
    const idx = draft.employees.findIndex((e) => e.id === id);
    if (idx === -1) throw new HttpError(404, 'Сотрудник не найден');
    draft.employees.splice(idx, 1);
    return draft;
  });
}

module.exports = { list, create, update, remove };
