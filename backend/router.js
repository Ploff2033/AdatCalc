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
const otherEquipment = require('./handlers/other-equipment');
const trailers = require('./handlers/trailers');
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
const waybillDocs = require('./waybill-docs');
const registryRoutes = require('./registry-routes');

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

// Content-Disposition — заголовок HTTP, значение должно быть ASCII;
// кириллица в filename= напрямую падает в рантайме Node с ERR_INVALID_CHAR
// (см. имена файлов путевых листов — "Путевой лист — Джага — №28 — ...").
// filename*=UTF-8''... (RFC 5987) — стандартный способ отдать настоящее
// имя с кириллицей, понимает любой современный браузер; plain filename= —
// ASCII-подстраховка для совсем древних клиентов (там кириллица просто
// станет "_", а не сломает скачивание).
function contentDispositionHeader(filename) {
  var ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename);
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

// Путевые листы формы №4-С (аудиторы настаивают на ней вместо 4-П) —
// расчёт документов по полной истории техники: см. waybill-docs.js (change
// waybill-fuel-chain). Выгрузка печатает каждый лист, в который входит хотя
// бы одна выбранная запись, целиком — состав и цифры листа не зависят от
// отмеченных галочек (иначе сводка списания ГСМ разошлась бы с печатью).
async function buildWaybill4sDocuments(selectedEntries) {
  const selected = new Set(selectedEntries.map((e) => e.id));
  const vehicleIds = selectedEntries.map((e) => e.mixerId);
  const untilDate = selectedEntries.reduce((max, e) => (e.tripDate > max ? e.tripDate : max), '');
  const all = await waybillDocs.loadVehicleDocs(vehicleIds, untilDate);
  const documents = all.filter((d) => d.entryIds.some((id) => selected.has(id)));
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

  // Клиенты — модуль от 25.09.2026, с change client-list привязаны к заводу
  // и несут память (цены/условия). Читать и заводить нового может кто угодно,
  // включая анонимного работника (выбор клиента при оформлении заказа
  // обязателен для всех); править карточку, цены и удалять — manager+.
  //
  // GET: работник видит только клиентов своего завода + "Без завода" — завод
  // из проверенного токена (scopeByToken), а не из ?plantId=. manager+ без
  // ?plantId= получает всех (экран «Клиенты»).
  ...crudRoutes('/api/clients', clients, { read: null, write: 'manager', scopeByToken: true }).filter((r) => r.method === 'GET' || r.method === 'DELETE'),
  {
    method: 'POST',
    pattern: /^\/api\/clients$/,
    // Завод нового клиента: у работника по ссылке завода — из токена (тело
    // игнорируется); у общей ссылки подмены — из тела (выбор в
    // переключателе); у manager+ — из тела, может быть пустым. Анонимный
    // запрос без токена (старый закэшированный фронтенд) создаёт клиента
    // "Без завода" — первый заказ сам проставит ему завод.
    handler: async (req, res, m, role, query) => {
      const body = await readBody(req);
      if (!role) {
        if (query.token) {
          const resolved = await plants.resolveToken(query.token, clientIp(req));
          body.plantId = resolved.universal ? body.plantId : resolved.id;
        } else {
          body.plantId = null;
        }
      }
      sendJson(res, 201, await clients.create(body));
    }
  },
  {
    method: 'PUT',
    pattern: /^\/api\/clients\/([^/]+)$/,
    role: 'manager',
    handler: async (req, res, m) => sendJson(res, 200, await clients.update(decodeURIComponent(m[1]), await readBody(req)))
  },
  {
    method: 'PUT',
    pattern: /^\/api\/clients\/([^/]+)\/prices\/([^/]+)$/,
    role: 'manager',
    handler: async (req, res, m, role) => sendJson(res, 200, await clients.setPrice(decodeURIComponent(m[1]), decodeURIComponent(m[2]), await readBody(req), role))
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/clients\/([^/]+)\/prices\/([^/]+)$/,
    role: 'manager',
    handler: async (req, res, m) => sendJson(res, 200, await clients.deletePrice(decodeURIComponent(m[1]), decodeURIComponent(m[2])))
  },

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
  ...crudRoutes('/api/other-equipment', otherEquipment, { read: null, write: 'admin' }),
  ...crudRoutes('/api/trailers', trailers, { read: null, write: 'admin' }),

  // Заказы — открыты всем, включая незалогиненных работников. Работник по
  // своей ссылке (?token=) видит только заказы своего завода — см. scopeByToken.
  // Полное удаление (del) — только admin (см. v2/redesign: отменить заказ
  // может менеджер через POST .../cancel ниже, а насовсем стереть историю —
  // только админ); create/read остаются открытыми как раньше.
  // PUT из crudRoutes отфильтрован — исправление заказа объявлено ниже
  // отдельно: ему нужны роль и токен завода работника (change order-edit).
  ...crudRoutes('/api/orders', orders, { read: null, write: null, del: 'admin', scopeByToken: true }).filter((r) => r.method !== 'PUT'),

  // Исправление оформленного заказа. Открыто и работнику по ссылке, но
  // завод работника берётся только из проверенного ?token= (как у GET
  // /api/cash-entries), а окно в сутки и запрет переноса на другой завод
  // проверяет handlers/orders.js::update. Менеджер и admin — без окна.
  {
    method: 'PUT',
    pattern: /^\/api\/orders\/([^/]+)$/,
    handler: async (req, res, m, role, query) => {
      const body = await readBody(req);
      let actor;
      if (role) {
        actor = { role: role === 'admin' ? 'admin' : 'manager', plantId: null };
      } else {
        if (!query.token) throw new HttpError(401, 'Нужна ссылка завода');
        const resolved = await plants.resolveToken(query.token, clientIp(req));
        actor = { role: 'worker', plantId: resolved.universal ? null : resolved.id };
      }
      sendJson(res, 200, await orders.update(decodeURIComponent(m[1]), body, actor));
    }
  },

  // Отмена заказа — остаётся в истории (cancelled_at), в отличие от полного
  // удаления выше. Менеджеру и выше; сама проверка "нет путевых листов" —
  // внутри handlers/orders.js::cancel.
  {
    method: 'POST',
    pattern: /^\/api\/orders\/([^/]+)\/cancel$/,
    role: 'manager',
    handler: async (req, res, m) => sendJson(res, 200, await orders.cancel(decodeURIComponent(m[1])))
  },

  // Смена даты и/или завода заказа — прежний маршрут интерфейса v1 (в v2
  // дата и завод правятся в форме исправления, PUT /api/orders/:id выше).
  // Только менеджер и выше; правка пишется в журнал и уходит в чат заказов,
  // как и исправление (change order-edit).
  {
    method: 'PUT',
    pattern: /^\/api\/orders\/([^/]+)\/date$/,
    role: 'manager',
    handler: async (req, res, m, role) => {
      const body = await readBody(req);
      sendJson(res, 200, await orders.updateDate(decodeURIComponent(m[1]), body.createdAt, body.plantId, role));
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
          'Content-Disposition': contentDispositionHeader(waybillFileName(withTrips[0]))
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
  // Сводка списанного по путевым ГСМ (change waybill-fuel-chain) — те же
  // права, что у путевых листов. Пишет в БД только коэффициенты ещё не
  // посчитанных листов (идемпотентно), номера листов не выдаёт.
  {
    method: 'GET',
    pattern: /^\/api\/waybill-entries\/fuel-summary$/,
    role: 'manager',
    handler: async (req, res, m, role, query) => sendJson(res, 200, await waybillDocs.fuelSummary(query))
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
          'Content-Disposition': contentDispositionHeader(waybillXlsx4s.waybillFileName(shaped[0]))
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
      if (body.telegramBotToken !== undefined || body.telegramChatId !== undefined || body.telegramProxyUrl !== undefined
        || body.telegramOrdersThreadId !== undefined || body.telegramStockThreadId !== undefined) {
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
  // Реестр оплат — своя модель доступа (admin / учредитель по токену),
  // см. registry-routes.js.
  ...registryRoutes({ readBody, sendJson }),

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
          let role = await resolveRole(req);
          if (route.registryRoles) {
            role = await registryRoutes.resolveRegistryRole(req, role);
            if (!route.registryRoles.includes(role)) {
              sendError(res, new HttpError(403, 'Недостаточно прав'));
              return;
            }
          }
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

module.exports = { handleRequest, buildWaybill4sDocuments };
