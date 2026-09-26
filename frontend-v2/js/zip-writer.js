(function () {
  // Собирает .zip прямо в браузере, без сжатия (метод "stored") — ровно
  // столько, сколько нужно, чтобы упаковать CSV-ведомость и фото чеков в
  // один файл со вложенной папкой. Внешних библиотек в проекте нет (см.
  // остальные js/*.js — везде голый vanilla), поэтому формат собирается
  // руками по спецификации ZIP: локальный заголовок + данные на каждый
  // файл, затем central directory, затем end-of-central-directory record.
  // Флаг 0x0800 (бит 11, UTF-8 имена) — чтобы кириллические названия папки/
  // файлов открывались без кракозябр в Проводнике/Finder/7-Zip.

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // files: [{ name: 'Папка/файл.jpg', data: Uint8Array }]
  function build(files) {
    var encoder = new TextEncoder();
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var dosTime = 0, dosDate = (1 << 9) | (1 << 5) | 1; // произвольная фиксированная дата — не важна для распаковки

    files.forEach(function (f) {
      var nameBytes = encoder.encode(f.name.replace(/\\/g, '/'));
      var data = f.data;
      var crc = crc32(data);
      var size = data.length;

      var local = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(local.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0x0800, true);
      ldv.setUint16(8, 0, true);
      ldv.setUint16(10, dosTime, true);
      ldv.setUint16(12, dosDate, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      localParts.push(local, data);

      var central = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(central.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, dosTime, true);
      cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length + data.length;
    });

    var centralOffset = offset;
    var centralSize = centralParts.reduce(function (s, p) { return s + p.length; }, 0);

    var end = new Uint8Array(22);
    var edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, centralOffset, true);
    edv.setUint16(20, 0, true);

    return new Blob(localParts.concat(centralParts, [end]), { type: 'application/zip' });
  }

  window.ZipWriter = { build: build };
})();
