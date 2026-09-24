(function () {
  // Остатки — реальные данные (Фаза 2). Материалы уже приходят
  // отфильтрованными по текущему заводу в State.data.materials (см.
  // state.js — Api.get(withPlantFilter('/materials'))), как и на всех
  // остальных экранах v2/v1; движения — отдельный запрос (State.loadAll()
  // их не тянет, лог может расти без ограничения полезности для расчётов).
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap">Склад завода</span><h1>Остатки материалов</h1></div>' +
      '<div class="page-head-actions"><button class="btn ghost sm" id="s-adjust-btn">Корректировка</button><button class="btn pri sm" id="s-receipt-btn">Приход материала</button></div>' +
    '</div>' +
    '<section class="card stack g12" id="s-form-panel" style="padding:16px 20px" hidden>' +
      '<div class="spread"><h2 id="s-form-title" style="font-size:16px;font-weight:600"></h2><button type="button" class="btn ghost icon" id="s-form-close" aria-label="Закрыть">✕</button></div>' +
      '<form id="s-form" class="stack g12">' +
        '<div class="grid-3">' +
          '<div class="field"><label for="s-form-material">Материал</label><select id="s-form-material" class="inp"></select></div>' +
          '<div class="field"><label for="s-form-qty" id="s-form-qty-label">Количество</label><input id="s-form-qty" class="inp num" inputmode="decimal"></div>' +
          '<div class="field"><label for="s-form-note">Комментарий</label><input id="s-form-note" class="inp"></div>' +
        '</div>' +
        '<p class="hint" id="s-form-hint" style="margin:0"></p>' +
        '<p class="banner" id="s-form-error" hidden></p>' +
        '<button class="btn pri" type="submit" style="align-self:flex-start">Сохранить</button>' +
      '</form>' +
    '</section>' +
    '<div class="banner" id="s-deficit-banner" hidden></div>' +
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;flex:1;min-height:0" class="stock-grid">' +
      '<section class="card" style="overflow:hidden;display:flex;flex-direction:column;align-self:start">' +
        '<div class="row head" style="grid-template-columns:1.6fr 1fr 1fr 1fr 0.8fr 1.5fr"><div>Материал</div><div class="r">На складе</div><div class="r">В брони</div><div class="r">Доступно</div><div class="r">Порог</div><div>Запас</div></div>' +
        '<div id="s-rows"></div>' +
        '<p class="empty-state" id="s-empty" hidden>Материалов на этом заводе нет.</p>' +
      '</section>' +
      '<section class="card" style="display:flex;flex-direction:column;overflow:hidden">' +
        '<div class="spread" style="padding:16px 18px;border-bottom:1px solid var(--border-soft)"><h2 style="font-size:17px;font-weight:600">Движение</h2><select class="inp" id="s-log-filter" style="width:150px;height:32px" aria-label="Материал"></select></div>' +
        '<div id="s-log"></div>' +
        '<p class="empty-state" id="s-log-empty" hidden>Движений ещё нет.</p>' +
      '</section>' +
    '</div>';

  var KIND_LABEL = { reserve: 'Бронь', release: 'Снятие брони', writeoff: 'Списание', receipt: 'Приход', adjustment: 'Корректировка' };
  var logFilterValue = '';
  var formKind = null; // 'receipt' | 'adjustment' | null

  function currentMaterials() {
    return State.data.materials || [];
  }

  function renderTable() {
    var materials = currentMaterials();
    var rows = document.getElementById('s-rows');
    document.getElementById('s-empty').hidden = materials.length > 0;
    var deficitNames = [];
    var warnNames = [];

    rows.innerHTML = materials.map(function (m) {
      // Материал без учёта остатка (вода, газ по трубе...) — считать
      // нечего, бэкенд для него и не пишет движения (см.
      // handlers/stock.js::adjustMaterial), просто показываем "∞" и не
      // тянем его в баннер дефицита.
      if (m.stockUnlimited) {
        return '<div class="row" style="grid-template-columns:1.6fr 1fr 1fr 1fr 0.8fr 1.5fr;min-height:56px">' +
          '<div class="stack"><span style="font-weight:500">' + m.name + '</span><span class="hint">' + m.unit + '</span></div>' +
          '<div class="r num hint">∞</div>' +
          '<div class="r num hint">∞</div>' +
          '<div class="r num hint">∞</div>' +
          '<div class="r num hint">—</div>' +
          '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"></div><span class="chip mute">Не учитывается</span></div>' +
        '</div>';
      }
      var avail = m.stockOnHand - m.stockReserved;
      var pct = m.stockOnHand > 0 ? Math.max(0, Math.min(100, Math.round((avail / m.stockOnHand) * 100))) : 0;
      var cls, label, color, barColor;
      if (avail < 0) { cls = 'bad'; label = 'Дефицит'; color = '#8C2217'; barColor = '#A62A1E'; deficitNames.push(m.name); }
      else if (avail < m.stockThreshold) { cls = 'warn'; label = 'Ниже порога'; color = '#6E4700'; barColor = '#8A5A00'; warnNames.push(m.name); }
      else { cls = 'ok'; label = 'Норма'; color = '#1C1D1B'; barColor = '#1C1D1B'; }
      return '<div class="row" style="grid-template-columns:1.6fr 1fr 1fr 1fr 0.8fr 1.5fr;min-height:56px">' +
        '<div class="stack"><span style="font-weight:500">' + m.name + '</span><span class="hint">' + m.unit + '</span></div>' +
        '<div class="r num">' + Format.fmtNum(m.stockOnHand, 2) + '</div>' +
        '<div class="r num hint">' + Format.fmtNum(m.stockReserved, 2) + '</div>' +
        '<div class="r num" style="font-weight:600;color:' + color + '">' + Format.fmtNum(avail, 2) + '</div>' +
        '<div class="r num hint">' + Format.fmtNum(m.stockThreshold, 2) + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1"><span style="width:' + pct + '%;background:' + barColor + '"></span></div><span class="chip ' + cls + '">' + label + '</span></div>' +
      '</div>';
    }).join('');

    var banner = document.getElementById('s-deficit-banner');
    if (deficitNames.length || warnNames.length) {
      banner.hidden = false;
      var parts = [];
      if (deficitNames.length) parts.push('бронь превышает остаток: <b>' + deficitNames.join(', ') + '</b>');
      if (warnNames.length) parts.push('ниже порога: <b>' + warnNames.join(', ') + '</b>');
      banner.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg><span>' + parts.join(' · ') + '.</span>';
    } else {
      banner.hidden = true;
    }
  }

  function renderLogFilter() {
    var select = document.getElementById('s-log-filter');
    var prev = logFilterValue;
    select.innerHTML = '<option value="">Все материалы</option>' + currentMaterials().map(function (m) {
      return '<option value="' + m.id + '">' + m.name + '</option>';
    }).join('');
    select.value = currentMaterials().some(function (m) { return m.id === prev; }) ? prev : '';
    logFilterValue = select.value;
  }

  async function loadLog() {
    var plantId = Plant.currentPlantId();
    var qs = '?plantId=' + encodeURIComponent(plantId) + (logFilterValue ? '&materialId=' + encodeURIComponent(logFilterValue) : '');
    var entries;
    try {
      entries = await Api.get('/stock-movements' + qs);
    } catch (err) {
      entries = [];
    }
    var log = document.getElementById('s-log');
    document.getElementById('s-log-empty').hidden = entries.length > 0;
    log.innerHTML = entries.map(function (e) {
      var sign = e.qty > 0 ? '+' : (e.qty < 0 ? '' : '±');
      var color = e.qty > 0 ? '#1F5239' : (e.qty < 0 ? '#8C2217' : '#1C1D1B');
      var when = new Date(e.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<div style="padding:12px 18px;border-bottom:1px solid var(--border-soft);display:grid;grid-template-columns:1fr auto;gap:2px 10px">' +
        '<span style="font-weight:500;font-size:13px">' + KIND_LABEL[e.kind] + (e.orderId ? ' · заказ' : '') + '</span>' +
        '<span class="num" style="font-size:13px;font-weight:600;color:' + color + '">' + sign + Format.fmtNum(e.qty, 2, e.unit) + '</span>' +
        '<span class="hint">' + e.materialName + ' · ' + when + (e.note ? ' · ' + e.note : '') + '</span>' +
        '<span class="hint num">' + Format.fmtNum(e.onHandAfter, 0) + '/' + Format.fmtNum(e.reservedAfter, 0) + '</span>' +
      '</div>';
    }).join('');
  }

  function render() {
    renderTable();
    renderLogFilter();
    loadLog();
  }

  function openForm(kind) {
    formKind = kind;
    var panel = document.getElementById('s-form-panel');
    var select = document.getElementById('s-form-material');
    // Материалы без учёта остатка сюда не попадают — приход/корректировка
    // для них физически ничего не меняют (см. handlers/stock.js), только
    // сбивали бы с толку видимостью действия без эффекта.
    select.innerHTML = currentMaterials().filter(function (m) { return !m.stockUnlimited; })
      .map(function (m) { return '<option value="' + m.id + '">' + m.name + ' (' + m.unit + ')</option>'; }).join('');
    document.getElementById('s-form-title').textContent = kind === 'receipt' ? 'Приход материала' : 'Корректировка остатка';
    document.getElementById('s-form-qty-label').textContent = kind === 'receipt' ? 'Количество' : 'Изменение (может быть отрицательным)';
    document.getElementById('s-form-hint').textContent = kind === 'receipt'
      ? 'Увеличивает остаток на складе — привезли инертовозом.'
      : 'По итогам инвентаризации — можно и в минус, бронь не трогает.';
    NumericInput.setFormattedValue(document.getElementById('s-form-qty'), '');
    document.getElementById('s-form-note').value = '';
    document.getElementById('s-form-error').hidden = true;
    panel.hidden = false;
  }

  function closeForm() {
    document.getElementById('s-form-panel').hidden = true;
    formKind = null;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('s-form-error');
    errorEl.hidden = true;
    var materialId = document.getElementById('s-form-material').value;
    var qty = NumericInput.parseNumber(document.getElementById('s-form-qty').value);
    var note = document.getElementById('s-form-note').value.trim();
    if (!materialId || !qty) {
      errorEl.textContent = 'Выберите материал и укажите ненулевое количество.';
      errorEl.hidden = false;
      return;
    }
    if (formKind === 'receipt' && qty <= 0) {
      errorEl.textContent = 'Приход должен быть положительным числом.';
      errorEl.hidden = false;
      return;
    }
    try {
      await Api.post('/materials/' + materialId + '/stock', { kind: formKind, qty: qty, note: note || undefined });
      await State.loadAll();
      closeForm();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  var initialized = false;
  function init() {
    document.getElementById('page-stock').innerHTML = HTML;
    document.getElementById('s-receipt-btn').addEventListener('click', function () { openForm('receipt'); });
    document.getElementById('s-adjust-btn').addEventListener('click', function () { openForm('adjustment'); });
    document.getElementById('s-form-close').addEventListener('click', closeForm);
    document.getElementById('s-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('s-log-filter').addEventListener('change', function () { logFilterValue = this.value; loadLog(); });
    NumericInput.attach(document.getElementById('s-form-qty'));
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.StockScreen = { show: show };
})();
