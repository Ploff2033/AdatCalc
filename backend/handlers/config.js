const db = require('../db');
const { num } = require('../validate');

function applyPatch(body, current) {
  const next = JSON.parse(JSON.stringify(current));
  if (body.targetOutput !== undefined) {
    next.targetOutput = num(body.targetOutput, 'targetOutput');
  }
  if (body.utilitiesMonthly !== undefined) {
    next.utilitiesMonthly = num(body.utilitiesMonthly, 'utilitiesMonthly');
  }
  if (body.plantDepr !== undefined) {
    const pd = body.plantDepr || {};
    next.plantDepr = {
      balance: num(pd.balance, 'plantDepr.balance'),
      residual: num(pd.residual, 'plantDepr.residual'),
      lifespanMonths: num(pd.lifespanMonths, 'plantDepr.lifespanMonths')
    };
  }
  if (body.plantLocation !== undefined) {
    const pl = body.plantLocation || {};
    next.plantLocation = {
      lat: num(pl.lat, 'plantLocation.lat'),
      lng: num(pl.lng, 'plantLocation.lng')
    };
  }
  return next;
}

async function get() {
  return db.get().config;
}

async function update(body) {
  let updated;
  await db.mutate((draft) => {
    draft.config = applyPatch(body, draft.config);
    updated = draft.config;
    return draft;
  });
  return updated;
}

module.exports = { get, update };
