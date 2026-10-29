const { moscowDate, moscowDateTime } = require('./order-edit-diff');
const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const db = require('./db');

// keepAlive — без него каждое сообщение заново делает TLS-хендшейк до
// api.telegram.org (замерено: ~1.3с из ~1.5с общей задержки уходит именно на
// него). С переиспользуемым соединением второе и последующие сообщения идут
// заметно быстрее — только первое после старта сервера/простоя платит полную цену.
const directAgent = new https.Agent({ keepAlive: true, timeout: 5000 });

// Прокси — найденный пользователем реальный случай: с части серверов (РФ-
// хостинг) api.telegram.org недоступен напрямую на уровне TCP (TCP SYN до
// 443 не проходит ни из контейнера, ни с хоста — подтверждено диагностикой,
// не баг кода). Схема URL определяет тип прокси: http(s):// — обычный
// HTTP(S)-прокси (HttpsProxyAgent, CONNECT-туннель), socks4/socks5:// —
// SOCKS (SocksProxyAgent, то, что обычно отдают VPN-провайдеры). Агенты
// кэшируются по URL прокси — тот же смысл, что у directAgent (не пересоздавать
// TLS/туннель на каждое сообщение), просто один на каждый настроенный прокси,
// а не один глобальный.
const proxyAgentCache = new Map();
function proxyAgentFor(proxyUrl) {
  if (!proxyUrl) return directAgent;
  if (proxyAgentCache.has(proxyUrl)) return proxyAgentCache.get(proxyUrl);
  const isSocks = /^socks/i.test(proxyUrl);
  const agent = isSocks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
  proxyAgentCache.set(proxyUrl, agent);
  return agent;
}

// Токен/chat id/прокси читаются из config (правятся в Настройках без
// доступа к серверу), при пустом значении — fallback на переменные
// окружения, чтобы уже настроенные через .env боевые деплои не сломались,
// пока их явно не перенастроят через интерфейс. Читаем заново на каждую
// отправку (не кэшируем при старте сервера) — иначе смена токена/прокси в
// Настройках потребовала бы перезапуска.
async function getCredentials() {
  try {
    const { rows } = await db.pool.query(
      'SELECT telegram_bot_token, telegram_chat_id, telegram_proxy_url, telegram_orders_thread_id, telegram_stock_thread_id FROM config WHERE id = 1'
    );
    const row = rows[0] || {};
    return {
      botToken: row.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN,
      chatId: row.telegram_chat_id || process.env.TELEGRAM_CHAT_ID,
      proxyUrl: row.telegram_proxy_url || process.env.TELEGRAM_PROXY_URL || '',
      // Темы (Topics) супергруппы — по просьбе пользователя развести заказы
      // и дефицит материалов по разным веткам одного чата (см. комментарий
      // у этих колонок в schema.sql). Пусто — сообщение идёт в общую ленту
      // чата, как и раньше.
      ordersThreadId: row.telegram_orders_thread_id || '',
      stockThreadId: row.telegram_stock_thread_id || ''
    };
  } catch (err) {
    return { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, proxyUrl: process.env.TELEGRAM_PROXY_URL || '', ordersThreadId: '', stockThreadId: '' };
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n) {
  return Math.round(n || 0).toLocaleString('ru-RU') + ' ₽';
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

function describeError(err) {
  if (!err) return 'неизвестная ошибка';
  var parts = [];
  if (err.code) parts.push('code=' + err.code);
  if (err.name) parts.push('name=' + err.name);
  if (err.message) parts.push(err.message);
  return parts.length ? parts.join(' ') : String(err);
}

// method — метод Bot API (sendMessage, setMessageReaction); onDone(err, result)
// — result из ответа Telegram (у sendMessage там message_id).
function sendOnce(botToken, payload, agent, onDone, method) {
  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/' + (method || 'sendMessage'),
      method: 'POST',
      agent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300) {
          // Ответ пришёл от самого Telegram — прокси рабочий. telegramStatus
          // отличает такую ошибку от сетевой: на 4xx сервер не ищем и не
          // повторяем (неверный токен/чат другой прокси не исправит).
          const err = new Error('HTTP ' + res.statusCode + ': ' + body);
          err.telegramStatus = res.statusCode;
          onDone(err);
        } else {
          let result = null;
          try { result = JSON.parse(body).result; } catch (e) { /* тело не JSON — результата нет */ }
          onDone(null, result);
        }
      });
    }
  );
  req.setTimeout(5000, () => req.destroy(new Error('таймаут запроса к Telegram')));
  req.on('error', onDone);
  req.write(payload);
  req.end();
}

