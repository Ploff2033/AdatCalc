const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const HttpError = require('./http-error');

// Фото чеков ДДС — присылаются как data: URL в JSON-теле (см.
// handlers/cash-entries.js), не как multipart/form-data: клиент уже
// сжимает фото через canvas перед отправкой (см. screen-cash.js/
// mobile-cash-form.js), так что лишний парсер multipart тут не нужен —
// один POST/PUT с обычным JSON, как и у всего остального API.
const RECEIPTS_DIR = path.join(__dirname, 'uploads', 'receipts');
const MAX_DECODED_BYTES = 3 * 1024 * 1024; // сжатое на клиенте фото должно укладываться с запасом

function extFromMime(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

async function saveReceiptPhoto(dataUrl, id) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) throw new HttpError(400, 'Некорректный формат фото чека');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_DECODED_BYTES) throw new HttpError(413, 'Фото чека слишком большое');
  await fsp.mkdir(RECEIPTS_DIR, { recursive: true });
  const filename = id + extFromMime(match[1]);
  await fsp.writeFile(path.join(RECEIPTS_DIR, filename), buffer);
  return '/uploads/receipts/' + filename;
}

// receiptPath — путь вида "/uploads/receipts/xxx.jpg", как хранится в
// cash_entries.receipt_path. basename() отрезает и защищает от "../".
async function deleteReceiptPhoto(receiptPath) {
  if (!receiptPath) return;
  const full = path.join(RECEIPTS_DIR, path.basename(receiptPath));
  try { await fsp.unlink(full); } catch (err) { /* уже нет — не страшно */ }
}

module.exports = { saveReceiptPhoto, deleteReceiptPhoto };
