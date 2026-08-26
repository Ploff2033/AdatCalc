const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// keepAlive — без него каждое сообщение заново делает TLS-хендшейк до
// api.telegram.org (замерено: ~1.3с из ~1.5с общей задержки уходит именно на
// него). С переиспользуемым соединением второе и последующие сообщения идут
// заметно быстрее — только первое после старта сервера/простоя платит полную цену.
const agent = new https.Agent({ keepAlive: true, timeout: 5000 });

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

function sendOnce(payload, onDone) {
  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: '/bot' + BOT_TOKEN + '/sendMessage',
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
function sendWithRetry(payload, attempt) {
  sendOnce(payload, (err) => {
    if (!err) return;
    if (attempt >= MAX_ATTEMPTS) {
      console.error('Telegram: ошибка отправки после ' + attempt + ' попыток (' + describeError(err) + ')');
      return;
    }
    setTimeout(() => sendWithRetry(payload, attempt + 1), RETRY_DELAY_MS);
  });
}

// Best-effort: если TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы или
// Telegram недоступен — молча пропускаем (только лог в консоль сервера),
// оформление заказа это никогда не блокирует.
function send(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  sendWithRetry(payload, 1);
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
  send(lines.join('\n'));
}

module.exports = { notifyOrderCreated };