// У Telegram за api.telegram.org несколько IP по кругу (DNS round-robin), и
// с части российских сетей отдельные из них не проходят на уровне TCP, хотя
// другие — без проблем (проверено эмпирически). Повторная попытка делает
// свежее DNS-резолвение и имеет шанс попасть на рабочий адрес, вместо того
// чтобы просто один раз не повезло и тихо промолчать. maxAttempts — 3 в
// ручном режиме, 1 в пуле (там при сбое переходим на другой сервер, см.
// deliverViaPool). Ошибку самого Telegram (4xx) не повторяем.
function sendWithRetry(botToken, payload, agent, attempt, maxAttempts, resolve, reject, method) {
  sendOnce(botToken, payload, agent, (err, result) => {
    if (!err) { if (resolve) resolve(result); return; }
    if (attempt >= maxAttempts || isTelegramError(err)) {
      var described = describeError(err);
      console.error('Telegram: ошибка отправки после ' + attempt + ' попыток (' + described + ')');
      // err.message бывает ПУСТЫМ (например, у AggregateError от таймаута
      // сетевого соединения — code=ETIMEDOUT, Node не заполняет .message по
      // умолчанию) — тогда "Не удалось отправить сообщение: " + err.message
      // в router.js превращался в текст без самой причины, и единственным
      // способом узнать её было лезть в логи сервера (реальный случай,
      // нашёл пользователь). describeError() собирает code/name/message
      // вместе — всегда непустой.
      // telegramStatus сохраняем — по нему deliver() решает, искать ли сервер.
      if (reject) reject(Object.assign(new Error(described), err.telegramStatus ? { telegramStatus: err.telegramStatus } : {}));
      return;
    }
    setTimeout(() => sendWithRetry(botToken, payload, agent, attempt + 1, maxAttempts, resolve, reject, method), RETRY_DELAY_MS);
  }, method);
}

// Сам HTTP-вызов к Telegram — через объект, чтобы тесты могли подменить его и
// проверить "что, в какой чат и через какой прокси ушло" без сети.
// attempts — сколько попыток через ЭТОТ прокси: в ручном режиме 3 (как
// раньше), в пуле — 1 (при сбое быстрее перейти на другой сервер, чем
// повторять через мёртвый).
const transport = {
  post(botToken, chatId, text, proxyUrl, threadId, attempts) {
    const payload = JSON.stringify(Object.assign(
      { chat_id: chatId, text, parse_mode: 'HTML' },
      threadId ? { message_thread_id: Number(threadId) } : {}
    ));
    // Резолвится message_id отправленного сообщения (реакции реестра оплат).
    return new Promise((resolve, reject) => sendWithRetry(botToken, payload, proxyAgentFor(proxyUrl), 1, attempts || MAX_ATTEMPTS,
      (result) => resolve(result && result.message_id), reject));
  },
  // Любой другой метод Bot API (setMessageReaction) — те же прокси и повторы.
  call(botToken, method, params, proxyUrl, attempts) {
    const payload = JSON.stringify(params);
    return new Promise((resolve, reject) => sendWithRetry(botToken, payload, proxyAgentFor(proxyUrl), 1, attempts || MAX_ATTEMPTS, resolve, reject, method));
  }
};

