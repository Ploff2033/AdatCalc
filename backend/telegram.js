const https = require('https');
const db = require('./db');

// keepAlive — без него каждое сообщение заново делает TLS-хендшейк до
// api.telegram.org (замерено: ~1.3с из ~1.5с общей задержки уходит именно на
// него). С переиспользуемым соединением второе и последующие сообщения идут
// заметно быстрее — только первое после старта сервера/простоя платит полную цену.
const agent = new https.Agent({ keepAlive: true, timeout: 5000 });

// Токен/chat id читаются из config (правятся в Настройках без доступа к
// серверу), при пустом значении — fallback на переменные окружения, чтобы
// уже настроенные через .env боевые деплои не сломались, пока их явно не
// перенастроят через интерфейс. Читаем заново на каждую отправку (не
// кэшируем при старте сервера) — иначе смена токена в Настройках потребовала
// бы перезапуска.
async function getCredentials() {
  try {
    const { rows } = await db.pool.query('SELECT telegram_bot_token, telegram_chat_id FROM config WHERE id = 1');
    const row = rows[0] || {};
    return {
      botToken: row.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN,
      chatId: row.telegram_chat_id || process.env.TELEGRAM_CHAT_ID
    };
  } catch (err) {
    return { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
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

function sendOnce(botToken, payload, onDone) {
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
// чтобы просто один раз не повезло и тихо промолчать.
function sendWithRetry(botToken, payload, attempt) {
  sendOnce(botToken, payload, (err) => {
    if (!err) return;
    if (attempt >= MAX_ATTEMPTS) {
      console.error('Telegram: ошибка отправки после ' + attempt + ' попыток (' + describeError(err) + ')');
      return;
    }
    setTimeout(() => sendWithRetry(botToken, payload, attempt + 1), RETRY_DELAY_MS);
  });
}

// Best-effort: если токен/chat id не заданы (ни в config, ни в env) или
// Telegram недоступен — молча пропускаем (только лог в консоль сервера),
// это никогда не блокирует саму операцию (оформление заказа, списание и т.п.).
async function send(text) {
  const { botToken, chatId } = await getCredentials();
  if (!botToken || !chatId) return;
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  sendWithRetry(botToken, payload, 1);
}

function notifyOrderCreated(order) {
  const lines = [
    '🧱 <b>Новый заказ — ' + escapeHtml(order.plantName) + '</b>',
    'Марка: ' + escapeHtml(order.recipeName),
    'Миксер: ' + escapeHtml(order.mixerName),
    'Объём: ' + order.saleVolume + ' м³',
    'Расстояние: ' + order.distanceKm + ' км',
    'Выручка: ' + money(order.totalRevenue),
    'Прибыль: ' + money(order.totalProfit) + ' (' + Number(order.totalMarginPercent || 0).toFixed(1).replace('.', ',') + '%)'
  ];
  send(lines.join('\n')).catch(() => {});
}

// Дефицит/приближение к порогу материала — шлётся из handlers/stock.js на
// пересечении порога сверху вниз (не на каждое движение уже дефицитного
// материала). available может быть и отрицательным (реальный дефицит, не
// просто "ниже порога") — форматируем как есть, число говорит само за себя.
function notifyStockDeficit(material, available, threshold, orderId) {
  const lines = [
    (available < 0 ? '🔴' : '🟡') + ' <b>' + (available < 0 ? 'Дефицит материала' : 'Материал ниже порога') + '</b>',
    'Материал: ' + escapeHtml(material.name),
    'Доступно: ' + Number(available).toLocaleString('ru-RU') + (available < 0 ? ' (бронь превышает остаток)' : ''),
    'Порог: ' + Number(threshold).toLocaleString('ru-RU')
  ];
  if (orderId) lines.push('Заказ: ' + escapeHtml(orderId));
  send(lines.join('\n')).catch(() => {});
}

module.exports = { notifyOrderCreated, notifyStockDeficit };
