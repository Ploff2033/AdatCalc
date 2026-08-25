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

// Best-effort: если TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы или
// Telegram недоступен — молча пропускаем (только лог в консоль сервера),
// оформление заказа это никогда не блокирует.
function send(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
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
        if (res.statusCode >= 300) console.error('Telegram: ошибка отправки (' + res.statusCode + '): ' + body);
      });
    }
  );
  req.setTimeout(5000, () => req.destroy(new Error('таймаут запроса к Telegram')));
  req.on('error', (err) => console.error('Telegram: ошибка отправки:', err.message));
  req.write(payload);
  req.end();
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
