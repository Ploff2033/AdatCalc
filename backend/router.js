const HttpError = require('./http-error');
const { serveStatic } = require('./static');
const { parseCookies, setSessionCookie, clearSessionCookie } = require('./cookies');
const { getSession } = require('./sessions');

const employees = require('./handlers/employees');
const personnelSummary = require('./handlers/personnel-summary');
const materials = require('./handlers/materials');
const recipes = require('./handlers/recipes');
const mixers = require('./handlers/mixers');
const aggregateTrucks = require('./handlers/aggregate-trucks');
const orders = require('./handlers/orders');
const plants = require('./handlers/plants');
const config = require('./handlers/config');
const auth = require('./handlers/auth');

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX_BYTES = 1e6;
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
      role: opts.write,
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
      role: opts.write,
      handler: async (req, res, m) => {
        await mod.remove(decodeURIComponent(m[1]));
        sendJson(res, 204);
      }
    }
  ];
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

  // Сотрудники — зарплаты видит только админ. list() принимает ?plantId=
  // и отдаёт сотрудников этого завода + общих.
  ...crudRoutes('/api/employees', employees, { read: 'admin', write: 'admin' }),
  { method: 'GET', pattern: /^\/api\/personnel-summary$/, handler: async (req, res) => sendJson(res, 200, await personnelSummary.get()) },

  // Материалы/рецепты — читать может кто угодно (нужно для расчёта на Главной),
  // менять — только менеджер и выше. list() принимает ?plantId= для фильтрации
  // (admin/manager) или ?token= (незалогиненный работник — резолвится в свой
  // plantId на бэкенде, см. scopeByToken в crudRoutes).
  ...crudRoutes('/api/materials', materials, { read: null, write: 'manager', scopeByToken: true }),
  ...crudRoutes('/api/recipes', recipes, { read: null, write: 'manager', scopeByToken: true }),

  // Техника — общая на все заводы. Читать может кто угодно, менять — только админ.
  ...crudRoutes('/api/mixers', mixers, { read: null, write: 'admin' }),
  ...crudRoutes('/api/aggregate-trucks', aggregateTrucks, { read: null, write: 'admin' }),

  // Заказы — открыты всем, включая незалогиненных работников. Работник по
  // своей ссылке (?token=) видит только заказы своего завода — см. scopeByToken.
  ...crudRoutes('/api/orders', orders, { read: null, write: null, scopeByToken: true }),

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
