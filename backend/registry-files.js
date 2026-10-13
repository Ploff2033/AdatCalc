const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const HttpError = require('./http-error');

// Файлы реестра оплат (счета, договоры, платёжки). В отличие от фото чеков
// ДДС (backend/uploads.js — data: URL внутри JSON, до 3 МБ) приходят сырым
// телом запроса: base64 раздул бы PDF на 10 МБ до ~13,4 МБ JSON, а парсер
// multipart без зависимостей — лишний код. Лежат в uploads/registry/,
// раздаются тем же /uploads/ без входа (ссылки из Excel у бухгалтера) —
// поэтому имя на диске из 128 бит случайности, подобрать нельзя.
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const REGISTRY_DIR = path.join(UPLOADS_ROOT, 'registry');
const MAX_BYTES = 10 * 1024 * 1024;

// Тип — по сигнатуре содержимого, не по Content-Type/расширению от клиента.
function detectType(buf) {
  if (buf.length >= 4 && buf.slice(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: '.pdf' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

function tooBig() {
  return new HttpError(413, 'Файл больше 10 МБ');
}

// Сырое тело запроса в Buffer с лимитом. Content-Length проверяем заранее —
// чтобы не качать 50 МБ ради отказа.
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BYTES) {
      reject(tooBig());
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BYTES) {
        failed = true;
        reject(tooBig());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function validate(buf) {
  if (!buf.length) throw new HttpError(400, 'Пустой файл');
  if (buf.length > MAX_BYTES) throw tooBig();
  const type = detectType(buf);
  if (!type) throw new HttpError(415, 'Допустимы только PDF и фото (JPEG, PNG, WEBP)');
  return type;
}

async function save(buf, type) {
  await fsp.mkdir(REGISTRY_DIR, { recursive: true });
  const storedName = crypto.randomBytes(16).toString('hex') + type.ext;
  await fsp.writeFile(path.join(REGISTRY_DIR, storedName), buf);
  return storedName;
}

// basename() — защита от "../" в имени, хотя имя всегда наше.
async function remove(storedName) {
  if (!storedName) return;
  try {
    await fsp.unlink(path.join(REGISTRY_DIR, path.basename(storedName)));
  } catch (err) {
    // уже нет — не страшно: строка в БД удалена, ссылку больше никто не знает
  }
}

function publicPath(storedName) {
  return '/uploads/registry/' + storedName;
}

module.exports = { MAX_BYTES, REGISTRY_DIR, detectType, readRaw, validate, save, remove, publicPath };
