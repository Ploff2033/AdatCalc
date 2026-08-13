const http = require('http');
const db = require('./backend/db');
const { handleRequest } = require('./backend/router');

const PORT = process.env.PORT || 3000;
const HOST = 'localhost';

async function main() {
  await db.load();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('Необработанная ошибка запроса:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'Внутренняя ошибка сервера' }));
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Сервер запущен: http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
