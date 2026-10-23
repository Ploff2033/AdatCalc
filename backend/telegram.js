const { moscowDate } = require('./order-edit-diff');
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

function sendOnce(botToken, payload, agent, onDone) {
  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/sendMessage',
      method: 'POST',
      agent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    },
    (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300) onDone(new Error('HTTP ' + res.statusCode + ': ' + body));
        else onDone(null);
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
// чтобы просто один раз не повезло и тихо промолчать. resolve/reject —
// опциональны: notifyOrderCreated и т.п. их не передают (fire-and-forget,
// ошибка только в консоли), а send() ниже передаёт — нужно для кнопки
// "Отправить тестовое" в Настройках, которая должна показать реальный
// результат, а не всегда "успех".
function sendWithRetry(botToken, payload, agent, attempt, resolve, reject) {
  sendOnce(botToken, payload, agent, (err) => {
    if (!err) { if (resolve) resolve(); return; }
    if (attempt >= MAX_ATTEMPTS) {
      var described = describeError(err);
      console.error('Telegram: ошибка отправки после ' + attempt + ' попыток (' + described + ')');
      // err.message бывает ПУСТЫМ (например, у AggregateError от таймаута
      // сетевого соединения — code=ETIMEDOUT, Node не заполняет .message по
      // умолчанию) — тогда "Не удалось отправить сообщение: " + err.message
      // в router.js превращался в текст без самой причины, и единственным
      // способом узнать её было лезть в логи сервера (реальный случай,
      // нашёл пользователь). describeError() собирает code/name/message
      // вместе — всегда непустой.
      if (reject) reject(new Error(described));
      return;
    }
    setTimeout(() => sendWithRetry(botToken, payload, agent, attempt + 1, resolve, reject), RETRY_DELAY_MS);
  });
}

// send() всегда возвращает Promise (резолвится/реджектится по итогам
// реальной отправки) — вызывающие best-effort уведомления (notifyOrderCreated
// и т.п.) просто вешают .catch(()=>{}) и не ждут результата, а sendTest()
// ниже действительно ждёт и сообщает об ошибке.
// threadId — опциональный message_thread_id темы супергруппы (см.
// ordersThreadId/stockThreadId в getCredentials). notifyOrderCreated и т.п.
// передают его явно, sendTest() — нет (шлёт в общую ленту чата, это тест
// соединения, а не конкретной темы).
async function send(text, threadId) {
  const { botToken, chatId, proxyUrl } = await getCredentials();
  if (!botToken || !chatId) throw new Error('Токен бота или ID чата не заданы');
  return transport.post(botToken, chatId, text, proxyUrl, threadId);
}

// Сам HTTP-вызов к Telegram — через объект, чтобы тесты реестра оплат могли
// подменить его и проверить "что и в какой чат ушло" без сети.
const transport = {
  post(botToken, chatId, text, proxyUrl, threadId) {
    const payload = JSON.stringify(Object.assign(
      { chat_id: chatId, text, parse_mode: 'HTML' },
      threadId ? { message_thread_id: Number(threadId) } : {}
    ));
    return new Promise((resolve, reject) => sendWithRetry(botToken, payload, proxyAgentFor(proxyUrl), 1, resolve, reject));
  }
};

// Реестр оплат — свой chat_id (config.telegram_registry_chat_id, по
// умолчанию отдельный от заказов/остатков) + своя тема в нём
// (telegram_registry_thread_id) — та же идея, что ordersThreadId/
// stockThreadId в getCredentials, но у реестра исторически свой отдельный
// чат, поэтому отдельный запрос, а не часть основного getCredentials. Бот
// тот же, что у заказов, прокси (если настроен) — тоже тот же. Чат не
// задан — молчим: уведомления реестра необязательны, работа с заявками от
// них не зависит. Без fallback на env для чата — для реестра настройка
// только через интерфейс.
async function getRegistryCredentials() {
  const { botToken, proxyUrl } = await getCredentials();
  const { rows } = await db.pool.query('SELECT telegram_registry_chat_id, telegram_registry_thread_id FROM config WHERE id = 1');
  const row = rows[0] || {};
  return { botToken, proxyUrl, chatId: row.telegram_registry_chat_id || '', threadId: row.telegram_registry_thread_id || '' };
}

// Fire-and-forget, как notifyOrderCreated: вызывается без await из
// handlers/registry.js, ошибка — только в лог, операцию не отменяет.
function notifyRegistry(text) {
  return getRegistryCredentials()
    .then(({ botToken, chatId, proxyUrl, threadId }) => {
      if (!botToken || !chatId) return;
      return transport.post(botToken, chatId, text, proxyUrl, threadId);
    })
    .catch((err) => {
      console.error('Telegram (реестр оплат): ' + describeError(err));
    });
}

// Кнопка "Отправить тестовое" в разделе реестра Настроек — ждёт результат.
async function sendRegistryTest() {
  const { botToken, chatId, proxyUrl, threadId } = await getRegistryCredentials();
  if (!botToken) throw new Error('Токен бота не задан (раздел «Уведомления в Telegram»)');
  if (!chatId) throw new Error('ID чата реестра оплат не задан');
  return transport.post(botToken, chatId, '✅ Тестовое сообщение реестра оплат AdatBeton Calc.', proxyUrl, threadId);
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
    'Миксер: ' + escapeHtml(order.mixerName),
    'Объём: ' + order.saleVolume + ' м³',
    // Ограничение подъезда (change client-list): миксер едет неполным —
    // это должны видеть оператор РБУ и водитель. Без ограничения строки нет.
    ...(order.maxLoadM3 != null ? ['Рейсов: ' + order.tripCount + ' × ' + String(order.maxLoadM3).replace('.', ',') + ' м³ (ограничение подъезда)'] : []),
    'Расстояние: ' + order.distanceKm + ' км',
    'Выручка: ' + money(order.totalRevenue),
    'Прибыль: ' + money(order.totalProfit) + ' (' + Number(order.totalMarginPercent || 0).toFixed(1).replace('.', ',') + '%)'
  ];
  ordersThreadId().then((threadId) => send(lines.join('\n'), threadId)).catch(() => {});
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
  ordersThreadId().then((threadId) => send(lines.join('\n'), threadId)).catch(() => {});
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
  stockThreadId().then((threadId) => send(lines.join('\n'), threadId)).catch(() => {});
}

// Для кнопки "Отправить тестовое" в Настройках — в отличие от notify*
// выше, реально дожидается результата и пробрасывает ошибку наверх.
function sendTest() {
  return send('✅ Тестовое сообщение из AdatBeton Calc. Если вы это видите — бот настроен верно.');
}

module.exports = { notifyOrderCreated, notifyOrderEdited, notifyStockDeficit, sendTest, notifyRegistry, sendRegistryTest, escapeHtml, transport };
