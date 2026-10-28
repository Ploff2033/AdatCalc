// Супервизор контейнера xray (change telegram-proxy-failover): качает
// VPN-подписку, собирает из неё конфиг Xray (порт на каждый сервер) и
// манифест для calc, держит процесс Xray запущенным. Вместо ручного
// xray-config.json — тот содержал один сервер, и когда он умирал (обычно
// через пару дней), уведомления в Telegram молча пропадали.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { spawn } = require('child_process');
const sub = require('./subscription');

const STATE_DIR = process.env.XRAY_STATE_DIR || '/state';
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
const MANIFEST_PATH = path.join(STATE_DIR, 'manifest.json');
const SUBSCRIPTION_URL = process.env.XRAY_SUBSCRIPTION_URL || '';
const PROXY_HOST = process.env.XRAY_PROXY_HOST || 'xray';
const XRAY_BIN = process.env.XRAY_BIN || '/usr/bin/xray';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const RESTART_DELAY_MS = 5000;
// Krepost и похожие провайдеры отдают разный формат в зависимости от
// User-Agent — представляемся обычным клиентом, чтобы получить base64-список.
const USER_AGENT = 'v2rayN/6.0';

function log(msg) { console.log(new Date().toISOString() + ' ' + msg); }

// Адрес подписки — секрет (токен в пути), в лог только хост.
function subHost() {
  try { return new URL(SUBSCRIPTION_URL).host; } catch (e) { return '(некорректный адрес)'; }
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ---- процесс Xray ----
let child = null;
let stopping = false;

function startXray() {
  if (!fs.existsSync(CONFIG_PATH)) return;
  stopping = false;
  child = spawn(XRAY_BIN, ['run', '-c', CONFIG_PATH], { stdio: 'inherit' });
  const me = child;
  child.on('exit', (code, signal) => {
    if (child === me) child = null;
    if (stopping) return;
    log('xray: процесс завершился (code=' + code + ' signal=' + signal + '), перезапуск через 5 с');
    setTimeout(() => { if (!child) startXray(); }, RESTART_DELAY_MS);
  });
}

function restartXray() {
  return new Promise((resolve) => {
    if (!child) { startXray(); return resolve(); }
    stopping = true;
    const old = child;
    old.once('exit', () => { child = null; startXray(); resolve(); });
    old.kill('SIGTERM');
  });
}

// ---- скачивание подписки ----
function readResponse(res, resolve, reject) {
  if (res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (c) => { body += c; });
  res.on('end', () => resolve(body));
}

function fetchDirect(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => readResponse(res, resolve, reject));
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('таймаут')));
    req.on('error', reject);
  });
}

// Через служебный HTTP-вход Xray (127.0.0.1:10800 → первый сервер): адрес
// подписки тоже может быть недоступен с сервера напрямую. HTTP CONNECT +
// tls поверх полученного сокета — без npm-агентов.
function fetchViaXray(url) {
  const u = new URL(url);
  const port = Number(u.port || 443);
  return new Promise((resolve, reject) => {
    const connect = http.request({ host: '127.0.0.1', port: sub.BASE_PORT, method: 'CONNECT', path: u.hostname + ':' + port });
    connect.setTimeout(FETCH_TIMEOUT_MS, () => connect.destroy(new Error('таймаут CONNECT')));
    connect.on('error', reject);
    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error('CONNECT ' + res.statusCode)); }
      const req = https.request({
        host: u.hostname,
        port,
        path: u.pathname + u.search,
        headers: { 'User-Agent': USER_AGENT },
        createConnection: () => tls.connect({ socket, servername: u.hostname })
      }, (r) => readResponse(r, resolve, reject));
      req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('таймаут')));
      req.on('error', reject);
      req.end();
    });
    connect.end();
  });
}

async function fetchSubscription() {
  try {
    return await fetchDirect(SUBSCRIPTION_URL);
  } catch (err) {
    if (!child) throw err;
    log('подписка: напрямую не скачалась (' + err.message + '), пробую через Xray');
    return fetchViaXray(SUBSCRIPTION_URL);
  }
}

// ---- обновление ----
async function refresh() {
  if (!SUBSCRIPTION_URL) {
    log('подписка: XRAY_SUBSCRIPTION_URL не задан' + (fs.existsSync(CONFIG_PATH) ? ', работаю на прежнем конфиге' : ', Xray не запущен'));
    return;
  }
  let body;
  try {
    body = await fetchSubscription();
  } catch (err) {
    log('подписка (' + subHost() + '): ошибка скачивания — ' + err.message + '; остаюсь на прежнем списке');
    return;
  }
  const { servers, skipped } = sub.parseSubscription(body);
  skipped.forEach((s) => log('подписка: пропущена ссылка ' + s));
  if (!servers.length) {
    log('подписка (' + subHost() + '): нет ни одной vless-ссылки, начало ответа: ' + JSON.stringify(String(body).slice(0, 80)) + '; остаюсь на прежнем списке');
    return;
  }
  const prev = readJson(MANIFEST_PATH);
  const plan = sub.planRefresh(fs.existsSync(CONFIG_PATH) ? prev : null, servers);
  const manifest = sub.buildManifest(servers, Date.now(), PROXY_HOST);
  if (plan === 'changed') {
    // Порядок важен: сначала конфиг и перезапуск Xray, потом манифест —
    // иначе calc увидит порт, который Xray ещё не слушает.
    writeAtomic(CONFIG_PATH, JSON.stringify(sub.buildConfig(servers), null, 2));
    await restartXray();
    log('подписка: ' + servers.length + ' серверов, конфиг пересобран, Xray перезапущен');
  } else {
    log('подписка: ' + servers.length + ' серверов, без изменений');
  }
  writeAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  startXray();
  const tick = () => refresh().catch((err) => log('подписка: непредвиденная ошибка — ' + (err && err.message)));
  tick();
  setInterval(tick, REFRESH_MS);
  const shutdown = () => { stopping = true; if (child) child.kill('SIGTERM'); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
