const db = require('./db');
const HttpError = require('./http-error');
const waybillEntries = require('./handlers/waybill-entries');

// Путевые листы формы №4-С — расчёт документов по технике (change
// waybill-fuel-chain, см. openspec/changes/waybill-fuel-chain/design.md).
// Один модуль и для выгрузки 4-С (router.js), и для сводки списания ГСМ —
// поэтому цифры сводки и бумаги совпадают по построению.
//
// Документы не хранятся как сущность — собираются на лету из
// waybill_entries по ПОЛНОЙ истории техники (не только по выбранным
// записям): одометр, время и остаток топлива в баке непрерывны по технике,
// сквозь водителей, смены и дни. Хранятся только случайные коэффициенты
// листа (waybill_doc_fuel) — выбираются один раз, дальше литры
// пересчитываются детерминированно.
//
// Правила разбиения (без изменений с 4-П/первой версии 4-С):
// 1. Один документ = водитель + техника + день.
// 2. В бланке 4-С под журнал поездок на обороте только 3 ездки — больше
//    режем на несколько документов по WAYBILL_4S_MAX_TRIPS (10 ездок = 4
//    документа: 3+3+3+1).
const WAYBILL_4S_MAX_TRIPS = 3;

function round1(x) {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

// Порядок рейсов ОДНОЙ техники (спека waybills/vehicle-timeline): дата →
// блоки водителей в порядке создания первой записи водителя за день →
// время создания записи → id. Рейсы водителя за день идут подряд, даже если
// записи двух водителей создавались вперемешку — иначе второй водитель
// "вклинился" бы в чужую смену.
function orderVehicleEntries(entries) {
  const firstCreated = new Map();
  for (const e of entries) {
    const k = e.tripDate + '|' + e.driverId;
    const t = new Date(e.createdAt).getTime();
    if (!firstCreated.has(k) || t < firstCreated.get(k)) firstCreated.set(k, t);
  }
  return entries.slice().sort((a, b) => {
    if (a.tripDate !== b.tripDate) return a.tripDate < b.tripDate ? -1 : 1;
    const fa = firstCreated.get(a.tripDate + '|' + a.driverId);
    const fb = firstCreated.get(b.tripDate + '|' + b.driverId);
    if (fa !== fb) return fa - fb;
    if (a.driverId !== b.driverId) return a.driverId < b.driverId ? -1 : 1;
    const ca = new Date(a.createdAt).getTime();
    const cb = new Date(b.createdAt).getTime();
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Документы одной техники по упорядоченным рейсам (см. orderVehicleEntries).
// ctx: { cfg (getLimitsConfig), baselineKm, plantLabel(e), cargoFor(e),
// tonsPerTrip(e) }. Чистая функция — без БД и без топлива, кроме нормы
// (норма — от снимка ставки в записи, не от стоимости/цены топлива).
//
// Время: курсор "сейчас" в минутах от полуночи стартует с
// cfg.shiftStartMinutes при смене ДАТЫ и копится дальше по рейсам — и через
// документы одного водителя, и через смену водителя (следующий принимает
// машину в момент возвращения предыдущего). Погрузка на заводе без простоя,
// вся пауза (unloadMinutes) — на разгрузке у клиента (тот же приём, что
// tripHours в handlers/waybill-entries.js).
//
// Одометр — сквозной от базового пробега техники в том же порядке рейсов,
// расчётный, не с реального прибора (см. mixers.odometer_baseline_km).
function buildVehicleDocs(entries, ctx) {
  const cfg = ctx.cfg;
  const oneWayMinutes = (distanceKm) => (cfg.avgSpeedKmh > 0 ? (distanceKm / cfg.avgSpeedKmh) * 60 : 0);
  const docs = [];

  let odometer = ctx.baselineKm || 0;
  let cursor = cfg.shiftStartMinutes;
  let currentDate = null;
  let blockKey = null;
  let partIndex = 0;
  let chunk = null;

  const flush = () => {
    if (!chunk || !chunk.trips) { chunk = null; return; }
    const first = chunk.firstEntry;
    const routesArr = Array.from(chunk.routes.values());
    // "Время работы двигателя" — время в пути + половина простоя под
    // разгрузкой (решение пользователя; спецоборудование не заполняем).
    const totalDrivingMinutes = chunk.legs.reduce((s, l) => s + 2 * oneWayMinutes(l.distanceKm), 0);
    const [y, m, d] = first.tripDate.split('-').map(Number);
    docs.push({
      id: first.driverId + '-' + first.mixerId + '-' + first.tripDate + '-p' + partIndex,
      driverId: first.driverId,
      mixerId: first.mixerId,
      tripDate: first.tripDate,
      createdAt: new Date(y, m - 1, d, 12).toISOString(),
      entryIds: Array.from(chunk.entryIds),
      // Название завода без подмены на адрес — для имени файла (см.
      // waybillFileName в waybill-xlsx-4s.js).
      plantName: first.plantName,
      driverName: first.driverName,
      driverLicenseNumber: first.driverLicenseNumber,
      mixerName: first.mixerName,
      mixerPlate: first.mixerPlate,
      mixerGarageNumber: first.mixerGarageNumber || '',
      // Прицеп и техника — с первой записи документа (на практике внутри
      // дня не меняются).
      trailerName: first.trailerName || '',
      trailerPlate: first.trailerPlate || '',
      trailerGarageNumber: first.trailerGarageNumber || '',
      fuelPricePerLiter: first.fuelPricePerLiter,
      odometerStart: chunk.odometerStart,
      odometerEnd: odometer,
      timeStartMinutes: chunk.timeStart,
      timeEndMinutes: cursor,
      // Норма листа (л) — "по норме" на обороте и база для факта/выдано.
      totalFuelLiters: round1(chunk.normLiters),
      engineMinutes: totalDrivingMinutes + (chunk.legs.length * (cfg.unloadMinutes || 0)) / 2,
      routes: routesArr,
      legs: chunk.legs
    });
    chunk = null;
  };

  for (const e of entries) {
    if (e.tripDate !== currentDate) {
      flush();
      currentDate = e.tripDate;
      cursor = cfg.shiftStartMinutes;
    }
    const thisBlock = e.tripDate + '|' + e.driverId;
    if (thisBlock !== blockKey) {
      flush();
      blockKey = thisBlock;
      partIndex = 0;
    }
    const legOneWay = oneWayMinutes(e.distanceKm);
    const tons = ctx.tonsPerTrip ? ctx.tonsPerTrip(e) : null;
    const plantLabel = ctx.plantLabel ? ctx.plantLabel(e) : e.plantName;
    const cargo = ctx.cargoFor ? ctx.cargoFor(e) : 'Бетон';
    const ratePer100 = Number(e.fuelRate) || 0;

    for (let i = 0; i < e.tripCount; i++) {
      if (!chunk) {
        partIndex += 1;
        chunk = { firstEntry: e, entryIds: new Set(), routes: new Map(), legs: [], trips: 0, normLiters: 0, odometerStart: odometer, timeStart: cursor };
      }
      chunk.entryIds.add(e.id);
      const routeKey = e.distanceKm + '|' + e.address;
      if (!chunk.routes.has(routeKey)) {
        chunk.routes.set(routeKey, {
          distanceKm: e.distanceKm,
          address: e.address,
          // plantName тут — то, что печатается в пункте погрузки (адрес
          // завода, если задан, иначе название).
          plantName: plantLabel,
          cargo,
          tripCount: 0,
          tonsPerTrip: tons,
          fuelCostPerTrip: e.fuelCostPerTrip,
          // "Время прибытия" в задании водителю — прибытие на разгрузку
          // ПЕРВОГО рейса этого маршрута.
          firstDropoffArrivalMinutes: null
        });
      }
      const route = chunk.routes.get(routeKey);
      route.tripCount += 1;

      const pickupArrival = cursor;
      const dropoffArrival = pickupArrival + legOneWay;
      const dropoffDeparture = dropoffArrival + (cfg.unloadMinutes || 0);
      if (route.firstDropoffArrivalMinutes == null) route.firstDropoffArrivalMinutes = dropoffArrival;
      chunk.legs.push({
        plantName: plantLabel,
        address: e.address,
        distanceKm: e.distanceKm,
        pickupArrivalMinutes: pickupArrival,
        pickupDepartureMinutes: pickupArrival,
        dropoffArrivalMinutes: dropoffArrival,
        dropoffDepartureMinutes: dropoffDeparture
      });
      cursor = dropoffDeparture + legOneWay; // обратно на завод — готов к следующему рейсу
      odometer += e.distanceKm * 2;
      chunk.normLiters += e.distanceKm * 2 * ratePer100 / 100;
      chunk.trips += 1;
      if (chunk.trips >= WAYBILL_4S_MAX_TRIPS) flush();
    }
  }
  flush();
  return docs;
}

// Новые случайные коэффициенты листа (спека waybills/fuel-chain): p —
// целевой остаток после дозаправки 5…15% нормы, s — стартовый остаток
// самого первого листа техники 5…10% нормы. Факт расхода не случаен —
// всегда равен норме (правка аудиторов: факт и план сходятся). Округлены до
// 4 знаков — хранятся в NUMERIC и читаются обратно без расхождения.
function randomCoeffs(rand) {
  const r = rand || Math.random;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return { p: r4(0.05 + r() * 0.1), s: r4(0.05 + r() * 0.05) };
}

// Движение топлива по документам ОДНОЙ техники в их порядке (бак
// принадлежит технике — остаток переносится сквозь водителей, смены, дни).
// coeffByKey: Map doc.id -> {p, s}. Мутирует и возвращает docs:
// fuelFactLiters, fuelIssued, fuelBalanceAtDeparture, fuelBalanceAtReturn.
//   факт = норма
//   выезд = остаток при возвращении предыдущего листа; у самого первого
//           листа техники — round1(норма × s)
//   выдано = max(0, round(факт − выезд + round1(норма × p))) — целые литры
//   возвращение = round1(выезд + выдано − факт)
// Все остатки кратны 0,1 — сводка и печать совпадают без накопления
// ошибки. Лист с нормой 0 остаток не трогает и блок топлива не печатает.
function applyFuelChain(docs, coeffByKey) {
  let balance = null;
  for (const doc of docs) {
    const norm = doc.totalFuelLiters || 0;
    if (!(norm > 0)) {
      doc.fuelFactLiters = 0;
      doc.fuelIssued = 0;
      doc.fuelBalanceAtDeparture = null;
      doc.fuelBalanceAtReturn = null;
      continue;
    }
    const c = coeffByKey.get(doc.id);
    if (!c) throw new Error('Нет коэффициентов топлива для листа ' + doc.id);
    const departure = balance !== null ? balance : round1(norm * c.s);
    const fact = norm;
    const target = round1(norm * c.p);
    const issued = Math.max(0, Math.round(fact - departure + target + Number.EPSILON));
    const ret = round1(departure + issued - fact);
    doc.fuelFactLiters = fact;
    doc.fuelIssued = issued;
    doc.fuelBalanceAtDeparture = departure;
    doc.fuelBalanceAtReturn = ret;
    balance = ret;
  }
  return docs;
}

// Коэффициенты по ключам листов — недостающие создаются один раз
// (INSERT ... ON CONFLICT DO NOTHING + SELECT: при гонке двух запросов оба
// получают значения той вставки, что прошла первой).
async function ensureCoeffs(keys) {
  const out = new Map();
  if (!keys.length) return out;
  const fresh = keys.map(() => randomCoeffs());
  await db.pool.query(
    `INSERT INTO waybill_doc_fuel (doc_key, target_p, start_s)
     SELECT * FROM unnest($1::text[], $2::numeric[], $3::numeric[])
     ON CONFLICT (doc_key) DO NOTHING`,
    [keys, fresh.map((c) => c.p), fresh.map((c) => c.s)]
  );
  const { rows } = await db.pool.query('SELECT doc_key, target_p, start_s FROM waybill_doc_fuel WHERE doc_key = ANY($1)', [keys]);
  rows.forEach((r) => out.set(r.doc_key, { p: Number(r.target_p), s: Number(r.start_s) }));
  return out;
}

// Справочные данные для печати (адрес завода, груз/тоннаж поступлений) —
// перенесено из router.js без изменения смысла.
async function loadPrintContext(entries) {
  // Адрес завода — печатаем только адрес (без названия спереди), без
  // адреса — одно название.
  const { rows: plantRows } = await db.pool.query('SELECT id, address FROM plants');
  const addressByPlant = new Map(plantRows.map((r) => [r.id, r.address || '']));

  // Груз и тоннаж: для поступлений — материал и qty/trip_count на рейс (если
  // единица — тонны), для заказов — 'Бетон' без тоннажа (объём в м³).
  const receiptIds = Array.from(new Set(entries.map((e) => e.receiptId).filter(Boolean)));
  const receiptInfoById = new Map();
  if (receiptIds.length) {
    const { rows } = await db.pool.query('SELECT id, material_name, qty, trip_count, unit FROM material_receipts WHERE id = ANY($1)', [receiptIds]);
    rows.forEach((r) => {
      receiptInfoById.set(r.id, {
        materialName: r.material_name,
        qtyPerTrip: Number(r.trip_count) > 0 ? Number(r.qty) / Number(r.trip_count) : 0,
        isTons: r.unit === 'т'
      });
    });
  }
  return {
    plantLabel: (e) => addressByPlant.get(e.plantId) || e.plantName,
    cargoFor: (e) => {
      const info = e.receiptId ? receiptInfoById.get(e.receiptId) : null;
      return info ? info.materialName : 'Бетон';
    },
    tonsPerTrip: (e) => {
      const info = e.receiptId ? receiptInfoById.get(e.receiptId) : null;
      return info && info.isTons ? info.qtyPerTrip : null;
    }
  };
}

// Все документы указанной техники по полной истории до untilDate
// (включительно; более поздние рейсы на прошлые листы не влияют) — с
// нормой, фактом, выдано и остатками. Порядок: по технике, внутри — по
// хронологии рейсов.
async function loadVehicleDocs(vehicleIds, untilDate) {
  const ids = Array.from(new Set(vehicleIds)).filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await db.pool.query(
    'SELECT * FROM waybill_entries WHERE mixer_id = ANY($1) AND trip_date <= $2 AND trip_count > 0 ORDER BY mixer_id, trip_date, created_at, id',
    [ids, untilDate]
  );
  const entries = rows.map(waybillEntries.rowToEntry);

  // mixer_id хранит id миксера ИЛИ инертовоза — базовый пробег ищем в обеих.
  const [{ rows: mixerRows }, { rows: truckRows }] = await Promise.all([
    db.pool.query('SELECT id, odometer_baseline_km FROM mixers WHERE id = ANY($1)', [ids]),
    db.pool.query('SELECT id, odometer_baseline_km FROM aggregate_trucks WHERE id = ANY($1)', [ids])
  ]);
  const baselineByVehicle = new Map(mixerRows.concat(truckRows).map((r) => [r.id, Number(r.odometer_baseline_km) || 0]));

  const cfg = await waybillEntries.getLimitsConfig();
  const printCtx = await loadPrintContext(entries);

  const byVehicle = new Map();
  for (const e of entries) {
    if (!byVehicle.has(e.mixerId)) byVehicle.set(e.mixerId, []);
    byVehicle.get(e.mixerId).push(e);
  }

  const perVehicle = [];
  for (const [vehicleId, list] of byVehicle) {
    const ctx = Object.assign({ cfg, baselineKm: baselineByVehicle.get(vehicleId) || 0 }, printCtx);
    perVehicle.push(buildVehicleDocs(orderVehicleEntries(list), ctx));
  }

  const keys = [];
  perVehicle.forEach((docs) => docs.forEach((d) => { if (d.totalFuelLiters > 0) keys.push(d.id); }));
  const coeffs = await ensureCoeffs(keys);
  perVehicle.forEach((docs) => applyFuelChain(docs, coeffs));
  return [].concat(...perVehicle);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Сводка списанного по путевым ГСМ за период (спека waybills/fuel-summary):
// строка на технику с рейсами в [from, to] — норма, списано (Σ факта),
// выдано, остаток на начало (выезд первого листа периода) и на конец
// (возвращение последнего). Считается тем же loadVehicleDocs, что и печать,
// поэтому совпадает с бумагой до 0,1 л; номера листов не выдаёт.
//
// plantId — завод РЕЙСА (waybill_entries.plant_id): отбирает технику,
// у которой в периоде есть рейсы этого завода, но строка такой техники
// включает ВСЕ её листы периода — бак принадлежит технике, частичная
// строка не сошлась бы по остаткам. Когда учёт перейдёт на подразделения,
// меняется только источник значения plantId.
async function fuelSummary(params) {
  const p = params || {};
  if (!DATE_RE.test(p.from || '') || !DATE_RE.test(p.to || '') || p.from > p.to) {
    throw new HttpError(400, 'Укажите период: from и to в формате ГГГГ-ММ-ДД, from не позже to');
  }
  const where = ['trip_date >= $1', 'trip_date <= $2', 'trip_count > 0'];
  const args = [p.from, p.to];
  if (p.plantId) { args.push(p.plantId); where.push('plant_id = $' + args.length); }
  if (p.vehicleId) { args.push(p.vehicleId); where.push('mixer_id = $' + args.length); }
  const { rows: idRows } = await db.pool.query('SELECT DISTINCT mixer_id FROM waybill_entries WHERE ' + where.join(' AND '), args);
  const ids = idRows.map((r) => r.mixer_id);

  const docs = (await loadVehicleDocs(ids, p.to)).filter((d) => d.tripDate >= p.from);

  const [{ rows: mixerRows }, { rows: truckRows }] = await Promise.all([
    db.pool.query('SELECT id, name FROM mixers WHERE id = ANY($1)', [ids]),
    db.pool.query('SELECT id, name FROM aggregate_trucks WHERE id = ANY($1)', [ids])
  ]);
  const card = new Map();
  mixerRows.forEach((r) => card.set(r.id, { name: r.name, kind: 'mixer' }));
  truckRows.forEach((r) => card.set(r.id, { name: r.name, kind: 'aggregateTruck' }));

  const rowsById = new Map();
  for (const d of docs) {
    if (!rowsById.has(d.mixerId)) {
      const c = card.get(d.mixerId) || { name: d.mixerName, kind: 'mixer' };
      rowsById.set(d.mixerId, { vehicleId: d.mixerId, name: c.name, kind: c.kind, docs: 0, normLiters: 0, factLiters: 0, issuedLiters: 0, startLiters: null, endLiters: null });
    }
    const row = rowsById.get(d.mixerId);
    row.docs += 1;
    row.normLiters += d.totalFuelLiters || 0;
    row.factLiters += d.fuelFactLiters || 0;
    row.issuedLiters += d.fuelIssued || 0;
    if (d.fuelBalanceAtDeparture != null && row.startLiters === null) row.startLiters = d.fuelBalanceAtDeparture;
    if (d.fuelBalanceAtReturn != null) row.endLiters = d.fuelBalanceAtReturn;
  }
  const rows = Array.from(rowsById.values()).map((r) => {
    r.normLiters = round1(r.normLiters);
    r.factLiters = round1(r.factLiters);
    // Проверка сходимости: начало + выдано − списано = конец (до 0,1 л).
    r.mismatch = r.startLiters !== null && Math.abs(r.startLiters + r.issuedLiters - r.factLiters - r.endLiters) > 0.05;
    return r;
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const total = rows.reduce((t, r) => ({
    normLiters: round1(t.normLiters + r.normLiters),
    factLiters: round1(t.factLiters + r.factLiters),
    issuedLiters: t.issuedLiters + r.issuedLiters,
    docs: t.docs + r.docs
  }), { normLiters: 0, factLiters: 0, issuedLiters: 0, docs: 0 });

  return { from: p.from, to: p.to, rows, total };
}

module.exports = {
  fuelSummary,
  WAYBILL_4S_MAX_TRIPS, round1, orderVehicleEntries, buildVehicleDocs, randomCoeffs, applyFuelChain, ensureCoeffs, loadVehicleDocs
};