// msg.method задан — вызов метода с msg.params вместо sendMessage.
function postWith(msg, proxyUrl, attempts) {
  if (msg.method) return transport.call(msg.botToken, msg.method, msg.params, proxyUrl, attempts);
  return transport.post(msg.botToken, msg.chatId, msg.text, proxyUrl, msg.threadId, attempts);
}

// Ответ от самого Telegram с ошибкой клиента (неверный токен/чат/тема, 429) —
// прокси тут ни при чём: сервер не ищем, в очередь не ставим.
function isTelegramError(err) {
  return !!(err && err.telegramStatus >= 400 && err.telegramStatus < 500);
}

class AllProxiesFailed extends Error {
  constructor(lastErr, total) {
    super('ни один из ' + total + ' серверов прокси не ответил (последняя ошибка: ' + describeError(lastErr) + ')');
    this.code = 'ALL_PROXIES_FAILED';
  }
}

// ---- Пул серверов прокси (change telegram-proxy-failover) ----
// Манифест пишет супервизор сервиса xray (xray/supervisor.js): серверы VPN-
// подписки, у каждого свой SOCKS-порт. Нет файла / битый / пустой — пула
// нет, работает ручной режим (поле «Прокси» в Настройках или env). Читаем
// перед каждой отправкой, но парсим только при смене mtime/размера —
// подписка обновляется раз в 6 часов, а сообщения идут чаще.
function manifestPath() {
  return process.env.TELEGRAM_PROXY_MANIFEST || '/app/xray-state/manifest.json';
}

let manifestCache = { key: null, data: null };
function readManifest() {
  const file = manifestPath();
  let st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  const key = file + ':' + st.mtimeMs + ':' + st.size;
  if (manifestCache.key === key) return manifestCache.data;
  let data = null;
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (json && Array.isArray(json.servers) && json.servers.length) data = json;
  } catch (e) { data = null; }
  manifestCache = { key, data };
  return data;
}

// Состояние пула — в памяти процесса: после перезапуска текущим считается
// первый сервер, первый же сбой сам найдёт рабочий (персистентность не
// нужна, см. design.md). searching — общий промис идущего поиска: два
// одновременных сбоя не устраивают два перебора по 10 серверов.
const pool = { currentId: null, since: null, lastSwitch: null, searching: null };

function currentIndex(servers) {
  const i = servers.findIndex((s) => s.id === pool.currentId);
  return i < 0 ? 0 : i;
}

function markCurrent(server) {
  if (pool.currentId !== server.id) {
    pool.currentId = server.id;
    pool.since = new Date();
  }
}

function postVia(server, msg) {
  return postWith(msg, server.proxyUrl, 1);
}

function shortReason(err) {
  return (err && (err.code || err.message)) || 'неизвестная ошибка';
}

// Перебор по кругу со следующего за упавшим. Первый сервер, через который
// ушло сообщение (или ответил сам Telegram — значит, туннель живой), становится
// текущим.
async function searchFrom(servers, failedIdx, firstErr, msg) {
  const failed = servers[failedIdx];
  let lastErr = firstErr;
  for (let k = 1; k < servers.length; k++) {
    const s = servers[(failedIdx + k) % servers.length];
    let res;
    try {
      res = await postVia(s, msg);
    } catch (err) {
      if (!isTelegramError(err)) { lastErr = err; continue; }
      switchTo(s, failed, firstErr);
      throw err;
    }
    switchTo(s, failed, firstErr);
    return res;
  }
  throw new AllProxiesFailed(lastErr, servers.length);
}

function switchTo(server, failed, reasonErr) {
  pool.lastSwitch = { at: new Date(), fromName: failed.name, reason: shortReason(reasonErr) };
  console.error('Telegram: сервер «' + failed.name + '» не ответил (' + describeError(reasonErr) + '), переключение на «' + server.name + '»');
  markCurrent(server);
}

// Запуск поиска под общим промисом. Проверка и установка pool.searching —
// синхронно, до первого await: иначе два почти одновременных сбоя оба
// увидели бы "поиска нет".
function search(servers, failedIdx, firstErr, msg) {
  const p = searchFrom(servers, failedIdx, firstErr, msg);
  pool.searching = p;
  p.catch(() => {}).then(() => { if (pool.searching === p) pool.searching = null; });
  return p;
}

