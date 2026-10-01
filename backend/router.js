const HttpError = require('./http-error');
const { serveStatic } = require('./static');
const { parseCookies, setSessionCookie, clearSessionCookie } = require('./cookies');
const { getSession } = require('./sessions');

const employees = require('./handlers/employees');
const personnelSummary = require('./handlers/personnel-summary');
const materials = require('./handlers/materials');
const recipes = require('./handlers/recipes');
const clients = require('./handlers/clients');
const cashEntries = require('./handlers/cash-entries');
const mixers = require('./handlers/mixers');
const aggregateTrucks = require('./handlers/aggregate-trucks');
const orders = require('./handlers/orders');
const waybillEntries = require('./handlers/waybill-entries');
const materialReceipts = require('./handlers/material-receipts');
const plants = require('./handlers/plants');
const config = require('./handlers/config');
const stockMovements = require('./handlers/stock-movements');
const telegram = require('./telegram');
const mailruSync = require('./mailru-sync');
const auth = require('./handlers/auth');
const db = require('./db');
const { buildOrderWorkbook, buildWaybillsZip, waybillFileName } = require('./waybill-xlsx');
const waybillXlsx4s = require('./waybill-xlsx-4s');

const ROLE_RANK = { manager: 1, admin: 2 };

function hasRole(role, minRole) {
  if (!minRole) return true;
  return (ROLE_RANK[role] || 0) >= ROLE_RANK[minRole];
}

async function resolveRole(req) {
  const cookies = parseCookies(req);
  const session = await getSession(cookies.session);
  return session ? session.role : null;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || null;
}

function sendJson(res, status, data) {
  if (data === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, err) {
  if (err instanceof HttpError) {
    const payload = { error: err.message };
    if (err.extra) Object.assign(payload, err.extra);
    sendJson(res, err.status, payload);
  } else {
    console.error(err);
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
}

// maxBytes — по умолчанию 1МБ хватает всем обычным JSON-телам этого API,
// кроме фото чеков ДДС (см. cash-entries.js): те шлются base64-строкой в
// том же JSON, и лимит для них выше (см. вызов в маршрутах ниже). Само
// фото сжимается/уменьшается ещё на клиенте перед отправкой (см.
// screen-cash.js/mobile-cash-form.js — canvas resize), это не единственная
// защита, а дополнительная маржа на случай браузера без такого сжатия.
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX_BYTES = maxBytes || 1e6;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new HttpError(413, 'Слишком большое тело запроса'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new HttpError(400, 'Некорректный JSON в теле запроса'));
      }
    });
    req.on('error', reject);
  });
}

// opts: { read: null|'manager'|'admin', write: null|'manager'|'admin', scopeByToken: bool }
// null/undefined means no login required for that group of methods.
// scopeByToken: for anonymous (no session role) requests, ?plantId= from the
// client is ignored — the plant is resolved server-side from ?token= instead
// (see handlers/plants.resolveToken), so a worker's link can only ever see
// their own plant's data. Logged-in admin/manager keep passing ?plantId=
// directly, unaffected.
function crudRoutes(base, mod, opts) {
  opts = opts || {};
  const single = new RegExp(`^${base}$`);
  const withId = new RegExp(`^${base}/([^/]+)$`);
  return [
    {
      method: 'GET',
      pattern: single,
      role: opts.read,
      handler: async (req, res, m, role, query) => {
        if (opts.scopeByToken && !role) {
          const resolved = await plants.resolveToken(query.token, clientIp(req));
          // Общий токен подмены не привязан к одному заводу — plantId выбирает
          // сам фронтенд (переключатель заводов), сервер только проверяет, что
          // токен действителен. Токен конкретного завода — как раньше, id из него.
          const plantId = resolved.universal ? query.plantId : resolved.id;
          if (!plantId) throw new HttpError(400, 'Не выбран завод');
          query = Object.assign({}, query, { plantId });
        }
        sendJson(res, 200, await mod.list(query, role));
      }
    },
    {
      method: 'POST',
      pattern: single,
      // opts.create — своя роль конкретно для создания, отдельно от
      // остального opts.write (по умолчанию совпадает с write, если не
      // задана явно) — нужно для /api/clients: создать нового клиента
      // прямо на месте может кто угодно (даже анонимный работник по
      // ссылке — выбор клиента при оформлении заказа обязателен для всех),
      // а вот переименовать/удалить существующего — это уже manager+.
      role: opts.create !== undefined ? opts.create : opts.write,
      handler: async (req, res) => {
        const body = await readBody(req);
        sendJson(res, 201, await mod.create(body));
      }
    },
    {
      method: 'PUT',
      pattern: withId,
      role: opts.write,
      handler: async (req, res, m) => {
        const body = await readBody(req);
        sendJson(res, 200, await mod.update(decodeURIComponent(m[1]), body));
      }
    },
    {
      method: 'DELETE',
      pattern: withId,
      // opts.del — своя роль конкретно для удаления, отдельно от остального
      // opts.write (по умолчанию совпадает с write, если не задана явно) —
      // нужно для /api/orders: создание/правки открыты как раньше, а
      // полное удаление сузили до admin (см. handlers/orders.js::remove).
      role: opts.del !== undefined ? opts.del : opts.write,
      handler: async (req, res, m) => {
        await mod.remove(decodeURIComponent(m[1]));
        sendJson(res, 204);
      }
    }
  ];
}

