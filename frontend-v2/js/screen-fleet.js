(function () {
  // Техника — миксеры и инертовозы одним экраном с переключателем типа
  // (макет Fleet.dc.html) вместо двух отдельных вкладок, как в v1. Те же
  // два API (mixers.js/aggregate-trucks.js), оба admin-write — экран виден
  // manager+, но добавление/редактирование доступно только admin (как и на
  // бэкенде), остальным — просто список для чтения.
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap">Общий парк всех заводов</span><h1>Техника</h1></div><div class="page-head-actions"><button class="btn pri sm" id="fl-add-btn" hidden>Добавить технику</button></div></div>' +
    '<div class="seg" role="group" aria-label="Тип техники" style="width:300px" id="fl-type-seg"><button type="button" data-type="mixer" class="on" aria-pressed="true">Миксеры</button><button type="button" data-type="truck" aria-pressed="false">Инертовозы</button></div>' +
    '<div class="ref-layout">' +
      '<div class="ref-main">' +
        '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
          '<div class="row head" id="fl-head" style="grid-template-columns:1.3fr 70px 110px 110px 90px 80px 110px"></div>' +
          '<div id="fl-rows"></div>' +
          '<p class="empty-state" id="fl-empty" hidden>Пока ничего нет.</p>' +
        '</section>' +
        '<p class="hint" style="margin:0">Топливо и мочевина в л/100 км, Платон и амортизация в ₽/км.</p>' +
      '</div>' +
      '<aside class="drawer" id="fl-drawer" hidden>' +
        '<div class="drawer-head"><h2 id="fl-drawer-title">Новая машина</h2><button type="button" class="btn ghost icon" id="fl-drawer-close" aria-label="Закрыть">✕</button></div>' +
        '<form id="fl-form">' +
          '<div class="drawer-body">' +
            '<div class="grid-2">' +
              '<div class="field"><label for="fl-f-name">Название</label><input id="fl-f-name" class="inp" required></div>' +
              '<div class="field" id="fl-f-plate-field"><label for="fl-f-plate">Гос. номер</label><input id="fl-f-plate" class="inp"></div>' +
            '</div>' +
            '<div class="grid-2">' +
              '<div class="field"><label for="fl-f-cap">Объём барабана / кузова</label><div class="unit"><input id="fl-f-cap" class="inp num" inputmode="decimal" value="0"><span>м³/т</span></div></div>' +
              '<div class="field" id="fl-f-odo-field"><label for="fl-f-odo">Пробег одометра</label><div class="unit"><input id="fl-f-odo" class="inp num" inputmode="decimal" value="0"><span>км</span></div></div>' +
            '</div>' +
            '<span class="cap" style="padding-top:4px">Амортизация</span>' +
            '<div class="grid-2">' +
              '<div class="field"><label for="fl-f-balance">Балансовая стоимость</label><div class="unit"><input id="fl-f-balance" class="inp num" inputmode="decimal" value="0"><span>₽</span></div></div>' +
              '<div class="field"><label for="fl-f-residual">Остаточная стоимость</label><div class="unit"><input id="fl-f-residual" class="inp num" inputmode="decimal" value="0"><span>₽</span></div></div>' +
            '</div>' +
            '<div class="field"><label for="fl-f-mileage">Ресурс до списания</label><div class="unit"><input id="fl-f-mileage" class="inp num" inputmode="decimal" value="0"><span>км</span></div></div>' +
            '<span class="cap" style="padding-top:4px">Расход и дороги</span>' +
            '<div class="grid-3">' +
              '<div class="field"><label for="fl-f-fuel">Топливо</label><div class="unit"><input id="fl-f-fuel" class="inp num" inputmode="decimal" value="0"><span>л/100</span></div></div>' +
              '<div class="field"><label for="fl-f-urea">Мочевина</label><div class="unit"><input id="fl-f-urea" class="inp num" inputmode="decimal" value="0"><span>л/100</span></div></div>' +
              '<div class="field"><label for="fl-f-platon">Платон</label><div class="unit"><input id="fl-f-platon" class="inp num" inputmode="decimal" value="0"><span>₽/км</span></div></div>' +
            '</div>' +
          '</div>' +
          '<div class="drawer-foot">' +
            '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Амортизация</span><span class="num" id="fl-preview-amort">—</span></div>' +
            '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Топливо</span><span class="num" id="fl-preview-fuel">—</span></div>' +
            '<p class="banner" id="fl-form-error" hidden></p>' +
            '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">' +
              '<button type="button" class="btn ghost" id="fl-delete-btn" style="color:#8C2217;border-color:#E3B8B1" hidden>Удалить</button>' +
              '<button type="submit" class="btn pri" id="fl-save-btn">Добавить машину</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</aside>' +
    '</div>';

  var currentType = 'mixer'; // 'mixer' | 'truck'
  var editingId = null;

  function endpoint() { return currentType === 'mixer' ? '/mixers' : '/aggregate-trucks'; }
  function items() { return currentType === 'mixer' ? (State.data.mixers || []) : (State.data.aggregateTrucks || []); }
  function isMixer() { return currentType === 'mixer'; }

  // Одометр теперь общий для обеих вкладок (раньше был только у миксеров —
  // "для инертовозов нужны все те же поля, что и для миксеров, а то одометр
  // на них нельзя настроить"), поэтому колонки у миксеров и инертовозов
  // полностью совпадают, кроме подписи первого числового столбца
  // (объём барабана у миксера vs грузоподъёмность у инертовоза — разный
  // физический смысл одного и того же поля capacity).
  var FLEET_COLS = '1.3fr 70px 110px 110px 90px 80px 110px';

  function renderHead() {
    var head = document.getElementById('fl-head');
    head.style.gridTemplateColumns = FLEET_COLS;
    head.innerHTML = '<div>Машина</div><div class="r">' + (isMixer() ? 'Объём' : 'Грузопод.') + '</div><div class="r">Топливо</div><div class="r">Мочевина</div><div class="r">Платон</div><div class="r">Аморт.</div><div class="r">Одометр</div>';
  }

  function renderTable() {
    var list = items().slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    document.getElementById('fl-empty').hidden = list.length > 0;
    var canEdit = Auth.isAtLeast('admin');
    document.getElementById('fl-rows').innerHTML = list.map(function (t) {
      var amort = Calc.amortPerKm(t);
      return '<div class="row' + (canEdit ? '' : '') + '" style="grid-template-columns:' + FLEET_COLS + ';min-height:58px' + (canEdit ? ';cursor:pointer' : '') + '" data-fleet-id="' + t.id + '">' +
        '<div class="stack" style="gap:1px"><span style="font-weight:600">' + t.name + '</span><span class="num hint">' + (t.licensePlate || '—') + '</span></div>' +
        '<div class="r num">' + Format.fmtNum(t.capacity, 1) + '</div>' +
        '<div class="r num">' + Format.fmtNum(t.fuelRate, 1) + '</div>' +
        '<div class="r num hint">' + Format.fmtNum(t.ureaRate, 1) + '</div>' +
        '<div class="r num hint">' + Format.fmtNum(t.platonRatePerKm, 2) + '</div>' +
        '<div class="r num" style="font-weight:600">' + Format.fmtNum(amort, 2) + '</div>' +
        '<div class="r num hint">' + Format.fmtNum(t.odometerBaselineKm, 0, 'км') + '</div>' +
      '</div>';
    }).join('');
    if (canEdit) {
      Array.prototype.forEach.call(document.querySelectorAll('#fl-rows [data-fleet-id]'), function (row) {
        row.addEventListener('click', function () {
          var t = items().find(function (x) { return x.id === row.dataset.fleetId; });
          if (t) openForEdit(t);
        });
      });
    }
  }

  function updatePreview() {
    var fake = {
      balance: NumericInput.parseNumber(document.getElementById('fl-f-balance').value) || 0,
      residual: NumericInput.parseNumber(document.getElementById('fl-f-residual').value) || 0,
      mileage: NumericInput.parseNumber(document.getElementById('fl-f-mileage').value) || 0
    };
    var amort = Calc.amortPerKm(fake);
    document.getElementById('fl-preview-amort').textContent = Format.fmt(amort, 2) + '/км';
    var plant = State.currentPlant();
    var fuelRate = NumericInput.parseNumber(document.getElementById('fl-f-fuel').value) || 0;
    var fuelPrice = (plant && plant.fuelPrice) || 0;
    document.getElementById('fl-preview-fuel').textContent = Format.fmt((fuelRate / 100) * fuelPrice, 2) + '/км';
  }

  function openForCreate() {
    editingId = null;
    document.getElementById('fl-drawer-title').textContent = isMixer() ? 'Новый миксер' : 'Новый инертовоз';
    document.getElementById('fl-save-btn').textContent = 'Добавить машину';
    document.getElementById('fl-delete-btn').hidden = true;
    document.getElementById('fl-form-error').hidden = true;
    // Гос. номер и одометр — теперь общие поля для обеих вкладок (см.
    // комментарий у FLEET_COLS выше).
    document.getElementById('fl-f-plate-field').hidden = false;
    document.getElementById('fl-f-odo-field').hidden = false;
    document.getElementById('fl-f-name').value = '';
    PlateInput.setValue(document.getElementById('fl-f-plate'), '');
    ['fl-f-cap', 'fl-f-odo', 'fl-f-balance', 'fl-f-residual', 'fl-f-mileage', 'fl-f-fuel', 'fl-f-urea', 'fl-f-platon'].forEach(function (id) { NumericInput.setFormattedValue(document.getElementById(id), 0); });
    updatePreview();
    document.getElementById('fl-drawer').hidden = false;
  }

  function openForEdit(t) {
    editingId = t.id;
    document.getElementById('fl-drawer-title').textContent = isMixer() ? 'Изменить миксер' : 'Изменить инертовоз';
    document.getElementById('fl-save-btn').textContent = 'Сохранить';
    document.getElementById('fl-delete-btn').hidden = false;
    document.getElementById('fl-form-error').hidden = true;
    document.getElementById('fl-f-plate-field').hidden = false;
    document.getElementById('fl-f-odo-field').hidden = false;
    document.getElementById('fl-f-name').value = t.name;
    PlateInput.setValue(document.getElementById('fl-f-plate'), t.licensePlate || '');
    NumericInput.setFormattedValue(document.getElementById('fl-f-cap'), t.capacity);
    NumericInput.setFormattedValue(document.getElementById('fl-f-odo'), t.odometerBaselineKm || 0);
    NumericInput.setFormattedValue(document.getElementById('fl-f-balance'), t.balance);
    NumericInput.setFormattedValue(document.getElementById('fl-f-residual'), t.residual);
    NumericInput.setFormattedValue(document.getElementById('fl-f-mileage'), t.mileage);
    NumericInput.setFormattedValue(document.getElementById('fl-f-fuel'), t.fuelRate);
    NumericInput.setFormattedValue(document.getElementById('fl-f-urea'), t.ureaRate);
    NumericInput.setFormattedValue(document.getElementById('fl-f-platon'), t.platonRatePerKm);
    updatePreview();
    document.getElementById('fl-drawer').hidden = false;
  }

  function closeDrawer() { document.getElementById('fl-drawer').hidden = true; }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('fl-form-error');
    errorEl.hidden = true;
    var payload = {
      name: document.getElementById('fl-f-name').value.trim(),
      capacity: NumericInput.parseNumber(document.getElementById('fl-f-cap').value) || 0,
      balance: NumericInput.parseNumber(document.getElementById('fl-f-balance').value) || 0,
      residual: NumericInput.parseNumber(document.getElementById('fl-f-residual').value) || 0,
      mileage: NumericInput.parseNumber(document.getElementById('fl-f-mileage').value) || 0,
      fuelRate: NumericInput.parseNumber(document.getElementById('fl-f-fuel').value) || 0,
      ureaRate: NumericInput.parseNumber(document.getElementById('fl-f-urea').value) || 0,
      platonRatePerKm: NumericInput.parseNumber(document.getElementById('fl-f-platon').value) || 0
    };
    payload.licensePlate = document.getElementById('fl-f-plate').value.trim();
    payload.odometerBaselineKm = NumericInput.parseNumber(document.getElementById('fl-f-odo').value) || 0;
    if (!payload.name) { errorEl.textContent = 'Укажите название.'; errorEl.hidden = false; return; }
    try {
      if (editingId) await Api.put(endpoint() + '/' + editingId, payload);
      else await Api.post(endpoint(), payload);
      await State.loadAll();
      closeDrawer();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    var t = items().find(function (x) { return x.id === editingId; });
    if (!confirm('Удалить «' + (t ? t.name : '') + '»?')) return;
    try {
      await Api.del(endpoint() + '/' + editingId);
      await State.loadAll();
      closeDrawer();
      render();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.blockingMaterials) {
        alert('Используется в доставке материалов: ' + err.data.blockingMaterials.join(', ') + '.');
      } else {
        alert(err.message);
      }
    }
  }

  function render() {
    document.getElementById('fl-add-btn').hidden = !Auth.isAtLeast('admin');
    var mixerCount = (State.data.mixers || []).length;
    var truckCount = (State.data.aggregateTrucks || []).length;
    var seg = document.getElementById('fl-type-seg');
    seg.querySelector('[data-type="mixer"]').textContent = 'Миксеры · ' + mixerCount;
    seg.querySelector('[data-type="truck"]').textContent = 'Инертовозы · ' + truckCount;
    renderHead();
    renderTable();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-fleet').innerHTML = HTML;
    document.getElementById('fl-add-btn').addEventListener('click', openForCreate);
    document.getElementById('fl-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('fl-form').addEventListener('submit', handleSubmit);
    document.getElementById('fl-delete-btn').addEventListener('click', handleDelete);
    Array.prototype.forEach.call(document.querySelectorAll('#fl-type-seg button'), function (btn) {
      btn.addEventListener('click', function () {
        currentType = btn.dataset.type;
        Array.prototype.forEach.call(document.querySelectorAll('#fl-type-seg button'), function (b) {
          b.classList.toggle('on', b === btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        closeDrawer();
        render();
      });
    });
    ['fl-f-cap', 'fl-f-odo', 'fl-f-balance', 'fl-f-residual', 'fl-f-mileage', 'fl-f-fuel', 'fl-f-urea', 'fl-f-platon'].forEach(function (id) {
      NumericInput.attach(document.getElementById(id));
      document.getElementById(id).addEventListener('input', updatePreview);
    });
    PlateInput.attach(document.getElementById('fl-f-plate'));
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.FleetScreen = { show: show };
})();
