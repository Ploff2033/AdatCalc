const http = require('http');
const db = require('./backend/db');
const { handleRequest } = require('./backend/router');
const telegram = require('./backend/telegram');

const PORT = process.env.PORT || 3000;
// 0.0.0.0 по умолчанию — в контейнере/на сервере снаружи не достучаться до
// процесса, слушающего только localhost. Для локальной разработки тоже
// работает нормально (localhost:PORT остаётся доступен).
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  await db.load();

  // Очередь недоставленных в Telegram (change telegram-proxy-failover) —
  // раз в 5 минут досылаем то, что не ушло ни через один сервер прокси.
  setInterval(() => {
    telegram.drainOutbox().catch((err) => console.error('Telegram: ошибка досылки очереди — ' + (err && err.message)));
  }, 5 * 60 * 1000);

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('Необработанная ошибка запроса:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'Внутренняя ошибка сервера' }));
    });
  });

  // Node не включает TCP_NODELAY по умолчанию — без этого ответы, отправленные
  // несколькими TCP-пакетами (заголовки отдельно от тела), застревают на связке
  // Nagle + delayed ACK: до ~200-400мс на КАЖДЫЙ запрос по реальной сети (на
  // loopback незаметно, отсюда "локально быстро, а с браузера тормозит").
  server.on('connection', (socket) => socket.setNoDelay(true));

  server.listen(PORT, HOST, () => {
    console.log(`Сервер запущен: http://localhost:${PORT} (слушает ${HOST}:${PORT})`);
  });
}

main().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
