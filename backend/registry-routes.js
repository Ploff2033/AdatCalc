const HttpError = require('./http-error');
const registry = require('./handlers/registry');
const dictionaries = require('./handlers/registry-dictionaries');
const files = require('./registry-files');
const telegram = require('./telegram');

// Маршруты реестра оплат. У них своя модель доступа (registryRoles вместо
// role): admin по сессии или учредитель ("owner") по заголовку
// X-Owner-Token — псевдороль только для этих маршрутов, в общую иерархию
// manager/admin (ROLE_RANK в router.js) не встраивается. manager и
// работники по ссылкам заводов сюда не допускаются вовсе. Сам резолв —
// resolveRegistryRole() ниже, вызывается из router.js::handleRequest.
const ADMIN = ['admin'];
const ADMIN_OWNER = ['admin', 'owner'];

async function resolveRegistryRole(req, sessionRole) {
  if (sessionRole === 'admin') return 'admin';
  if (await registry.checkOwnerToken(req.headers['x-owner-token'])) return 'owner';
  return sessionRole || null;
}

// Публичный адрес для ссылки в Telegram, если не задан PUBLIC_BASE_URL —
// из заголовков запроса, который и вызвал уведомление (за прокси —
// X-Forwarded-*).
function originOf(req) {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? proto + '://' + host : '';
}

function id(m) {
  return decodeURIComponent(m[1]);
}

module.exports = function registryRoutes({ readBody, sendJson }) {
  return [
    // --- заявки ---
    {
      method: 'GET',
      pattern: /^\/api\/registry\/requests$/,
      registryRoles: ADMIN_OWNER,
      handler: async (req, res, m, role, query) => sendJson(res, 200, await registry.list(query))
    },
    {
      method: 'GET',
      pattern: /^\/api\/registry\/requests\/([^/]+)$/,
      registryRoles: ADMIN_OWNER,
      handler: async (req, res, m) => sendJson(res, 200, await registry.get(id(m)))
    },
    {
      method: 'POST',
      pattern: /^\/api\/registry\/requests$/,
      registryRoles: ADMIN,
      handler: async (req, res) => sendJson(res, 201, await registry.create(await readBody(req), { origin: originOf(req) }))
    },
    {
      method: 'PUT',
      pattern: /^\/api\/registry\/requests\/([^/]+)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => sendJson(res, 200, await registry.update(id(m), await readBody(req)))
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/registry\/requests\/([^/]+)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => {
        await registry.remove(id(m));
        sendJson(res, 204);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/registry\/requests\/([^/]+)\/decision$/,
      registryRoles: ADMIN_OWNER,
      handler: async (req, res, m) => sendJson(res, 200, await registry.decide(id(m), await readBody(req), { origin: originOf(req) }))
    },

    // --- оплаты ---
    {
      method: 'POST',
      pattern: /^\/api\/registry\/requests\/([^/]+)\/payments$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => sendJson(res, 201, await registry.addPayment(id(m), await readBody(req)))
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/registry\/payments\/([^/]+)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => sendJson(res, 200, await registry.removePayment(id(m)))
    },

    // --- файлы: тело запроса — сами байты файла, имя и тип — в query ---
    {
      method: 'POST',
      pattern: /^\/api\/registry\/requests\/([^/]+)\/files$/,
      registryRoles: ADMIN,
      handler: async (req, res, m, role, query) => {
        const buf = await files.readRaw(req);
        sendJson(res, 201, await registry.addRequestFile(id(m), buf, { kind: query.kind, name: query.name }));
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/registry\/payments\/([^/]+)\/file$/,
      registryRoles: ADMIN,
      handler: async (req, res, m, role, query) => {
        const buf = await files.readRaw(req);
        sendJson(res, 201, await registry.setPaymentFile(id(m), buf, { name: query.name }));
      }
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/registry\/files\/([^/]+)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => sendJson(res, 200, await registry.removeFile(id(m)))
    },

    // Автозаполнение из счёта: подстановка по ИНН и поиск дубля (только admin —
    // заявки заводит он, учредителю это не нужно).
    {
      method: 'GET',
      pattern: /^\/api\/registry\/lookup$/,
      registryRoles: ADMIN,
      handler: async (req, res, m, role, query) => sendJson(res, 200, await registry.lookup(query))
    },
    {
      method: 'GET',
      pattern: /^\/api\/registry\/suggest$/,
      registryRoles: ADMIN,
      handler: async (req, res, m, role, query) => sendJson(res, 200, await registry.suggest(query.field, query.q))
    },

    // --- справочники: читать нужно и учредителю (фильтры) ---
    {
      method: 'GET',
      pattern: /^\/api\/registry\/(categories|units)$/,
      registryRoles: ADMIN_OWNER,
      handler: async (req, res, m) => sendJson(res, 200, await dictionaries.list(m[1]))
    },
    {
      method: 'POST',
      pattern: /^\/api\/registry\/(categories|units)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => sendJson(res, 201, await dictionaries.create(m[1], await readBody(req)))
    },
    {
      method: 'PUT',
      pattern: /^\/api\/registry\/(categories|units)\/([^/]+)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => sendJson(res, 200, await dictionaries.update(m[1], decodeURIComponent(m[2]), await readBody(req)))
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/registry\/(categories|units)\/([^/]+)$/,
      registryRoles: ADMIN,
      handler: async (req, res, m) => {
        await dictionaries.remove(m[1], decodeURIComponent(m[2]));
        sendJson(res, 204);
      }
    },

    // --- учредитель и настройки ---
    // Проверка ссылки при открытии: без registryRoles — сам отвечает 401,
    // чтобы фронт показал "Ссылка недействительна", а не "Недостаточно прав".
    {
      method: 'GET',
      pattern: /^\/api\/registry\/owner\/check$/,
      handler: async (req, res) => {
        if (!(await registry.checkOwnerToken(req.headers['x-owner-token']))) {
          throw new HttpError(401, 'Ссылка недействительна');
        }
        sendJson(res, 200, { ok: true });
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/registry\/owner\/reissue$/,
      registryRoles: ADMIN,
      handler: async (req, res) => sendJson(res, 200, await registry.reissueOwnerToken())
    },
    {
      method: 'GET',
      pattern: /^\/api\/registry\/settings$/,
      registryRoles: ADMIN,
      handler: async (req, res) => sendJson(res, 200, await registry.getSettings())
    },
    {
      method: 'PUT',
      pattern: /^\/api\/registry\/settings$/,
      registryRoles: ADMIN,
      handler: async (req, res) => sendJson(res, 200, await registry.updateSettings(await readBody(req)))
    },
    {
      method: 'POST',
      pattern: /^\/api\/registry\/telegram-test$/,
      registryRoles: ADMIN,
      handler: async (req, res) => {
        const body = await readBody(req);
        if (body.telegramRegistryChatId !== undefined || body.telegramRegistryThreadId !== undefined) await registry.updateSettings(body);
        try {
          await telegram.sendRegistryTest();
        } catch (err) {
          throw new HttpError(502, 'Не удалось отправить сообщение: ' + err.message);
        }
        sendJson(res, 200, { ok: true });
      }
    }
  ];
};

module.exports.resolveRegistryRole = resolveRegistryRole;