// Попытка через текущий сервер; сетевой сбой — к поиску. Если поиск уже идёт
// (его запустило другое сообщение), ждём его и пробуем через найденный.
async function deliverViaPool(servers, msg) {
  if (pool.searching) await pool.searching.catch(() => {});
  let idx = currentIndex(servers);
  try {
    const res = await postVia(servers[idx], msg);
    markCurrent(servers[idx]);
    return res;
  } catch (err) {
    if (isTelegramError(err)) { markCurrent(servers[idx]); throw err; }
    if (pool.searching) {
      await pool.searching.catch(() => {});
      const now = currentIndex(servers);
      if (now !== idx) {
        try { return await postVia(servers[now], msg); } catch (err2) {
          if (isTelegramError(err2)) throw err2;
          idx = now;
          err = err2;
        }
      }
    }
    return search(servers, idx, err, msg);
  }
}

// Единая точка доставки одного сообщения: пул есть — через него с поиском,
// нет — как раньше (прокси из Настроек/env или напрямую, 3 попытки).
async function deliver(msg) {
  const manifest = readManifest();
  if (manifest) return deliverViaPool(manifest.servers, msg);
  const { proxyUrl } = await getCredentials();
  return postWith(msg, proxyUrl);
}

// ---- Очередь недоставленных (telegram_outbox) ----
async function enqueue(msg, err) {
  await db.pool.query(
    'INSERT INTO telegram_outbox (chat_id, thread_id, text, last_error) VALUES ($1, $2, $3, $4)',
    [String(msg.chatId), msg.threadId ? String(msg.threadId) : null, msg.text, describeError(err)]
  );
}

// Fire-and-forget-доставка для notify*: операцию не ждёт и не отменяет.
// Сетевой сбой (не ушло ни через один сервер) — в очередь; ошибка самого
// Telegram — только в лог (повтор её не исправит).
async function deliverOrQueue(msg, label) {
  try {
    return await deliver(msg);
  } catch (err) {
    if (isTelegramError(err)) {
      console.error('Telegram' + label + ': ' + describeError(err));
      return;
    }
    console.error('Telegram' + label + ': не отправлено (' + describeError(err) + ') — сообщение в очереди');
    try { await enqueue(msg, err); } catch (e) { console.error('Telegram: не удалось поставить в очередь — ' + describeError(e)); }
  }
}

// «⏱ Задержано: создано 14:05» — сегодня (по Москве) только время, иначе с датой.
function delayedStamp(createdAt, now) {
  const c = moscowDateTime(createdAt);
  const n = moscowDateTime(now);
  return c.slice(0, 10) === n.slice(0, 10) ? c.slice(11) : c.slice(0, 5) + ' ' + c.slice(11);
}

const OUTBOX_TTL_HOURS = 24;
let draining = false;

