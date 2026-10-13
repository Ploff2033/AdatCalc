// Живой HTTP-сервер на случайном порту поверх того же router.handleRequest,
// что и в server.js — тесты маршрутов идут через настоящую проверку прав.
// UPLOADS_DIR — временный каталог: файлы реестра не попадают в backend/uploads.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

if (!process.env.UPLOADS_DIR) {
  process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-test-uploads-'));
}

const dbh = require('./db');
const { handleRequest } = require('../../router');
const { createSession } = require('../../sessions');

let server = null;
let base = null;

async function start() {
  if (base) return base;
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => { res.writeHead(500); res.end(String(err)); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  return base;
}

async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  base = null;
  await dbh.close();
}

async function cookieFor(role) {
  return 'session=' + (await createSession(role));
}

// opts: { cookie, owner, json, raw, contentType, headers }
async function call(method, url, opts) {
  const o = opts || {};
  const headers = Object.assign({}, o.headers);
  if (o.cookie) headers.cookie = o.cookie;
  if (o.owner) headers['x-owner-token'] = o.owner;
  let body;
  if (o.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(o.json);
  } else if (o.raw !== undefined) {
    headers['content-type'] = o.contentType || 'application/octet-stream';
    body = o.raw;
  }
  const res = await fetch((await start()) + url, { method, headers, body });
  const textBody = await res.text();
  let data = null;
  try { data = textBody ? JSON.parse(textBody) : null; } catch (err) { data = textBody; }
  return { status: res.status, data, headers: res.headers };
}

module.exports = { start, stop, call, cookieFor, uploadsDir: process.env.UPLOADS_DIR };
