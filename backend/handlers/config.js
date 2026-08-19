const db = require('../db');
const { num } = require('../validate');

// Топливо и надбавка доступны менеджеру (роут пускает начиная с 'manager'),
// остальные поля (выработка, накладные завода, местоположение) — только админу.
function applyPatch(body, current, role) {
  const next = JSON.parse(JSON.stringify(current));
  const isAdmin = role === 'admin';

  if (isAdmin && body.targetOutput !== undefined) {
    next.targetOutput = num(body.targetOutput, 'targetOutput');
  }
  if (isAdmin && body.utilitiesMonthly !== undefined) {
    next.utilitiesMonthly = num(body.utilitiesMonthly, 'utilitiesMonthly');
  }
  if (isAdmin && body.plantDepr !== undefined) {
    const pd = body.plantDepr || {};
    next.plantDepr = {
      balance: num(pd.balance, 'plantDepr.balance'),
      residual: num(pd.residual, 'plantDepr.residual'),
      lifespanMonths: num(pd.lifespanMonths, 'plantDepr.lifespanMonths')
    };
  }
  if (isAdmin && body.plantLocation !== undefined) {
    const pl = body.plantLocation || {};
    next.plantLocation = {
      lat: num(pl.lat, 'plantLocation.lat'),
      lng: num(pl.lng, 'plantLocation.lng')
    };
  }
  if (body.fuelPriceDefault !== undefined) {
    next.fuelPriceDefault = num(body.fuelPriceDefault, 'fuelPriceDefault');
  }
  if (body.neighborCitySurcharge !== undefined) {
    next.neighborCitySurcharge = num(body.neighborCitySurcharge, 'neighborCitySurcharge');
  }
  return next;
}

function withoutAuth(config) {
  const { auth, ...safe } = config;
  return safe;
}

async function get() {
  return withoutAuth(db.get().config);
}

async function update(body, role) {
  let updated;
  await db.mutate((draft) => {
    draft.config = applyPatch(body, draft.config, role);
    updated = draft.config;
    return draft;
  });
  return withoutAuth(updated);
}

module.exports = { get, update };