// Раз в 5 минут из server.js (тесты зовут напрямую, now — для детерминизма).
// Самое старое первым; ушло — следующее; сетевой сбой — стоп до следующего
// прогона (остальные через тот же мёртвый пул всё равно не уйдут).
async function drainOutbox(now) {
  if (draining) return;
  draining = true;
  const at = now ? new Date(now) : new Date();
  try {
    const { rows: expired } = await db.pool.query(
      "DELETE FROM telegram_outbox WHERE created_at < $1::timestamptz - interval '" + OUTBOX_TTL_HOURS + " hours' RETURNING id, created_at",
      [at]
    );
    expired.forEach((r) => console.error('Telegram: сообщение из очереди от ' + moscowDateTime(r.created_at) + ' старше 24 ч — удалено без отправки'));
    const { rows } = await db.pool.query('SELECT id, chat_id, thread_id, text, created_at FROM telegram_outbox ORDER BY id');
    if (!rows.length) return;
    const { botToken } = await getCredentials();
    if (!botToken) return;
    for (const r of rows) {
      const text = r.text + '\n⏱ Задержано: создано ' + delayedStamp(r.created_at, at);
      try {
        await deliver({ botToken, chatId: r.chat_id, threadId: r.thread_id, text });
      } catch (err) {
        if (isTelegramError(err)) {
          console.error('Telegram: сообщение из очереди от ' + moscowDateTime(r.created_at) + ' отклонено Telegram (' + describeError(err) + ') — удалено');
          await db.pool.query('DELETE FROM telegram_outbox WHERE id = $1', [r.id]);
          continue;
        }
        await db.pool.query('UPDATE telegram_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [r.id, describeError(err)]);
        return;
      }
      await db.pool.query('DELETE FROM telegram_outbox WHERE id = $1', [r.id]);
    }
  } finally {
    draining = false;
  }
}

// Статус для admin в Настройках (GET /api/config/telegram-status). Без
// адреса подписки, ключей и id серверов — только имя и номер.
async function status(now) {
  const at = now ? new Date(now) : new Date();
  const { rows } = await db.pool.query('SELECT count(*)::int AS count, min(created_at) AS oldest FROM telegram_outbox');
  const queue = { count: rows[0].count, oldestAt: rows[0].oldest ? new Date(rows[0].oldest).toISOString() : null };
  const manifest = readManifest();
  if (!manifest) return { mode: 'manual', current: null, lastSwitch: null, subscription: null, queue };
  const servers = manifest.servers;
  const used = servers.some((s) => s.id === pool.currentId);
  const idx = currentIndex(servers);
  const refreshedAt = manifest.refreshedAt ? new Date(manifest.refreshedAt) : null;
  return {
    mode: 'auto',
    current: { index: idx + 1, total: servers.length, name: servers[idx].name, since: used && pool.since ? pool.since.toISOString() : null },
    lastSwitch: pool.lastSwitch ? { at: pool.lastSwitch.at.toISOString(), fromName: pool.lastSwitch.fromName, reason: pool.lastSwitch.reason } : null,
    subscription: {
      refreshedAt: refreshedAt ? refreshedAt.toISOString() : null,
      count: servers.length,
      stale: !refreshedAt || at - refreshedAt > OUTBOX_TTL_HOURS * 3600 * 1000
    },
    queue
  };
}

// Уведомления заказов/остатков — общий чат (getCredentials) + своя тема.
// Не заданы токен или чат — молча пропускаем, как раньше.
function notify(text, threadId) {
  return getCredentials()
    .then(({ botToken, chatId }) => {
      if (!botToken || !chatId) return;
      return deliverOrQueue({ botToken, chatId, threadId, text }, '');
    })
    .catch((err) => console.error('Telegram: ' + describeError(err)));
}

// Реестр оплат — свой chat_id (config.telegram_registry_chat_id, по
// умолчанию отдельный от заказов/остатков) + своя тема в нём
// (telegram_registry_thread_id) — та же идея, что ordersThreadId/
// stockThreadId в getCredentials, но у реестра исторически свой отдельный
// чат, поэтому отдельный запрос, а не часть основного getCredentials. Бот
// тот же, что у заказов, прокси — тоже тот же (пул или ручной). Чат не
// задан — молчим: уведомления реестра необязательны, работа с заявками от
// них не зависит. Без fallback на env для чата — для реестра настройка
// только через интерфейс.
async function getRegistryCredentials() {
  const { botToken } = await getCredentials();
  const { rows } = await db.pool.query('SELECT telegram_registry_chat_id, telegram_registry_thread_id FROM config WHERE id = 1');
  const row = rows[0] || {};
  return { botToken, chatId: row.telegram_registry_chat_id || '', threadId: row.telegram_registry_thread_id || '' };
}

// Fire-and-forget, как notifyOrderCreated: вызывается без await из
// handlers/registry.js; сбой — в очередь или в лог, операцию не отменяет.
function notifyRegistry(text) {
  return getRegistryCredentials()
    .then(({ botToken, chatId, threadId }) => {
      if (!botToken || !chatId) return;
      return deliverOrQueue({ botToken, chatId, threadId, text }, ' (реестр оплат)');
    })
    .catch((err) => {
      console.error('Telegram (реестр оплат): ' + describeError(err));
    });
}

// Адресная отправка реестра (change reestr-payment-order, registry-notify.js):
// чат и тема — конкретного адресата («Учредитель» / «Бухгалтер»), бот и
// прокси — общие. Та же доставка с очередью, что у notifyRegistry.
function notifyRegistryTo(to, text) {
  return getCredentials()
    .then(({ botToken }) => {
      if (!botToken || !to || !to.chatId) return;
      return deliverOrQueue({ botToken, chatId: to.chatId, threadId: to.threadId || '', text }, ' (реестр оплат)');
    })
    .catch((err) => {
      console.error('Telegram (реестр оплат): ' + describeError(err));
    });
}

// Реакция бота на своё сообщение реестра (emoji — из стандартного набора
// Telegram; null — снять). Без очереди: не дошло — в лог, бросает ошибку,
// вызывающий не помечает реакцию поставленной.
async function setRegistryReaction(chatId, messageId, emoji) {
  const { botToken } = await getCredentials();
  if (!botToken) return false;
  await deliver({
    botToken,
    method: 'setMessageReaction',
    params: { chat_id: chatId, message_id: Number(messageId), reaction: emoji ? [{ type: 'emoji', emoji }] : [] }
  });
  return true;
}

// Тестовое сообщение конкретному адресату — ждёт результат, ошибка на экран.
async function sendRegistryTestTo(to, label, head) {
  const { botToken } = await getCredentials();
  if (!botToken) throw new Error('Токен бота не задан (раздел «Уведомления в Telegram»)');
  if (!to || !to.chatId) throw new Error('ID чата адресата «' + label + '» не задан');
  return deliver({ botToken, chatId: to.chatId, threadId: to.threadId || '', text: (head || '') + '✅ Тестовое сообщение реестра оплат AdatBeton Calc для адресата «' + label + '».' });
}

// Кнопка "Отправить тестовое" в разделе реестра Настроек — ждёт результат,
// с тем же поиском сервера, но без очереди: ошибка сразу на экран.
async function sendRegistryTest() {
  const { botToken, chatId, threadId } = await getRegistryCredentials();
  if (!botToken) throw new Error('Токен бота не задан (раздел «Уведомления в Telegram»)');
  if (!chatId) throw new Error('ID чата реестра оплат не задан');
  return deliver({ botToken, chatId, threadId, text: '✅ Тестовое сообщение реестра оплат AdatBeton Calc.' });
}


// Тема — своя на каждую категорию (см. getCredentials), читаем заново на
// каждое уведомление, а не передаём параметром — notifyOrderCreated и т.п.
// вызываются из разных хендлеров, которым незачем знать про темы вообще.
async function ordersThreadId() { return (await getCredentials()).ordersThreadId; }
async function stockThreadId() { return (await getCredentials()).stockThreadId; }

function notifyOrderCreated(order) {
  const lines = [
    '🧱 <b>Новый заказ — ' + escapeHtml(order.plantName) + '</b>',
    'Марка: ' + escapeHtml(order.recipeName),
    // Найм (change order-hired-delivery): машину ищут на стороне — вместо
    // миксера режим и ставка перевозчика.
    order.deliveryMode === 'hired'
      ? 'Доставка: Найм · ' + String(order.hireRatePerM3).replace('.', ',') + ' ₽/м³'
      : 'Миксер: ' + escapeHtml(order.mixerName),
    'Объём: ' + order.saleVolume + ' м³',
    // Ограничение подъезда (change client-list): миксер едет неполным —
    // это должны видеть оператор РБУ и водитель. Без ограничения строки нет.
    ...(order.maxLoadM3 != null ? ['Рейсов: ' + order.tripCount + ' × ' + String(order.maxLoadM3).replace('.', ',') + ' м³ (ограничение подъезда)'] : []),
    'Расстояние: ' + order.distanceKm + ' км',
    'Выручка: ' + money(order.totalRevenue),
    'Прибыль: ' + money(order.totalProfit) + ' (' + Number(order.totalMarginPercent || 0).toFixed(1).replace('.', ',') + '%)'
  ];
  ordersThreadId().then((threadId) => notify(lines.join('\n'), threadId)).catch(() => {});
}

// Исправление заказа (change order-edit) — в тот же чат заказов: это
// основной инструмент контроля правок, в том числе работников по ссылке.
// notice — из handlers/orders.js::recordEdit: строки изменений уже готовы.
// Fire-and-forget после COMMIT: сбой отправки исправление не отменяет.
function notifyOrderEdited(notice) {
  const o = notice.order;
  const lines = [
    '✏️ <b>Заказ исправлен · ' + escapeHtml(o.plantName) + ' · ' + escapeHtml(o.clientName) + '</b>',
    'Заказ от ' + escapeHtml(moscowDate(o.createdAt)),
    ...notice.changes.map((c) => escapeHtml(c.text)),
    escapeHtml(notice.profit),
    'Исправил: ' + escapeHtml(notice.actor)
  ];
  // Та же тема, что и у создания заказа (notifyOrderCreated) — правка это
  // продолжение той же ленты, не отдельная категория.
  ordersThreadId().then((threadId) => notify(lines.join('\n'), threadId)).catch(() => {});
}

// Дефицит/приближение к порогу материала — шлётся из handlers/stock.js на
// пересечении порога сверху вниз (не на каждое движение уже дефицитного
// материала). available может быть и отрицательным (реальный дефицит, не
// просто "ниже порога") — форматируем как есть, число говорит само за себя.
// receiptId — та же запись поступления инертных, что вызвала пересечение
// порога (см. handlers/stock.js), а не только заказ.
function notifyStockDeficit(material, available, threshold, orderId, receiptId) {
  const lines = [
    (available < 0 ? '🔴' : '🟡') + ' <b>' + (available < 0 ? 'Дефицит материала' : 'Материал ниже порога') + '</b>',
    'Материал: ' + escapeHtml(material.name),
    'Доступно: ' + Number(available).toLocaleString('ru-RU') + (available < 0 ? ' (бронь превышает остаток)' : ''),
    'Порог: ' + Number(threshold).toLocaleString('ru-RU')
  ];
  if (orderId) lines.push('Заказ: ' + escapeHtml(orderId));
  if (receiptId) lines.push('Поступление: ' + escapeHtml(receiptId));
  stockThreadId().then((threadId) => notify(lines.join('\n'), threadId)).catch(() => {});
}

// Для кнопки "Отправить тестовое" в Настройках — в отличие от notify*
// выше, реально дожидается результата и пробрасывает ошибку наверх. Тема не
// передаётся (общая лента чата — это тест соединения, а не конкретной темы),
// поиск сервера — как у обычных сообщений, очереди нет.
async function sendTest() {
  const { botToken, chatId } = await getCredentials();
  if (!botToken || !chatId) throw new Error('Токен бота или ID чата не заданы');
  return deliver({ botToken, chatId, text: '✅ Тестовое сообщение из AdatBeton Calc. Если вы это видите — бот настроен верно.' });
}

// Только для тестов: сбросить текущий сервер и кэш манифеста между сценариями.
function resetPoolForTests() {
  pool.currentId = null;
  pool.since = null;
  pool.lastSwitch = null;
  pool.searching = null;
  manifestCache = { key: null, data: null };
}

module.exports = { notifyOrderCreated, notifyOrderEdited, notifyStockDeficit, sendTest, notifyRegistry, sendRegistryTest, notifyRegistryTo, sendRegistryTestTo, setRegistryReaction, escapeHtml, transport, drainOutbox, status, resetPoolForTests };
