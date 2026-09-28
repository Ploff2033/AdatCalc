// Node-порт frontend-v2/js/zip-writer.js — та же логика (ZIP без сжатия,
// метод "stored", CRC32 по спецификации), но возвращает Buffer, а не Blob:
// нужен на бэкенде для автосинхронизации ДДС в Облако Mail.ru (см.
// backend/cash-ledger.js, backend/mailru-sync.js) — файл собирается на
// сервере, без браузера. Код совпадает почти дословно, не общий модуль
// с фронтом (тот же принцип, что уже применён к CATEGORY_LABELS и т.п. —
// см. backend/handlers/cash-entries.js) — так подключение остаётся простым
// require() без сборки/бандлинга.

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// files: [{ name: 'Папка/файл.jpg', data: Buffer }] -> Buffer (сам .zip)
function build(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0, dosDate = (1 << 9) | (1 << 5) | 1;

  files.forEach((f) => {
    const nameBytes = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(localParts.concat(centralParts, [end]));
}

module.exports = { build };
