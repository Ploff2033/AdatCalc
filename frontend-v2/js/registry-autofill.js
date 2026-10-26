(function () {
  // Автозаполнение заявки реестра оплат из файла счёта (change
  // reestr-autofill; спека payment-registry/autofill, design §2 и §5;
  // макеты PaymentsReview / PaymentsReviewStates).
  //
  // Всё распознавание — в браузере admin: сервер не нагружается (на VPS
  // 1 ГБ RAM), содержимое счёта уходит на сервер только при «Создать и
  // дальше» — тем же API, что и ручной ввод. Порядок источников: QR-код
  // оплаты (ГОСТ Р 56042) → текстовый слой PDF → OCR (tesseract.js).
  // Библиотеки из frontend-v2/vendor/ грузятся лениво — при первом броске.
  //
  // Сохранённых «черновиков» нет: пачка живёт только в памяти этой вкладки.
  var R = window.Registry;
  var esc = R.esc;

  var MAX_BATCH = 20;
  var MAX_PDF_BYTES = 10 * 1024 * 1024;
  var MAX_PAGES = 2;
  var PDF_SCALE = 2; // ≈ 200 dpi для A4 — достаточно и для QR, и для OCR
  var MAX_IMAGE_SIDE = 2400;
  var MIN_TEXT_LAYER = 80; // значимых символов — меньше считаем сканом
  var PREFIX = 'ra';

  var STATUS_TEXT = {
    queued: 'в очереди',
    recognizing: 'распознаётся…',
    ready: 'готов к проверке',
    creating: 'создаётся…',
    created: 'создан',
    error: 'ошибка'
  };

  var batch = [];
  var currentId = null;
  var seq = 0;
  var running = false;
  var libsPromise = null;
  var workerPromise = null;
  var dicts = { units: [], categories: [] };
  var zoom = 1; // 1 = по ширине области просмотра
  var onDone = null; // колбэк экрана реестра — перезагрузить список
  var libsLoading = false;

  // ---------- библиотеки (design §1) ----------

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (!libsPromise) {
      libsLoading = true;
      render();
      libsPromise = Promise.all([
        window.pdfjsLib ? null : loadScript('/v2/vendor/pdfjs/pdf.min.js'),
        window.jsQR ? null : loadScript('/v2/vendor/jsqr/jsQR.js'),
        window.Tesseract ? null : loadScript('/v2/vendor/tesseract/tesseract.min.js'),
        window.InvoiceParse ? null : loadScript('/v2/js/invoice-parse.js')
      ]).then(function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/v2/vendor/pdfjs/pdf.worker.min.js';
        // Прогрев воркера сразу — к первому скану он уже готов.
        ensureWorker();
      }).catch(function (err) {
        libsPromise = null;
        throw err;
      }).finally(function () {
        libsLoading = false;
      });
    }
    return libsPromise;
  }

  // Один воркер на всю пачку: файлы идут строго по очереди (design §2).
  function ensureWorker() {
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker(['rus', 'eng'], 1, {
        workerPath: '/v2/vendor/tesseract/worker.min.js',
        corePath: '/v2/vendor/tesseract/core/',
        langPath: '/v2/vendor/tesseract/lang',
        gzip: true
      }).catch(function (err) {
        workerPromise = null;
        throw err;
      });
    }
    return workerPromise;
  }

  // ---------- конвейер одного файла (design §2) ----------

  function kindOf(file) {
    var name = (file.name || '').toLowerCase();
    if (file.type === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf';
    if (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/.test(name)) return 'image';
    return null;
  }

  // Строки текстового слоя: элементы pdf.js группируются по высоте (y) и
  // идут слева направо — так «Итого: 95 450,00» остаётся одной строкой.
  function textFromContent(content) {
    var rows = [];
    content.items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = it.transform[5];
      var x = it.transform[4];
      var row = rows.find(function (r) { return Math.abs(r.y - y) < 3; });
      if (!row) { row = { y: y, items: [] }; rows.push(row); }
      row.items.push({ x: x, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      return r.items.sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; }).join(' ');
    }).join('\n');
  }

  async function renderPdf(file) {
    var data = new Uint8Array(await file.arrayBuffer());
    var pdf = await window.pdfjsLib.getDocument({ data: data }).promise;
    var count = Math.min(MAX_PAGES, pdf.numPages);
    var canvases = [];
    var text = '';
    for (var n = 1; n <= count; n++) {
      var page = await pdf.getPage(n);
      text += textFromContent(await page.getTextContent()) + '\n';
      var viewport = page.getViewport({ scale: PDF_SCALE });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      canvases.push(canvas);
    }
    pdf.destroy();
    return { canvases: canvases, text: text, pageCount: pdf.numPages };
  }

  async function renderImage(file) {
    var url = URL.createObjectURL(file);
    try {
      var img = await new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(new Error('Не удалось прочитать изображение')); };
        im.src = url;
      });
      // Небольшие фото и скриншоты (~900px, ≈110 dpi) увеличиваем: OCR
      // заметно точнее около 300 dpi; большие — уменьшаем до того же размера.
      var scale = Math.min(3, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { canvases: [canvas], text: '', pageCount: 1 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function decodeQrOn(canvas, x, y, w, h) {
    var data = canvas.getContext('2d').getImageData(x, y, w, h);
    var code = window.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!code || !code.binaryData || !code.binaryData.length) return null;
    return window.InvoiceParse.parseQr(window.InvoiceParse.decodeQrBytes(new Uint8Array(code.binaryData)));
  }

  // QR ищем всегда — дёшево, а это самый точный источник суммы и ИНН.
  // Сначала весь лист, потом четверти: мелкий QR в углу на целом листе
  // jsQR иногда не находит.
  function findQr(canvases) {
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      var found = decodeQrOn(c, 0, 0, c.width, c.height);
      if (found) return found;
      var hw = Math.floor(c.width / 2);
      var hh = Math.floor(c.height / 2);
      var quads = [[hw, 0], [0, 0], [0, hh], [hw, hh]];
      for (var q = 0; q < quads.length; q++) {
        found = decodeQrOn(c, quads[q][0], quads[q][1], hw, hh);
        if (found) return found;
      }
    }
    return null;
  }

  async function ocr(canvases) {
    var worker = await ensureWorker();
    var text = '';
    for (var i = 0; i < canvases.length; i++) {
      var res = await worker.recognize(canvases[i]);
      text += res.data.text + '\n';
    }
    return text;
  }

  // canvas → JPEG blob URL для просмотра; сам canvas освобождаем, иначе
  // пачка из 20 двухстраничных сканов держала бы в памяти сотни МБ.
  function toPreview(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        canvas.width = 0;
        canvas.height = 0;
        resolve(blob ? URL.createObjectURL(blob) : null);
      }, 'image/jpeg', 0.88);
    });
  }

  async function recognize(item) {
    var kind = kindOf(item.file);
    var rendered = kind === 'pdf' ? await renderPdf(item.file) : await renderImage(item.file);
    var qr = findQr(rendered.canvases);
    var pdfText = rendered.text;
    var pdfParsed = window.InvoiceParse.meaningfulChars(pdfText) >= MIN_TEXT_LAYER ? window.InvoiceParse.parseText(pdfText) : null;
    var ocrParsed = null;
    var ocrText = '';
    if (!pdfParsed) {
      ocrText = await ocr(rendered.canvases);
      ocrParsed = window.InvoiceParse.parseText(ocrText);
    }
    item.result = window.InvoiceParse.merge({ qr: qr, pdf: pdfParsed, ocr: ocrParsed });
    // Отладочный след — какие источники сработали (задача 4.2, проверка на образцах).
    item.debug = { qr: Boolean(qr), pdfText: Boolean(pdfParsed), ocr: Boolean(ocrParsed), ocrChars: ocrText.length, text: ocrText || pdfText };
    item.pageCount = rendered.pageCount;
    item.pages = [];
    for (var i = 0; i < rendered.canvases.length; i++) item.pages.push(await toPreview(rendered.canvases[i]));
    var f = item.result.fields;
    item.lookup = { defaults: null, duplicates: [] };
    if (f.recipientInn) {
      try {
        item.lookup = await R.api.get('/lookup?inn=' + encodeURIComponent(f.recipientInn) + '&invoiceNumber=' + encodeURIComponent(f.invoiceNumber || ''));
      } catch (err) { /* без подстановки — не критично */ }
    }
    item.values = initialValues(item);
  }

  function initialValues(item) {
    var f = item.result.fields;
    var d = item.lookup.defaults || {};
    return {
      recipient: f.recipient || '',
      recipientInn: f.recipientInn || '',
      amount: f.amount,
      basis: f.basis || '',
      purpose: f.purpose || '',
      dueDate: f.dueDate || '',
      unitId: d.unitId || '',
      categoryId: d.categoryId || '',
      applicant: d.applicant || ''
    };
  }

  // ---------- очередь пачки ----------

  async function runQueue() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        var item = batch.find(function (x) { return x.status === 'queued'; });
        if (!item) break;
        item.status = 'recognizing';
        render();
        try {
          await ensureLibs();
          await recognize(item);
          if (item.removed) continue;
          item.status = 'ready';
        } catch (err) {
          item.status = 'error';
          item.error = 'не удалось распознать: ' + err.message;
        }
        render(); // render() сам откроет первый готовый, если текущего нет
      }
    } finally {
      running = false;
      render();
    }
  }

  function current() {
    return batch.find(function (x) { return x.id === currentId; }) || null;
  }

  // Несозданные и ещё загружающие файл: пока они есть, экран не закрывается
  // сам и просит подтверждение при закрытии. Загрузка файла после «Создать»
  // тоже здесь — иначе экран закрывался и перезагружал список раньше, чем
  // файл долетал (баг: заявка в списке без счёта, особенно у JPEG — их
  // сначала сжимаем).
  function pending() {
    return batch.filter(function (x) { return x.status === 'queued' || x.status === 'recognizing' || x.status === 'ready' || x.status === 'creating' || x.uploading; });
  }

  // files — File[]; принимаем до 20 за раз (спека «Больше 20 файлов»).
  function add(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var notice = '';
    if (list.length > MAX_BATCH) {
      notice = 'За раз принимается не больше ' + MAX_BATCH + ' файлов — взяты первые ' + MAX_BATCH + '.';
      list = list.slice(0, MAX_BATCH);
    }
    list.forEach(function (file) {
      var item = { id: 'f' + (++seq), file: file, name: file.name || 'файл', status: 'queued', error: '' };
      var kind = kindOf(file);
      if (!kind) { item.status = 'error'; item.error = 'не PDF и не фото'; }
      else if (kind === 'pdf' && file.size > MAX_PDF_BYTES) { item.status = 'error'; item.error = 'PDF больше 10 МБ'; }
      item.kind = kind;
      batch.push(item);
    });
    openOverlay();
    if (notice) flash(notice);
    render();
    runQueue();
  }

  // ---------- экран проверки (design §5) ----------

  function overlay() { return document.getElementById('ra-overlay'); }

  function openOverlay() {
    if (overlay()) return;
    var el = document.createElement('div');
    el.id = 'ra-overlay';
    el.className = 'ra-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Проверка счетов');
    el.innerHTML =
      '<header class="ra-strip"><span class="ra-strip-title">Проверка счетов</span><div class="ra-tiles" id="ra-tiles"></div>' +
        '<span class="ra-counter" id="ra-counter"></span>' +
        '<button type="button" class="btn ghost icon" id="ra-close" aria-label="Закрыть">✕</button></header>' +
      '<p class="banner ok ra-flash" id="ra-flash" hidden></p>' +
      '<div class="ra-main">' +
        '<section class="ra-viewer"><div class="ra-viewer-bar">' +
          '<button type="button" class="btn ghost sm" id="ra-zoom-out" aria-label="Уменьшить">−</button>' +
          '<span class="num" id="ra-zoom-val">100%</span>' +
          '<button type="button" class="btn ghost sm" id="ra-zoom-in" aria-label="Увеличить">+</button>' +
          '<button type="button" class="btn ghost sm" id="ra-zoom-fit">По ширине</button>' +
          '<span class="hint" id="ra-page-info"></span></div>' +
          '<div class="ra-pages" id="ra-pages"></div></section>' +
        '<aside class="ra-form" id="ra-form"></aside>' +
      '</div>';
    document.body.appendChild(el);
    document.body.classList.add('rg-noscroll');
    el.querySelector('#ra-close').addEventListener('click', requestClose);
    el.querySelector('#ra-zoom-in').addEventListener('click', function () { setZoom(zoom + 0.25); });
    el.querySelector('#ra-zoom-out').addEventListener('click', function () { setZoom(zoom - 0.25); });
    el.querySelector('#ra-zoom-fit').addEventListener('click', function () { setZoom(1); });
    el.querySelector('#ra-pages').addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });
    el.querySelector('#ra-pages').addEventListener('scroll', updatePageInfo);
    el.querySelector('#ra-tiles').addEventListener('click', onTileClick);
    el.querySelector('#ra-form').addEventListener('click', onFormClick);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Свежие справочники — значения могли поменяться в Настройках.
    Promise.all([R.api.get('/units'), R.api.get('/categories')]).then(function (res) {
      dicts.units = res[0];
      dicts.categories = res[1];
      renderForm(true);
    }).catch(function () {});
  }

  function onBeforeUnload(e) {
    if (!pending().length) return;
    e.preventDefault();
    e.returnValue = '';
  }

  function closeOverlay() {
    var el = overlay();
    if (!el) return;
    batch.forEach(releaseItem);
    batch = [];
    currentId = null;
    el.remove();
    document.body.classList.remove('rg-noscroll');
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (onDone) onDone();
  }

  function requestClose() {
    var left = pending().length;
    if (left && !confirm('Несозданные счета (' + left + ') пропадут — в реестр попадут только созданные. Закрыть?')) return;
    closeOverlay();
  }

  function releaseItem(item) {
    (item.pages || []).forEach(function (u) { if (u) URL.revokeObjectURL(u); });
    item.pages = [];
  }

  function flash(text) {
    var el = document.getElementById('ra-flash');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { el.hidden = true; }, 6000);
  }

  function setZoom(z) {
    zoom = Math.max(0.5, Math.min(3, Math.round(z * 100) / 100));
    document.getElementById('ra-zoom-val').textContent = Math.round(zoom * 100) + '%';
    Array.prototype.forEach.call(document.querySelectorAll('#ra-pages img'), function (img) {
      img.style.width = (zoom * 100) + '%';
    });
  }

  function updatePageInfo() {
    var item = current();
    var el = document.getElementById('ra-page-info');
    if (!el || !overlay()) return;
    if (!item || !item.pages || !item.pages.length) { el.textContent = ''; return; }
    var box = document.getElementById('ra-pages');
    var top = box.getBoundingClientRect().top + box.clientHeight / 2;
    var idx = 0;
    Array.prototype.forEach.call(box.querySelectorAll('img'), function (img, i) {
      if (img.getBoundingClientRect().top < top) idx = i;
    });
    var shown = item.pageCount > item.pages.length ? ' (разобраны первые ' + item.pages.length + ')' : '';
    el.textContent = 'Стр. ' + (idx + 1) + ' из ' + item.pageCount + shown;
  }

  function tileHtml(item) {
    var cls = 'ra-tile ' + item.status + (item.id === currentId ? ' on' : '');
    var thumb = item.pages && item.pages[0]
      ? '<img src="' + esc(item.pages[0]) + '" alt="">'
      : '<span>' + (item.kind === 'pdf' ? 'PDF' : item.kind === 'image' ? 'IMG' : esc(((item.name.split('.').pop()) || '?').toUpperCase().slice(0, 4))) + '</span>';
    var status = item.status === 'error' ? 'ошибка · ' + item.error : STATUS_TEXT[item.status];
    if (item.status === 'recognizing' && libsLoading) status = 'загружаем распознаватель…';
    if (item.uploading) status = 'загружаем файл…';
    if (item.uploadError) status = 'ошибка загрузки файла';
    return '<div class="' + cls + '" data-id="' + item.id + '">' +
      '<button type="button" class="ra-tile-main" data-act="open" data-id="' + item.id + '"' + (item.status === 'ready' ? '' : ' tabindex="-1"') + '>' +
        '<span class="ra-tile-thumb">' + thumb + '</span>' +
        '<span class="ra-tile-text"><span class="rg-ellipsis ra-tile-name">' + esc(item.name) + '</span><span class="ra-tile-status">' + esc(status) + '</span></span>' +
      '</button>' +
      (item.uploadError ? '<button type="button" class="btn ghost sm" data-act="retry" data-id="' + item.id + '">Повторить</button>' : '') +
      (item.status === 'error' ? '<button type="button" class="btn ghost icon ra-tile-x" data-act="drop" data-id="' + item.id + '" aria-label="Убрать ' + esc(item.name) + '">✕</button>' : '') +
    '</div>';
  }

  function render() {
    if (!overlay()) return;
    document.getElementById('ra-tiles').innerHTML = batch.map(tileHtml).join('');
    var created = batch.filter(function (x) { return x.status === 'created'; }).length;
    document.getElementById('ra-counter').innerHTML = 'Создано <b>' + created + '</b> из ' + batch.length;
    // Текущий не готов — переходим к первому готовому.
    var cur = current();
    if (!cur || (cur.status !== 'ready' && cur.status !== 'creating')) {
      var next = batch.find(function (x) { return x.status === 'ready'; });
      if (next && next.id !== currentId) { currentId = next.id; renderViewer(); renderForm(true); return; }
    }
    renderViewer();
    renderForm(false);
    maybeFinish();
  }

  var viewerFor = null;
  function renderViewer() {
    if (!overlay()) return;
    var item = current();
    var box = document.getElementById('ra-pages');
    var key = item && item.status !== 'recognizing' ? item.id : null;
    if (viewerFor === key && box.childElementCount) return;
    viewerFor = key;
    if (!item || !item.pages || !item.pages.length) {
      box.innerHTML = '<p class="ra-wait">' + (item && item.status === 'error' ? esc(item.error) : '') + '</p>';
      updatePageInfo();
      return;
    }
    box.innerHTML = item.pages.map(function (u, i) {
      return u ? '<img src="' + esc(u) + '" alt="Счёт, страница ' + (i + 1) + '" style="width:' + (zoom * 100) + '%">' : '';
    }).join('');
    box.scrollTop = 0;
    Array.prototype.forEach.call(box.querySelectorAll('img'), function (img) { img.addEventListener('load', updatePageInfo, { once: true }); });
    updatePageInfo();
  }

  var FLAG_KEYS = { recipient: 'recipient', recipientInn: 'inn', amountKop: 'amount', invoiceNumber: 'basis', purpose: 'purpose', basis: 'basis' };

  function formNotes(item) {
    var notes = {};
    var flagged = {};
    Object.keys(item.result.flags).forEach(function (k) {
      var fk = FLAG_KEYS[k];
      var fl = item.result.flags[k];
      if (!fk || item.result.empty) return;
      if (fl.kind === 'conflict') {
        flagged[fk] = true;
        notes[fk] = '<span class="ra-note warn">QR: ' + esc(fl.qr) + ' · текст: ' + esc(fl.text) + '</span>';
      } else if (fl.kind === 'ocr_only') {
        flagged[fk] = true;
        notes[fk] = '<span class="ra-note">проверьте по счёту</span>';
      } else if (fl.kind === 'missing') {
        flagged[fk] = true;
        notes[fk] = '<span class="ra-note">не найдено в счёте</span>';
      }
    });
    var d = item.lookup.defaults;
    if (d) {
      if (d.unitId) notes.unit = '<span class="ra-note muted">как в прошлой заявке</span>';
      if (d.categoryId) notes.category = '<span class="ra-note muted">как в прошлой заявке</span>';
      if (d.applicant) notes.applicant = '<span class="ra-note muted">как в прошлой заявке</span>';
    }
    return { notes: notes, flagged: flagged };
  }

  var formFor = null;
  function renderForm(force) {
    var item = current();
    var box = document.getElementById('ra-form');
    if (!box) return;
    var key = item ? item.id + ':' + item.status : 'none';
    if (!force && formFor === key) return;
    // Уходим с файла — сохраняем введённое, чтобы не потерять правки.
    if (formFor && formFor.split(':')[0] !== (item && item.id)) saveValues(formFor.split(':')[0]);
    formFor = key;
    if (!item || (item.status !== 'ready' && item.status !== 'creating')) {
      var waiting = batch.some(function (x) { return x.status === 'queued' || x.status === 'recognizing'; });
      box.innerHTML = '<div class="ra-wait"><span class="ra-spinner" aria-hidden="true"></span>' +
        (libsLoading ? 'Загружаем распознаватель…' : waiting ? 'Распознаём следующий счёт…' : 'Готовых к проверке счетов нет.') + '</div>';
      return;
    }
    var nf = formNotes(item);
    var banners = '';
    if (item.result.empty) banners += '<p class="banner ra-banner info">Не удалось распознать — заполните по счёту</p>';
    var dup = item.lookup.duplicates || [];
    if (dup.length) {
      banners += '<p class="banner ra-banner warn">Этот счёт уже заведён: ' + dup.map(function (x) {
        return '<a href="#/registry/' + esc(encodeURIComponent(x.number)) + '" target="_blank" rel="noopener">' + esc(x.number) + '</a>';
      }).join(', ') + '</p>';
    }
    if (item.result.notOurBuyer) banners += '<p class="banner ra-banner">Счёт выставлен не на АДАТ ГРУПП</p>';
    box.innerHTML =
      '<form id="ra-form-el" class="ra-form-body" novalidate>' +
        (item.result.empty ? banners : '') +
        R.formHtml(item.values, dicts, { prefix: PREFIX, column: true, notes: nf.notes, flagged: nf.flagged }) +
        (item.result.empty ? '' : banners) +
        '<p class="banner" id="ra-error" hidden></p>' +
      '</form>' +
      '<div class="ra-actions">' +
        '<button type="button" class="btn pri" data-act="create"' + (item.status === 'creating' ? ' disabled' : '') + '>' + (item.status === 'creating' ? 'Создаём…' : 'Создать и дальше') + '</button>' +
        '<button type="button" class="btn ghost" data-act="remove"' + (item.status === 'creating' ? ' disabled' : '') + '>Убрать</button>' +
      '</div>';
    R.bindForm(item.values, PREFIX);
  }

  function saveValues(id) {
    var item = batch.find(function (x) { return x.id === id; });
    if (!item || !item.values || !document.getElementById(PREFIX + '-recipient')) return;
    var v = R.readForm(PREFIX);
    v.amount = NumericInput.parseNumber(v.amount);
    if (!isFinite(v.amount)) v.amount = null;
    item.values = v;
  }

  function onTileClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var item = batch.find(function (x) { return x.id === btn.dataset.id; });
    if (!item) return;
    if (btn.dataset.act === 'retry') { uploadFile(item); return; }
    if (btn.dataset.act === 'drop') { removeItem(item); return; }
    if (item.status !== 'ready' || item.id === currentId) return;
    saveValues(currentId);
    currentId = item.id;
    renderViewer();
    renderForm(true);
    render();
  }

  function onFormClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var item = current();
    if (!item) return;
    if (btn.dataset.act === 'create') createCurrent(item);
    else if (btn.dataset.act === 'remove') removeItem(item);
  }

  function nextReady(after) {
    var idx = batch.indexOf(after);
    var rest = batch.slice(idx + 1).concat(batch.slice(0, idx));
    return rest.find(function (x) { return x.status === 'ready'; }) || null;
  }

  function goNext(from) {
    if (!overlay()) return;
    var next = nextReady(from);
    currentId = next ? next.id : null;
    viewerFor = null;
    renderViewer();
    renderForm(true);
    render();
  }

  function removeItem(item) {
    item.removed = true;
    releaseItem(item);
    var next = nextReady(item);
    batch = batch.filter(function (x) { return x !== item; });
    currentId = next ? next.id : null;
    viewerFor = null;
    renderViewer();
    renderForm(true);
    render();
  }

  async function createCurrent(item) {
    var body = R.readForm(PREFIX);
    saveValues(item.id);
    item.status = 'creating';
    renderForm(true);
    try {
      var created = await R.api.post('/requests', body);
      item.createdId = created.id;
      item.createdNumber = created.number;
      item.status = 'created';
    } catch (err) {
      item.status = 'ready';
      renderForm(true);
      var el = document.getElementById('ra-error');
      if (el) { el.textContent = err.message; el.hidden = false; }
      return;
    }
    // Следующий счёт открываем сразу, файл догружается в фоне — экран
    // при этом не закроется, пока загрузка не закончится (см. pending()).
    item.uploading = true; // до goNext: иначе maybeFinish() закрыл бы экран раньше загрузки
    goNext(item);
    await uploadFile(item);
  }

  // Файл — к уже созданной заявке; сбой загрузки не откатывает заявку
  // (тот же приём, что в форме «Новая заявка»): «Повторить» в полоске.
  async function uploadFile(item) {
    item.uploadError = false;
    item.uploading = true;
    render();
    try {
      var prepared = await R.prepareUpload(item.file);
      await R.api.upload('/requests/' + encodeURIComponent(item.createdId) + '/files', prepared.blob, { kind: 'invoice', name: prepared.name });
    } catch (err) {
      item.uploadError = true;
      flash('Заявка ' + item.createdNumber + ' создана, но файл не загрузился: ' + err.message);
    } finally {
      item.uploading = false;
    }
    render();
  }

  // Пачка закончилась: всё создано, убрано или с ошибкой распознавания
  // (такие файлы не создать — только убрать). Ошибки загрузки держат экран
  // открытым — у них есть «Повторить».
  function maybeFinish() {
    if (!batch.length) { closeOverlay(); return; }
    if (pending().length) return;
    if (batch.some(function (x) { return x.uploadError; })) return;
    if (batch.some(function (x) { return x.status === 'error'; })) return;
    closeOverlay();
  }

  window.RegistryAutofill = {
    add: add,
    isOpen: function () { return Boolean(overlay()); },
    onDone: function (fn) { onDone = fn; },
    ensureLibs: ensureLibs,
    // для отладки и сквозного теста: результат распознавания файлов пачки
    debugState: function () {
      return batch.map(function (x) { return { name: x.name, status: x.status, error: x.error, fields: x.result && x.result.fields, flags: x.result && x.result.flags, debug: x.debug, lookup: x.lookup }; });
    }
  };
})();
