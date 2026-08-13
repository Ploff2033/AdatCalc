const HttpError = require('./http-error');
const { serveStatic } = require('./static');

const employees = require('./handlers/employees');
const materials = require('./handlers/materials');
const recipes = require('./handlers/recipes');
const mixers = require('./handlers/mixers');
const config = require('./handlers/config');

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

function crudRoutes(base, mod) {
  const single = new RegExp(`^${base}$`);
  const withId = new RegExp(`^${base}/([^/]+)$`);
  return [
    { method: 'GET', pattern: single, handler: async (req, res) => sendJson(res, 200, await mod.list()) },
    {
      method: 'POST',
      pattern: single,
      handler: async (req, res) => {
        const body = await readBody(req);
        sendJson(res, 201, await mod.create(body));
      }
    },
    {
      method: 'PUT',
      pattern: withId,
      handler: async (req, res, m) => {
        const body = await readBody(req);
        sendJson(res, 200, await mod.update(decodeURIComponent(m[1]), body));
      }
    },
    {
      method: 'DELETE',
      pattern: withId,
      handler: async (req, res, m) => {
        await mod.remove(decodeURIComponent(m[1]));
        sendJson(res, 204);
      }
    }
  ];
}

const routes = [
  ...crudRoutes('/api/employees', employees),
  ...crudRoutes('/api/materials', materials),
  ...crudRoutes('/api/recipes', recipes),
  ...crudRoutes('/api/mixers', mixers),
  { method: 'GET', pattern: /^\/api\/config$/, handler: async (req, res) => sendJson(res, 200, await config.get()) },
  {
    method: 'PUT',
    pattern: /^\/api\/config$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      sendJson(res, 200, await config.update(body));
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
          await route.handler(req, res, match);
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
