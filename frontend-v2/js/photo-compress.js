(function () {
  // Сжимает фото чека на клиенте перед отправкой (canvas resize + JPEG
  // reencode) — родная фотография с телефона легко весит несколько
  // мегабайт, а на заводах "нестабильный интернет" (см. документ ДДС) —
  // 1200px по длинной стороне при качестве 0.72 обычно укладывается в
  // 100-300КБ, чего с запасом хватает, чтобы прочитать сумму/поставщика на
  // чеке. Бэкенд (backend/uploads.js) всё равно проверяет размер ещё раз
  // после декодирования — это не единственная защита, а разгрузка сети.
  function fromFile(file, maxDim, quality) {
    maxDim = maxDim || 1280;
    quality = quality || 0.72;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Не удалось прочитать файл')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Не удалось прочитать изображение')); };
        img.onload = function () {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          try {
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (err) {
            reject(err);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.PhotoCompress = { fromFile: fromFile };
})();