const WAYBILL_4S_MAX_TRIPS = 3;

// Путевые листы формы №4-С (аудиторы настаивают на ней вместо 4-П — см.
// обсуждение с пользователем). Два правила разбиения на документы сразу:
// 1. Кол-во документов зависит от комбинаций водитель+машина+день — как и
//    раньше для 4-П, несколько записей на одного водителя/машину/день это
//    один документ, а не несколько (см. историю обсуждения выше).
// 2. НО в самом бланке 4-С под журнал поездок на обороте отведено только
//    3 ездки (6 строк, см. waybill-xlsx-4s.js) — если за день у связки
//    водитель+машина поездок больше, режем на несколько документов по
//    WAYBILL_4S_MAX_TRIPS поездок в каждом (10 поездок = 4 документа:
//    3+3+3+1, а не 3 — так и обсуждали с пользователем).
//
// Одометр — расчётный, не с реального прибора (см. mixers.odometer_baseline_km
// в schema.sql: "план и факт совпадают всегда, потому что расход считаем по
// норме" — решение пользователя). Чтобы вставка исторической записи задним
// числом не портила уже посчитанные документы, одометр считается заново на
// каждую выгрузку по ПОЛНОЙ истории записей машины (а не только по тем,
// что выбраны сейчас), в хронологическом порядке: дата рейса, затем время
// создания записи как тай-брейк (см. также обсуждение "план=факт" — время
// суток в путевом не печатаем, но для порядка записей оно всё равно нужно).
async function buildWaybill4sDocuments(entries) {
  const mixerIds = Array.from(new Set(entries.map((e) => e.mixerId)));
  if (!mixerIds.length) return [];

  // mixer_id на записи рейса хранит id миксера ИЛИ инертовоза (см.
  // комментарий у waybill_entries.receipt_id в schema.sql — та же колонка
  // переиспользуется для обоих видов техники), поэтому базовый пробег ищем
  // в обеих таблицах, а не только в mixers (как было раньше — из-за этого
  // одометр на рейсах поступлений всегда считался от нуля, даже если бы
  // поле на инертовозе было настроено).
  const [{ rows: mixerRows }, { rows: truckRows }] = await Promise.all([
    db.pool.query('SELECT id, odometer_baseline_km FROM mixers WHERE id = ANY($1)', [mixerIds]),
    db.pool.query('SELECT id, odometer_baseline_km FROM aggregate_trucks WHERE id = ANY($1)', [mixerIds])
  ]);
  const baselineByMixer = new Map(
    mixerRows.concat(truckRows).map((r) => [r.id, Number(r.odometer_baseline_km) || 0])
  );

  // Адрес завода — по просьбе пользователя ("в путевом пишется просто
  // 'Джага', нужен нормальный адрес"). Таблица заводов маленькая — проще
  // забрать всю, чем фильтровать по distinct plantId из entries.
  const { rows: plantRows } = await db.pool.query('SELECT id, address FROM plants');
  const addressByPlant = new Map(plantRows.map((r) => [r.id, r.address || '']));
  const plantLabel = (e) => {
    const address = addressByPlant.get(e.plantId) || '';
    return address ? e.plantName + ', ' + address : e.plantName;
  };

  // Груз и тоннаж — по просьбе пользователя ("я везу песок, а у тебя
  // прописано, что это Бетон"): раньше груз был жёстко зашит как 'Бетон'
  // для ЛЮБОГО рейса, хотя рейсы поступлений возят конкретный инертный
  // материал. Для рейсов поступлений — название материала и тоннаж
  // (qty поступления / trip_count поступления × число рейсов В ЭТОМ
  // документе — "если на 100 тонн 5 ездок, то 20 тонн ездка, если в
  // путевом ездок две — 40 тонн"); для заказов на бетон — по-прежнему
  // 'Бетон' без тоннажа (объём считается в м³, а не в тоннах, графа
  // "перевезти тонн" тут не подходит по смыслу).
  const receiptIds = Array.from(new Set(entries.map((e) => e.receiptId).filter(Boolean)));
  const receiptInfoById = new Map();
  if (receiptIds.length) {
    const { rows: receiptRows } = await db.pool.query(
      'SELECT id, material_name, qty, trip_count, unit FROM material_receipts WHERE id = ANY($1)',
      [receiptIds]
    );
    receiptRows.forEach((r) => {
      receiptInfoById.set(r.id, {
        materialName: r.material_name,
        qtyPerTrip: Number(r.trip_count) > 0 ? Number(r.qty) / Number(r.trip_count) : 0,
        isTons: r.unit === 'т'
      });
    });
  }
  const cargoFor = (e) => {
    const info = e.receiptId ? receiptInfoById.get(e.receiptId) : null;
    return info ? info.materialName : 'Бетон';
  };
  const tonsPerTrip = (e) => {
    const info = e.receiptId ? receiptInfoById.get(e.receiptId) : null;
    return info && info.isTons ? info.qtyPerTrip : null;
  };

  // Время — по просьбе пользователя ("можешь проставлять выезд с парковки
  // (условно в 9) и возвращение на парковку (в 18.00), исходя из средней
  // скорости и времени погрузок/разгрузок"). dayElapsedMinutes — курсор
  // "сейчас" в минутах от полуночи, стартует с config.shiftStartMinutes на
  // КАЖДЫЙ день (группу driverId|mixerId|tripDate) и копится дальше по
  // рейсам И по документам ВНУТРИ этого дня (как и одометр — продолжается
  // через flushChunk, не сбрасывается на каждый новый документ). Погрузка
  // на заводе уже считается пренебрежимо малой во всём остальном коде (см.
  // tripHours в handlers/waybill-entries.js) — тем же приёмом время стоянки
  // под погрузкой = 0, вся пауза (unloadMinutes) — на разгрузке у клиента.
  const cfg = await waybillEntries.getLimitsConfig();
  const oneWayMinutes = (distanceKm) => (cfg.avgSpeedKmh > 0 ? (distanceKm / cfg.avgSpeedKmh) * 60 : 0);

  const { rows: historyRows } = await db.pool.query(
    'SELECT id, mixer_id, distance_km, trip_count, trip_date, created_at FROM waybill_entries WHERE mixer_id = ANY($1) ORDER BY mixer_id, trip_date, created_at, id',
    [mixerIds]
  );

  // Одометр на НАЧАЛО каждой записи истории (не только выбранных сейчас на
  // выгрузку) — нужно для корректного расчёта смещения даже если сама
  // запись, предшествующая по времени, в эту выгрузку не попала.
  const odometerStartByEntryId = new Map();
  let currentMixer = null;
  let running = 0;
  for (const row of historyRows) {
    if (row.mixer_id !== currentMixer) {
      currentMixer = row.mixer_id;
      running = baselineByMixer.get(row.mixer_id) || 0;
    }
    odometerStartByEntryId.set(row.id, running);
    running += Number(row.distance_km) * 2 * Number(row.trip_count);
  }

  const groups = new Map();
  for (const e of entries) {
    const key = e.driverId + '|' + e.mixerId + '|' + e.tripDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const documents = [];
  for (const [key, group] of groups) {
    // Порядок должен совпадать с тем, что использовался при расчёте
    // одометра (по времени создания записи) — иначе куски документа не
    // совпадут с реальной последовательностью одометра этой машины.
    group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const [y, m, d] = group[0].tripDate.split('-').map(Number);
    const createdAt = new Date(y, m - 1, d, 12).toISOString();

    let partIndex = 0;
    let chunkRoutes = null;
    let chunkLegs = null;
    let chunkTrips = 0;
    let chunkOdometerStart = 0;
    let chunkTimeStart = 0;
    // Копится по ВСЕМ документам этого дня подряд (не сбрасывается на
    // каждый flushChunk) — ровно так же, как одометр: следующий документ
    // того же дня продолжает время с того момента, на котором закончился
    // предыдущий, а не начинает заново с 9:00.
    let dayElapsedMinutes = cfg.shiftStartMinutes;

    const flushChunk = () => {
      if (!chunkTrips) return;
      partIndex += 1;
      const odometerEnd = chunkOdometerStart + chunkLegs.reduce((s, l) => s + l.distanceKm * 2, 0);
      documents.push({
        id: key.replace(/\|/g, '-') + '-p' + partIndex,
        createdAt,
        driverName: group[0].driverName,
        driverLicenseNumber: group[0].driverLicenseNumber,
        mixerName: group[0].mixerName,
        mixerPlate: group[0].mixerPlate,
        fuelPricePerLiter: group[0].fuelPricePerLiter,
        odometerStart: chunkOdometerStart,
        odometerEnd,
        timeStartMinutes: chunkTimeStart,
        timeEndMinutes: dayElapsedMinutes,
        routes: Array.from(chunkRoutes.values()),
        legs: chunkLegs
      });
      chunkRoutes = null;
      chunkLegs = null;
      chunkTrips = 0;
    };

    for (const e of group) {
      // На случай рассинхрона (запись есть в выборке, но почему-то не
      // нашлась в истории — не должно случаться) — считаем от 0, лучше
      // заниженный одометр, чем упавшая выгрузка.
      const entryStart = odometerStartByEntryId.has(e.id) ? odometerStartByEntryId.get(e.id) : 0;
      const legOneWayMinutes = oneWayMinutes(e.distanceKm);
      const tons = tonsPerTrip(e);
      let remaining = e.tripCount;
      let consumed = 0;
      while (remaining > 0) {
        if (chunkTrips === 0) {
          chunkRoutes = new Map();
          chunkLegs = [];
          chunkOdometerStart = entryStart + consumed * e.distanceKm * 2;
          chunkTimeStart = dayElapsedMinutes;
        }
        const take = Math.min(remaining, WAYBILL_4S_MAX_TRIPS - chunkTrips);

        const routeKey = e.distanceKm + '|' + e.address;
        if (!chunkRoutes.has(routeKey)) {
          chunkRoutes.set(routeKey, {
            distanceKm: e.distanceKm,
            address: e.address,
            // plantName тут — то, что реально печатается в пункте погрузки
            // (см. buildFrontXml/buildBackXml) — "название, адрес" если у
            // завода задан адрес, иначе по-старому одно название.
            plantName: plantLabel(e),
            cargo: cargoFor(e),
            tripCount: 0,
            tonsPerTrip: tons,
            fuelCostPerTrip: e.fuelCostPerTrip,
            // "Время прибытия" в задании водителю — момент прибытия на
            // разгрузку (к клиенту) ПЕРВОГО рейса этого маршрута, дальше не
            // переписывается (см. buildFrontXml).
            firstDropoffArrivalMinutes: null
          });
        }
        const route = chunkRoutes.get(routeKey);
        route.tripCount += take;
        for (let i = 0; i < take; i++) {
          // Погрузка на заводе — без простоя (pickupDeparture = pickupArrival,
          // см. комментарий у dayElapsedMinutes выше); вся пауза (unloadMinutes)
          // — на разгрузке у клиента.
          const pickupArrival = dayElapsedMinutes;
          const pickupDeparture = pickupArrival;
          const dropoffArrival = pickupDeparture + legOneWayMinutes;
          const dropoffDeparture = dropoffArrival + (cfg.unloadMinutes || 0);
          if (route.firstDropoffArrivalMinutes == null) route.firstDropoffArrivalMinutes = dropoffArrival;
          chunkLegs.push({
            plantName: plantLabel(e),
            address: e.address,
            distanceKm: e.distanceKm,
            pickupArrivalMinutes: pickupArrival,
            pickupDepartureMinutes: pickupDeparture,
            dropoffArrivalMinutes: dropoffArrival,
            dropoffDepartureMinutes: dropoffDeparture
          });
          dayElapsedMinutes = dropoffDeparture + legOneWayMinutes; // обратно на завод — готов к следующему рейсу
        }
        chunkTrips += take;
        consumed += take;
        remaining -= take;

        if (chunkTrips >= WAYBILL_4S_MAX_TRIPS) flushChunk();
      }
    }
    flushChunk();
  }

  await assignWaybillDocNumbers(documents);
  return documents;
}

// Номера путевых листов — по просьбе пользователя ("у путевых листов
// должны быть номера"). Документы №4-С не хранятся как отдельная сущность
// (собираются на лету из waybill_entries при каждой выгрузке), поэтому
// номер выдаётся по стабильному ключу (doc.id — тот же "водитель-машина-
// дата-pN", что уже используется в имени файла) один раз при первом
// запросе печати и переживает повторную выгрузку тех же рейсов.
async function assignWaybillDocNumbers(documents) {
  if (!documents.length) return;
  const keys = documents.map((d) => d.id);
  await db.pool.query(
    'INSERT INTO waybill_doc_numbers (doc_key) SELECT unnest($1::text[]) ON CONFLICT (doc_key) DO NOTHING',
    [keys]
  );
  const { rows } = await db.pool.query('SELECT doc_key, number FROM waybill_doc_numbers WHERE doc_key = ANY($1)', [keys]);
  const numberByKey = new Map(rows.map((r) => [r.doc_key, r.number]));
  documents.forEach((d) => { d.docNumber = numberByKey.get(d.id) || null; });
}

const routes = [
  // Заводы — читать может кто угодно (нужно всем ролям), создавать/менять/удалять — только админ.
  ...crudRoutes('/api/plants', plants, { read: null, write: 'admin' }),

  // Резолвинг ссылки работника: ?token= -> завод. Публичный (работник не
  // залогинен), сам себя логирует в plant_token_usage.
  {
    method: 'GET',
    pattern: /^\/api\/plants\/resolve-token$/,
    handler: async (req, res, m, role, query) => sendJson(res, 200, await plants.resolveToken(query.token, clientIp(req)))
  },
  // Перевыпуск ссылки — старая инвалидируется немедленно (токен просто перезаписывается).
  {
    method: 'POST',
    pattern: /^\/api\/plants\/([^/]+)\/reissue-token$/,
    role: 'admin',
    handler: async (req, res, m) => sendJson(res, 200, await plants.reissueToken(decodeURIComponent(m[1])))
  },
  // Цены топлива/мочевины и доплата за рейс в другой город — доступны
  // менеджеру (раньше это были общие настройки, которые он мог менять), в
  // отличие от полного PUT /api/plants/:id (название/амортизация/координаты
  // — только admin).
  {
    method: 'PUT',
    pattern: /^\/api\/plants\/([^/]+)\/prices$/,
    role: 'manager',
    handler: async (req, res, m) => {
      const body = await readBody(req);
      sendJson(res, 200, await plants.updatePrices(decodeURIComponent(m[1]), body));
    }
  },

  // Сотрудники — список с зарплатами видит только админ (list() сам решает
  // по role: админу — полные карточки, остальным — только отмеченные
  // "водитель", без зарплаты, для выбора на Главной). Менять — только админ.
  ...crudRoutes('/api/employees', employees, { read: null, write: 'admin', scopeByToken: true }),
  { method: 'GET', pattern: /^\/api\/personnel-summary$/, handler: async (req, res) => sendJson(res, 200, await personnelSummary.get()) },

  // Материалы/рецепты — читать может кто угодно (нужно для расчёта на Главной),
  // менять — только менеджер и выше. list() принимает ?plantId= для фильтрации
  // (admin/manager) или ?token= (незалогиненный работник — резолвится в свой
  // plantId на бэкенде, см. scopeByToken в crudRoutes).
  ...crudRoutes('/api/materials', materials, { read: null, write: 'manager', scopeByToken: true }),
  ...crudRoutes('/api/recipes', recipes, { read: null, write: 'manager', scopeByToken: true }),

  // Клиенты — модуль от 25.09.2026 (см. схему/документ). НЕ привязан к
  // заводу (нет scopeByToken — list() и так не фильтрует по плантId),
  // читать и заводить нового может кто угодно, включая анонимного
  // работника (выбор клиента при оформлении заказа обязателен для всех),
  // а переименовать/удалить существующего — только manager+.
  ...crudRoutes('/api/clients', clients, { read: null, create: null, write: 'manager' }),

  // ДДС — модуль от 25.09.2026 (см. документ "AdatBeton Calc — ДДС и
  // Дашборд (MVP)"). Вносят те же работники, что создают заказы, по той же
  // токен-ссылке завода — поэтому весь доступ открыт (role: null), как и у
  // /api/orders. Свои маршруты вместо crudRoutes(): нужен свой лимит тела
  // запроса (фото чека, см. readBody выше) и отдельный /storno без аналога
  // в стандартном CRUD.
  {
    method: 'GET',
    pattern: /^\/api\/cash-entries$/,
    handler: async (req, res, m, role, query) => {
      // Тот же приём, что и scopeByToken в crudRoutes() выше — но строже:
      // без роли plantId берётся ТОЛЬКО из проверенного токена, сырой
      // ?plantId= из URL для анонимного игнорируется (иначе можно было бы
      // подставить чужой завод и читать его расходы/чеки без токена).
      // С ролью (manager/admin) — тот же принцип, что уже есть у
      // /api/orders: plantId не задан → полный кросс-заводской список,
      // фильтр по заводу на фронте (тут отдельно про это же говорит и сам
      // документ — полный журнал по всем заводам зарезервирован под
      // администратора, интерфейс менеджера всегда шлёт свой текущий завод).
      if (!role) {
        if (!query.token) throw new HttpError(400, 'Не выбран завод');
        const resolved = await plants.resolveToken(query.token, clientIp(req));
        const plantId = resolved.universal ? query.plantId : resolved.id;
        if (!plantId) throw new HttpError(400, 'Не выбран завод');
        query = { plantId: plantId };
      }
      sendJson(res, 200, await cashEntries.list(query));
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/cash-entries$/,
    handler: async (req, res) => {
      const body = await readBody(req, 4 * 1024 * 1024);
      sendJson(res, 201, await cashEntries.create(body));
    }
  },
  {
    method: 'PUT',
    pattern: /^\/api\/cash-entries\/([^/]+)$/,
    // role передаётся дальше в update() — admin правит записи когда угодно,
    // без 15-30-минутного окна (см. cash-entries.js::assertEditable).
    handler: async (req, res, m, role) => {
      const body = await readBody(req, 4 * 1024 * 1024);
      sendJson(res, 200, await cashEntries.update(decodeURIComponent(m[1]), body, role));
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/cash-entries\/([^/]+)$/,
    handler: async (req, res, m, role) => {
      await cashEntries.remove(decodeURIComponent(m[1]), role);
      sendJson(res, 204);
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/cash-entries\/([^/]+)\/storno$/,
    handler: async (req, res, m) => {
      const body = await readBody(req);
      sendJson(res, 201, await cashEntries.storno(decodeURIComponent(m[1]), body && body.note));
    }
  },

  // Остатки — приход/корректировка (не сам CRUD над карточкой материала,
  // отдельные операции с журналом движений, см. handlers/stock.js).
  {
    method: 'POST',
    pattern: /^\/api\/materials\/([^/]+)\/stock$/,
    role: 'manager',
    handler: async (req, res, m) => {
      const body = await readBody(req);
      sendJson(res, 200, await materials.stockAdjustment(decodeURIComponent(m[1]), body));
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/stock-movements$/,
    role: 'manager',
    handler: async (req, res, m, role, query) => sendJson(res, 200, await stockMovements.list(query))
  },
  // Дневной срез остатка одного материала — для графика динамики на
  // дашборде (см. handlers/stock-movements.js::dailySnapshot). Отдельный
  // путь, а не query-параметр у GET /api/stock-movements — разная форма
  // ответа (сгруппировано по дням, а не лента событий).
  {
    method: 'GET',
    pattern: /^\/api\/stock-movements\/daily$/,
    role: 'manager',
    handler: async (req, res, m, role, query) => sendJson(res, 200, await stockMovements.dailySnapshot(query))
  },

  // Техника — общая на все заводы. Читать может кто угодно, менять — только админ.
  ...crudRoutes('/api/mixers', mixers, { read: null, write: 'admin' }),
  ...crudRoutes('/api/aggregate-trucks', aggregateTrucks, { read: null, write: 'admin' }),

  // Заказы — открыты всем, включая незалогиненных работников. Работник по
  // своей ссылке (?token=) видит только заказы своего завода — см. scopeByToken.
  // Полное удаление (del) — только admin (см. v2/redesign: отменить заказ
  // может менеджер через POST .../cancel ниже, а насовсем стереть историю —
  // только админ); create/read остаются открытыми как раньше.
  ...crudRoutes('/api/orders', orders, { read: null, write: null, del: 'admin', scopeByToken: true }),

  // Отмена заказа — остаётся в истории (cancelled_at), в отличие от полного
  // удаления выше. Менеджеру и выше; сама проверка "нет путевых листов" —
  // внутри handlers/orders.js::cancel.
  {
    method: 'POST',
    pattern: /^\/api\/orders\/([^/]+)\/cancel$/,
    role: 'manager',
    handler: async (req, res, m) => sendJson(res, 200, await orders.cancel(decodeURIComponent(m[1])))
  },

  // Смена даты и/или завода заказа — единственное разрешённое редактирование
  // уже оформленного заказа (см. комментарий в handlers/orders.js). Только
  // менеджер и выше — в отличие от создания/удаления заказов это не рутинное
  // действие работника, а исправление задним числом, и открывать его всем
  // по анонимной ссылке на завод не стоит.
  {
    method: 'PUT',
    pattern: /^\/api\/orders\/([^/]+)\/date$/,
    role: 'manager',
    handler: async (req, res, m) => {
      const body = await readBody(req);
      sendJson(res, 200, await orders.updateDate(decodeURIComponent(m[1]), body.createdAt, body.plantId));
    }
  },

  // Путевые листы по форме №4-П — заполняем реальный .xlsx-бланк (см.
  // waybill-xlsx.js: правим значения прямо в XML внутри файла, не трогая
  // остальное форматирование). Один заказ — сразу .xlsx, несколько — zip
  // с файлом на каждый (это разные книги Excel, а не страницы одного PDF).
  // Доступно менеджеру и выше; заказы без рейса (самовывоз) отбрасываются —
  // заполнять нечего (нет ни техники, ни водителя).
  {
    method: 'POST',
    pattern: /^\/api\/orders\/waybills\.xlsx$/,
    role: 'manager',
    handler: async (req, res) => {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const found = await orders.getByIds(ids);
      const withTrips = found.filter((o) => o.tripCount > 0);
      if (!withTrips.length) throw new HttpError(400, 'Нет заказов с рейсом для путевого листа');
      const cfg = await config.get('admin');
      const organization = cfg.companyRequisites;
      if (withTrips.length === 1) {
        const buf = await buildOrderWorkbook(withTrips[0], organization);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="' + waybillFileName(withTrips[0]) + '"'
        });
        res.end(buf);
      } else {
        const buf = await buildWaybillsZip(withTrips, organization);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="putevye-listy.zip"'
        });
        res.end(buf);
      }
    }
  },

  // Путевые листы для заказов, растянутых на несколько дней/машин/водителей —
  // отдельный модуль (см. handlers/waybill-entries.js), не заменяет путевой
  // лист прямо из заказа выше, а дополняет его для этого случая. Доступно
  // только менеджеру и выше — это не рутинный ввод по анонимной ссылке.
  ...crudRoutes('/api/waybill-entries', waybillEntries, { read: 'manager', write: 'manager' }),

  // Поступления инертных — отдельная вкладка (см. handlers/material-receipts.js
  // и документ "AdatBeton Calc v2 — архитектура модулей", обновление
  // 30.09.2026): сырьё, приходящее НА завод, а не отгрузка клиенту. Рейсы
  // по ним разносятся тем же /api/waybill-entries выше (receiptId вместо
  // orderId в теле запроса) — здесь только сама запись поступления.
  ...crudRoutes('/api/material-receipts', materialReceipts, { read: 'manager', write: 'manager', del: 'admin' }),
  {
    method: 'POST',
    pattern: /^\/api\/material-receipts\/([^/]+)\/cancel$/,
    role: 'manager',
    handler: async (req, res, m) => sendJson(res, 200, await materialReceipts.cancel(decodeURIComponent(m[1])))
  },

  // Периоды работы водителя (см. schema.sql::employee_work_periods) —
  // admin-only, та же роль, что и остальное редактирование карточки
  // сотрудника (crudRoutes('/api/employees', ..., { write: 'admin' })
  // выше).
  {
    method: 'POST',
    pattern: /^\/api\/employees\/([^/]+)\/work-periods$/,
    role: 'admin',
    handler: async (req, res, m) => {
      const body = await readBody(req);
      sendJson(res, 201, await employees.addWorkPeriod(decodeURIComponent(m[1]), body));
    }
  },
  {
    method: 'PUT',
    pattern: /^\/api\/employees\/([^/]+)\/work-periods\/([^/]+)$/,
    role: 'admin',
    handler: async (req, res, m) => {
      const body = await readBody(req);
      sendJson(res, 200, await employees.updateWorkPeriod(decodeURIComponent(m[1]), decodeURIComponent(m[2]), body));
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/employees\/([^/]+)\/work-periods\/([^/]+)$/,
    role: 'admin',
    handler: async (req, res, m) => {
      await employees.removeWorkPeriod(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      res.writeHead(204);
      res.end();
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/waybill-entries\/waybills\.xlsx$/,
    role: 'manager',
    handler: async (req, res) => {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const found = await waybillEntries.getByIds(ids);
      const withTrips = found.filter((e) => e.tripCount > 0);
      if (!withTrips.length) throw new HttpError(400, 'Нет записей с рейсами для путевого листа');
      const cfg = await config.get('admin');
      const organization = cfg.companyRequisites;
      // Форма №4-С (не 4-П) — см. обсуждение перехода. Группировка и
      // разбиение по 3 поездки на документ — в buildWaybill4sDocuments.
      const shaped = await buildWaybill4sDocuments(withTrips);
      if (shaped.length === 1) {
        const buf = await waybillXlsx4s.buildDocumentWorkbook(shaped[0], organization);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="' + waybillXlsx4s.waybillFileName(shaped[0]) + '"'
        });
        res.end(buf);
      } else {
        const buf = await waybillXlsx4s.buildWaybillsZip(shaped, organization);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="putevye-listy.zip"'
        });
        res.end(buf);
      }
    }
  },

  { method: 'GET', pattern: /^\/api\/config$/, handler: async (req, res, m, role) => sendJson(res, 200, await config.get(role)) },
  {
    method: 'PUT',
    pattern: /^\/api\/config$/,
    role: 'manager',
    handler: async (req, res, m, role) => {
      const body = await readBody(req);
      sendJson(res, 200, await config.update(body, role));
    }
  },
  // Перевыпуск общей ссылки подмены — старая инвалидируется немедленно.
  {
    method: 'POST',
    pattern: /^\/api\/config\/reissue-universal-token$/,
    role: 'admin',
    handler: async (req, res) => sendJson(res, 200, await config.reissueUniversalToken())
  },
  // Тестовое сообщение — сохраняет токен/chat id, если пришли в теле (можно
  // проверить ДО основного "Сохранить" в Настройках), и реально ждёт ответа
  // Telegram, а не просто пишет в БД — см. telegram.js::sendTest.
  {
    method: 'POST',
    pattern: /^\/api\/config\/telegram-test$/,
    role: 'admin',
    handler: async (req, res, m, role) => {
      const body = await readBody(req);
      if (body.telegramBotToken !== undefined || body.telegramChatId !== undefined) {
        await config.update(body, role);
      }
      try {
        await telegram.sendTest();
      } catch (err) {
        throw new HttpError(502, 'Не удалось отправить сообщение: ' + err.message);
      }
      sendJson(res, 200, { ok: true });
    }
  },
  // Проверка синхронизации ДДС с Облаком Mail.ru — тот же приём, что и
  // telegram-test выше: сохраняет логин/пароль, если пришли в теле, и
  // реально ждёт результат загрузки по WebDAV, а не просто пишет в БД.
  // plantId обязателен — синхронизация идёт по заводу (своя кассовая книга
  // на каждый, см. mailru-sync.js).
  {
    method: 'POST',
    pattern: /^\/api\/config\/mailru-test$/,
    role: 'admin',
    handler: async (req, res, m, role) => {
      const body = await readBody(req);
      if (body.mailruLogin !== undefined || body.mailruAppPassword !== undefined) {
        await config.update(body, role);
      }
      if (!body.plantId) throw new HttpError(400, 'Не выбран завод');
      try {
        await mailruSync.testSync(body.plantId);
      } catch (err) {
        throw new HttpError(502, err.message);
      }
      sendJson(res, 200, { ok: true });
    }
  },

  {
    method: 'POST',
    pattern: /^\/api\/auth\/login$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      const result = await auth.login(body.password);
      setSessionCookie(res, result.token);
      sendJson(res, 200, { role: result.role });
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/logout$/,
    handler: async (req, res) => {
      const cookies = parseCookies(req);
      await auth.logout(cookies.session);
      clearSessionCookie(res);
      sendJson(res, 204);
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/auth\/me$/,
    handler: async (req, res) => {
      const cookies = parseCookies(req);
      sendJson(res, 200, await auth.me(cookies.session));
    }
  }
];

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        try {
          const role = await resolveRole(req);
          if (route.role && !hasRole(role, route.role)) {
            sendError(res, new HttpError(403, 'Недостаточно прав'));
            return;
          }
          const query = Object.fromEntries(url.searchParams);
          await route.handler(req, res, match, role, query);
        } catch (err) {
          sendError(res, err);
        }
        return;
      }
    }
    sendJson(res, 404, { error: 'Маршрут не найден' });
    return;
  }

  await serveStatic(req, res, pathname);
}

module.exports = { handleRequest };
