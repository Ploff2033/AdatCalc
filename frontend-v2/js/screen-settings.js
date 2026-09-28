(function () {
  // Настройки — Организация и Доставка/смены (PUT /api/config, роль
  // manager), Заводы (цены топлива/мочевины через PUT /api/plants/:id/prices,
  // тоже manager — полный CRUD завода остаётся в прежнем интерфейсе, он
  // admin-only), Рентабельность (тоже manager — используется в подсветке
  // списка «Заказы», которую видит и менеджер) и Доступ (admin-only, как и
  // в v1). Уведомления в Telegram — сам токен виден и правится только
  // admin (handlers/config.js), как universalWorkerToken.
  var SECTIONS = [
    { id: 'org', label: 'Организация' },
    { id: 'plants', label: 'Заводы' },
    { id: 'trips', label: 'Доставка и смены' },
    { id: 'rent', label: 'Рентабельность' },
    { id: 'tg', label: 'Уведомления' },
    { id: 'access', label: 'Доступ' }
  ];

  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap">Все заводы</span><h1>Настройки</h1></div></div>' +
    '<div style="display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start" class="set-grid">' +
      '<nav class="set-nav stack" style="gap:2px;position:sticky;top:24px" aria-label="Разделы настроек">' +
        SECTIONS.map(function (s, i) { return '<a href="#s-' + s.id + '" data-sec="' + s.id + '" class="' + (i === 0 ? 'on' : '') + '">' + s.label + '</a>'; }).join('') +
      '</nav>' +
      '<div class="stack g16" style="max-width:880px">' +
        '<section id="s-org" class="card sec">' +
          '<div class="sec-h"><h2>Реквизиты организации</h2></div>' +
          '<div class="field"><label for="s-requisites">Реквизиты (свободный текст — подставляются в путевые листы)</label><textarea id="s-requisites" class="inp" style="height:120px;padding:10px 12px;resize:vertical"></textarea></div>' +
        '</section>' +
        '<section id="s-plants" class="card sec">' +
          '<div class="sec-h"><h2>Заводы</h2><button type="button" class="btn sm" id="s-plants-add-btn" hidden>Новый завод</button></div>' +
          '<div id="s-plants-body"></div>' +
        '</section>' +
        '<section id="s-trips" class="card sec">' +
          '<div class="sec-h"><h2>Доставка и смены</h2></div>' +
          '<div class="grid-2">' +
            '<div class="field"><label for="s-driver-hours">Смена водителя</label><div class="unit"><input id="s-driver-hours" class="inp num" inputmode="decimal"><span>ч</span></div></div>' +
            '<div class="field"><label for="s-vehicle-hours">Смена машины</label><div class="unit"><input id="s-vehicle-hours" class="inp num" inputmode="decimal"><span>ч</span></div></div>' +
            '<div class="field"><label for="s-avg-speed">Средняя скорость миксера</label><div class="unit"><input id="s-avg-speed" class="inp num" inputmode="decimal"><span>км/ч</span></div></div>' +
            '<div class="field"><label for="s-unload">Время разгрузки</label><div class="unit"><input id="s-unload" class="inp num" inputmode="decimal"><span>мин</span></div></div>' +
          '</div>' +
          '<p class="hint" style="margin:0">Доплата водителю за рейс в соседний город — теперь у каждого завода своя, см. раздел «Заводы» выше.</p>' +
        '</section>' +
        '<section id="s-rent" class="card sec">' +
          '<div class="sec-h"><h2>Контроль рентабельности</h2></div>' +
          '<div class="grid-2"><div class="field"><label for="s-rent-threshold">Порог рентабельности сделки</label><div class="unit"><input id="s-rent-threshold" class="inp num" inputmode="decimal"><span>%</span></div></div><div></div></div>' +
          '<p class="hint" style="margin:0">Заказы с рентабельностью ниже этого значения подсвечиваются оранжевым в списке «Заказы». 0 — подсветка выключена.</p>' +
        '</section>' +
        '<section id="s-tg" class="card sec"></section>' +
        '<section id="s-mailru" class="card sec"></section>' +
        '<section id="s-access" class="card sec"></section>' +
      '</div>' +
    '</div>' +
    '<div class="savebar" id="s-savebar" hidden><span id="s-savebar-msg"></span><div style="display:flex;gap:8px"><button class="btn ghost" id="s-cancel-btn">Отменить</button><button class="btn pri" id="s-save-btn">Сохранить</button></div></div>';

  var dirtyFields = {};
  var pricesDirty = {}; // plantId -> true

  function markDirty(label) {
    dirtyFields[label] = true;
    var bar = document.getElementById('s-savebar');
    bar.hidden = false;
    document.getElementById('s-savebar-msg').textContent = 'Изменено: ' + Object.keys(dirtyFields).join(', ');
  }

  function renderOrg() {
    var el = document.getElementById('s-requisites');
    if (document.activeElement !== el) el.value = (State.data.config && State.data.config.companyRequisites) || '';
  }

  // ---- Заводы ----
  // manager видит и правит только то, чем уже мог управлять раньше (цены
  // топлива/мочевины + теперь доплата за рейс, все через PUT
  // /api/plants/:id/prices) — тот же простой стек карточек, что был. admin
  // получает полный редактор по макету Settings.dc.html: сегмент-выбор
  // завода + все поля (название/выработка/амортизация/координаты/ссылка/
  // удаление) через полный PUT /api/plants/:id, отдельной immediate-кнопкой
  // "Сохранить завод" — не через общий savebar внизу экрана (тот заточен
  // под пачку разнородных полей всех секций сразу, а тут одна сущность со
  // своими обязательными полями и своим DELETE/POST, как в Materials/Fleet).
  var selectedPlantId = null;

  function renderPlants() {
    var addBtn = document.getElementById('s-plants-add-btn');
    if (Auth.isAtLeast('admin')) {
      addBtn.hidden = false;
      renderPlantsAdmin();
    } else {
      addBtn.hidden = true;
      renderPlantsManager();
    }
  }

  function renderPlantsManager() {
    var body = document.getElementById('s-plants-body');
    if (!body.dataset.scaffolded) {
      body.innerHTML = '<div id="s-plants-list" class="stack g16"></div>';
      body.dataset.scaffolded = 'manager';
    }
    var list = document.getElementById('s-plants-list');
    var plants = State.data.plants || [];
    list.innerHTML = plants.map(function (p) {
      return '<div class="stack g10" data-plant-id="' + p.id + '" style="padding:14px;border:1px solid var(--border-soft);border-radius:6px">' +
        '<b>' + p.name + '</b>' +
        '<div class="grid-3">' +
          '<div class="field"><label>Цена топлива</label><div class="unit"><input class="inp num s-fuel-price" inputmode="decimal"><span>₽/л</span></div></div>' +
          '<div class="field"><label>Цена мочевины (AdBlue)</label><div class="unit"><input class="inp num s-urea-price" inputmode="decimal"><span>₽/л</span></div></div>' +
          '<div class="field"><label>Доплата за рейс в другой город</label><div class="unit"><input class="inp num s-surcharge" inputmode="decimal"><span>₽/рейс</span></div></div>' +
        '</div>' +
      '</div>';
    }).join('') || '<p class="hint">Заводов ещё нет.</p>';
    plants.forEach(function (p) {
      var card = list.querySelector('[data-plant-id="' + p.id + '"]');
      if (!card) return;
      NumericInput.setFormattedValue(card.querySelector('.s-fuel-price'), p.fuelPrice || 0);
      NumericInput.setFormattedValue(card.querySelector('.s-urea-price'), p.ureaPrice || 0);
      NumericInput.setFormattedValue(card.querySelector('.s-surcharge'), p.neighborCitySurcharge || 0);
    });
    Array.prototype.forEach.call(list.querySelectorAll('.s-fuel-price, .s-urea-price, .s-surcharge'), function (input) {
      NumericInput.attach(input);
      input.addEventListener('input', function () {
        var plantId = input.closest('[data-plant-id]').dataset.plantId;
        pricesDirty[plantId] = true;
        markDirty('цены завода');
      });
    });
  }

  function renderPlantsAdmin() {
    var body = document.getElementById('s-plants-body');
    if (!body.dataset.scaffolded) {
      body.innerHTML =
        '<div class="seg" role="group" aria-label="Завод" id="s-plants-seg" style="width:auto;display:inline-flex"></div>' +
        '<div id="s-plant-editor" style="margin-top:22px"></div>';
      body.dataset.scaffolded = 'admin';
    }
    var plants = State.data.plants || [];
    var seg = document.getElementById('s-plants-seg');
    var editor = document.getElementById('s-plant-editor');
    if (!plants.length) {
      seg.innerHTML = '';
      editor.innerHTML = '<p class="hint">Заводов ещё нет — добавьте первый кнопкой «Новый завод» выше.</p>';
      editor.dataset.builtFor = '';
      return;
    }
    if (!selectedPlantId || !plants.some(function (p) { return p.id === selectedPlantId; })) {
      selectedPlantId = plants[0].id;
    }
    seg.innerHTML = plants.map(function (p) {
      return '<button type="button" data-plant-id="' + p.id + '" class="' + (p.id === selectedPlantId ? 'on' : '') + '" aria-pressed="' + (p.id === selectedPlantId) + '">' + p.name + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        selectedPlantId = btn.dataset.plantId;
        renderPlantsAdmin();
      });
    });
    // Пересобираем поля редактора только при смене выбранного завода — иначе
    // фоновый рендер (например, после сохранения ДРУГОЙ секции Настроек)
    // сбросил бы недосохранённый ввод admin'а в текущем.
    if (editor.dataset.builtFor === selectedPlantId) return;
    editor.dataset.builtFor = selectedPlantId;
    var plant = plants.find(function (p) { return p.id === selectedPlantId; });
    buildPlantEditor(editor, plant);
  }

  function buildPlantEditor(container, plant) {
    // Отдельные "категории" редактора (название/выработка, амортизация,
    // цены, координаты, ссылка, кнопки) — раньше шли впритык друг к другу
    // (сами .grid-2/.grid-3 задают только gap МЕЖДУ своими колонками, а не
    // отступ ДО следующего блока) — по отзыву пользователя добавлен общий
    // вертикальный gap между этими блоками.
    container.innerHTML =
      '<div class="stack" style="gap:26px">' +
      '<div class="grid-3">' +
        '<div class="field"><label for="sp-name">Название</label><input id="sp-name" class="inp"></div>' +
        '<div class="field"><label for="sp-output">Целевая выработка</label><div class="unit"><input id="sp-output" class="inp num" inputmode="decimal"><span>м³/мес</span></div></div>' +
        '<div class="field"><label for="sp-utilities">Коммуналка</label><div class="unit"><input id="sp-utilities" class="inp num" inputmode="decimal"><span>₽/мес</span></div></div>' +
      '</div>' +
      '<div class="stack g10">' +
        '<span class="cap">Амортизация завода</span>' +
        '<div class="grid-3">' +
          '<div class="field"><label for="sp-depr-balance">Балансовая стоимость</label><div class="unit"><input id="sp-depr-balance" class="inp num" inputmode="decimal"><span>₽</span></div></div>' +
          '<div class="field"><label for="sp-depr-residual">Остаточная стоимость</label><div class="unit"><input id="sp-depr-residual" class="inp num" inputmode="decimal"><span>₽</span></div></div>' +
          '<div class="field"><label for="sp-depr-lifespan">Срок службы</label><div class="unit"><input id="sp-depr-lifespan" class="inp num" inputmode="decimal"><span>мес</span></div></div>' +
        '</div>' +
        '<div class="spread" style="padding:10px 14px;border-radius:4px;background:var(--surface-3)"><span>В себестоимости 1 м³</span><span class="num" id="sp-depr-preview" style="font-weight:600">—</span></div>' +
      '</div>' +
      '<div class="grid-3">' +
        '<div class="field"><label for="sp-fuel">Цена топлива</label><div class="unit"><input id="sp-fuel" class="inp num" inputmode="decimal"><span>₽/л</span></div></div>' +
        '<div class="field"><label for="sp-urea">Цена мочевины (AdBlue)</label><div class="unit"><input id="sp-urea" class="inp num" inputmode="decimal"><span>₽/л</span></div></div>' +
        '<div class="field"><label for="sp-surcharge">Доплата за рейс в другой город</label><div class="unit"><input id="sp-surcharge" class="inp num" inputmode="decimal"><span>₽/рейс</span></div></div>' +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="sp-lat">Широта</label><input id="sp-lat" class="inp num" inputmode="decimal"></div>' +
        '<div class="field"><label for="sp-lng">Долгота</label><input id="sp-lng" class="inp num" inputmode="decimal"></div>' +
      '</div>' +
      '<div class="field"><label>Ссылка для работников завода</label>' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px">' +
          '<input id="sp-link" class="inp num" readonly style="background:var(--surface-3);color:var(--muted)">' +
          '<button type="button" class="btn ghost sm" id="sp-link-copy" style="height:40px">Копировать</button>' +
          '<button type="button" class="btn ghost sm" id="sp-link-reissue" style="height:40px">Перевыпустить</button>' +
        '</div>' +
      '</div>' +
      '<p class="banner" id="sp-error" hidden></p>' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<button type="button" class="btn ghost sm" id="sp-delete-btn" style="color:#8C2217;border-color:#E3B8B1">Удалить завод</button>' +
        '<button type="button" class="btn pri" id="sp-save-btn">Сохранить завод</button>' +
      '</div>' +
      '</div>';

    document.getElementById('sp-name').value = plant.name;
    NumericInput.attach(document.getElementById('sp-output'));
    NumericInput.setFormattedValue(document.getElementById('sp-output'), plant.targetOutput);
    NumericInput.attach(document.getElementById('sp-utilities'));
    NumericInput.setFormattedValue(document.getElementById('sp-utilities'), plant.utilitiesMonthly);
    NumericInput.attach(document.getElementById('sp-depr-balance'));
    NumericInput.setFormattedValue(document.getElementById('sp-depr-balance'), plant.plantDepr.balance);
    NumericInput.attach(document.getElementById('sp-depr-residual'));
    NumericInput.setFormattedValue(document.getElementById('sp-depr-residual'), plant.plantDepr.residual);
    NumericInput.attach(document.getElementById('sp-depr-lifespan'));
    NumericInput.setFormattedValue(document.getElementById('sp-depr-lifespan'), plant.plantDepr.lifespanMonths);
    NumericInput.attach(document.getElementById('sp-fuel'));
    NumericInput.setFormattedValue(document.getElementById('sp-fuel'), plant.fuelPrice);
    NumericInput.attach(document.getElementById('sp-urea'));
    NumericInput.setFormattedValue(document.getElementById('sp-urea'), plant.ureaPrice);
    NumericInput.attach(document.getElementById('sp-surcharge'));
    NumericInput.setFormattedValue(document.getElementById('sp-surcharge'), plant.neighborCitySurcharge);
    NumericInput.attach(document.getElementById('sp-lat'));
    NumericInput.attach(document.getElementById('sp-lng'));
    if (plant.plantLocation) {
      NumericInput.setFormattedValue(document.getElementById('sp-lat'), plant.plantLocation.lat);
      NumericInput.setFormattedValue(document.getElementById('sp-lng'), plant.plantLocation.lng);
    }
    // С 25.09.2026 — на v2, не на корень (модуль ДДС, см. app.js).
    document.getElementById('sp-link').value = plant.accessToken ? (location.origin + '/v2/?token=' + encodeURIComponent(plant.accessToken)) : '';

    function updateDeprPreview() {
      var fake = {
        plantDepr: {
          balance: NumericInput.parseNumber(document.getElementById('sp-depr-balance').value) || 0,
          residual: NumericInput.parseNumber(document.getElementById('sp-depr-residual').value) || 0,
          lifespanMonths: NumericInput.parseNumber(document.getElementById('sp-depr-lifespan').value) || 0
        },
        targetOutput: NumericInput.parseNumber(document.getElementById('sp-output').value) || 0
      };
      document.getElementById('sp-depr-preview').textContent = Format.fmt(Calc.plantDeprPerM3(fake), 2) + '/м³';
    }
    ['sp-depr-balance', 'sp-depr-residual', 'sp-depr-lifespan', 'sp-output'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', updateDeprPreview);
    });
    updateDeprPreview();

    document.getElementById('sp-save-btn').addEventListener('click', function () { savePlant(plant.id); });
    document.getElementById('sp-delete-btn').addEventListener('click', function () { deletePlant(plant); });
    document.getElementById('sp-link-copy').addEventListener('click', function (e) {
      var link = document.getElementById('sp-link').value;
      if (!link) return;
      navigator.clipboard.writeText(link).then(function () {
        e.target.textContent = 'Скопировано!';
        setTimeout(function () { e.target.textContent = 'Копировать'; }, 2000);
      }).catch(function () { window.prompt('Скопируйте ссылку (Ctrl+C):', link); });
    });
    document.getElementById('sp-link-reissue').addEventListener('click', function () {
      if (!confirm('Перевыпустить ссылку для «' + plant.name + '»? Старая перестанет работать немедленно.')) return;
      Api.post('/plants/' + plant.id + '/reissue-token', {}).then(function () { return State.loadAll(); })
        .then(function () { forceRebuildPlantEditor(); render(); })
        .catch(function (err) { alert(err.message); });
    });
  }

  function forceRebuildPlantEditor() {
    var editor = document.getElementById('s-plant-editor');
    if (editor) editor.dataset.builtFor = '';
  }

  async function savePlant(id) {
    var errorEl = document.getElementById('sp-error');
    errorEl.hidden = true;
    var name = document.getElementById('sp-name').value.trim();
    if (!name) { errorEl.textContent = 'Укажите название завода.'; errorEl.hidden = false; return; }
    var latRaw = document.getElementById('sp-lat').value;
    var lngRaw = document.getElementById('sp-lng').value;
    var lat = NumericInput.parseNumber(latRaw);
    var lng = NumericInput.parseNumber(lngRaw);
    var payload = {
      name: name,
      targetOutput: NumericInput.parseNumber(document.getElementById('sp-output').value) || 0,
      utilitiesMonthly: NumericInput.parseNumber(document.getElementById('sp-utilities').value) || 0,
      plantDepr: {
        balance: NumericInput.parseNumber(document.getElementById('sp-depr-balance').value) || 0,
        residual: NumericInput.parseNumber(document.getElementById('sp-depr-residual').value) || 0,
        lifespanMonths: NumericInput.parseNumber(document.getElementById('sp-depr-lifespan').value) || 0
      },
      fuelPrice: NumericInput.parseNumber(document.getElementById('sp-fuel').value) || 0,
      ureaPrice: NumericInput.parseNumber(document.getElementById('sp-urea').value) || 0,
      neighborCitySurcharge: NumericInput.parseNumber(document.getElementById('sp-surcharge').value) || 0,
      plantLocation: (isFinite(lat) && isFinite(lng)) ? { lat: lat, lng: lng } : null
    };
    var btn = document.getElementById('sp-save-btn');
    btn.disabled = true;
    try {
      await Api.put('/plants/' + id, payload);
      await State.loadAll();
      forceRebuildPlantEditor();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function deletePlant(plant) {
    if (!confirm('Удалить завод «' + plant.name + '»? Нужно, чтобы на нём не осталось материалов, рецептов и сотрудников.')) return;
    try {
      await Api.del('/plants/' + plant.id);
      selectedPlantId = null;
      await State.loadAll();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  async function createPlant() {
    try {
      var created = await Api.post('/plants', { name: 'Новый завод' });
      selectedPlantId = created.id;
      await State.loadAll();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderTrips() {
    var c = State.data.config || {};
    var map = { 's-driver-hours': c.driverShiftHours, 's-vehicle-hours': c.vehicleShiftHours, 's-avg-speed': c.avgSpeedKmh, 's-unload': c.unloadMinutes };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (document.activeElement !== el) NumericInput.setFormattedValue(el, map[id] || 0);
    });
  }

  function renderRent() {
    var el = document.getElementById('s-rent-threshold');
    if (document.activeElement !== el) NumericInput.setFormattedValue(el, (State.data.config && State.data.config.rentabilityThresholdPercent) || 0);
  }

  function renderTelegram() {
    var section = document.getElementById('s-tg');
    if (!Auth.isAtLeast('admin')) {
      section.innerHTML = '<div class="sec-h"><h2>Уведомления в Telegram</h2></div><p class="hint" style="margin:0">Токен бота настраивается администратором.</p>';
      return;
    }
    var cfg = State.data.config || {};
    // Перерисовываем секцию целиком только если в полях сейчас не печатают —
    // иначе, как и с s-plants-list, потерялся бы фокус/курсор на каждый
    // фоновый State.onChange.
    if (section.contains(document.activeElement) && section.dataset.built) return;
    section.dataset.built = '1';
    section.innerHTML =
      '<div class="sec-h"><h2>Уведомления в Telegram</h2><button type="button" class="btn ghost sm" id="s-tg-test">Отправить тестовое</button></div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="s-tg-token">Токен бота</label><input id="s-tg-token" class="inp num" value="' + (cfg.telegramBotToken || '') + '"></div>' +
        '<div class="field"><label for="s-tg-chat">ID чата</label><input id="s-tg-chat" class="inp num" value="' + (cfg.telegramChatId || '') + '"></div>' +
      '</div>' +
      '<p class="hint" style="margin:0">Присылает: новый заказ, дефицит материала, материал ниже порога — сейчас все три вместе, отдельных переключателей пока нет.</p>';
    document.getElementById('s-tg-token').addEventListener('input', function () { markDirty('Telegram-токен'); });
    document.getElementById('s-tg-chat').addEventListener('input', function () { markDirty('Telegram chat id'); });
    document.getElementById('s-tg-test').addEventListener('click', async function (e) {
      var btn = e.target;
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Отправка…';
      try {
        // Сохраняет токен/chat id заодно (можно проверить до основного
        // "Сохранить") и по-настоящему ждёт ответа Telegram — см.
        // POST /api/config/telegram-test в router.js.
        await Api.post('/config/telegram-test', {
          telegramBotToken: document.getElementById('s-tg-token').value.trim(),
          telegramChatId: document.getElementById('s-tg-chat').value.trim()
        });
        await State.loadAll();
        dirtyFields = {};
        document.getElementById('s-savebar').hidden = true;
        btn.textContent = 'Отправлено — проверьте чат';
        setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2500);
      } catch (err) {
        alert(err.message);
        btn.textContent = original;
        btn.disabled = false;
      }
    });
  }

  // Автосинхронизация ДДС в Облако Mail.ru — по просьбе пользователя
  // ("чтобы данные отображались в облачной таблице", "это конфиденциальные
  // данные, могу ли я просто ввести их в админке"): логин/пароль вводятся
  // тут же, никогда не через чат. Тот же приём, что и renderTelegram() —
  // секрет виден и правится только admin (см. handlers/config.js).
  function renderMailru() {
    var section = document.getElementById('s-mailru');
    if (!Auth.isAtLeast('admin')) {
      section.innerHTML = '<div class="sec-h"><h2>Облако Mail.ru (ДДС)</h2></div><p class="hint" style="margin:0">Настраивается администратором.</p>';
      return;
    }
    var cfg = State.data.config || {};
    var plants = State.data.plants || [];
    if (section.contains(document.activeElement) && section.dataset.built) return;
    section.dataset.built = '1';
    section.innerHTML =
      '<div class="sec-h"><h2>Облако Mail.ru (ДДС)</h2><button type="button" class="btn ghost sm" id="s-mailru-test">Проверить синхронизацию</button></div>' +
      '<div class="grid-2">' +
        '<div class="field"><label for="s-mailru-login">Логин Mail.ru</label><input id="s-mailru-login" class="inp num" value="' + (cfg.mailruLogin || '') + '" autocomplete="off"></div>' +
        '<div class="field"><label for="s-mailru-password">Пароль для внешних приложений</label><input id="s-mailru-password" type="password" class="inp num" value="' + (cfg.mailruAppPassword || '') + '" autocomplete="off"></div>' +
      '</div>' +
      '<div class="field"><label for="s-mailru-plant">Завод для проверки</label><select id="s-mailru-plant" class="inp">' +
        plants.map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('') +
      '</select></div>' +
      '<p class="hint" style="margin:0">При каждой записи ДДС файл «ДДС — &lt;завод&gt;.xlsx» сам перезаписывается в папке «ДДС» вашего Облака Mail.ru — открывать/скачивать вручную не нужно. Пароль — НЕ обычный пароль от почты: отдельный «пароль для внешних приложений» (в настройках почты — Безопасность → Пароли для внешних приложений).</p>';
    document.getElementById('s-mailru-login').addEventListener('input', function () { markDirty('Логин Mail.ru'); });
    document.getElementById('s-mailru-password').addEventListener('input', function () { markDirty('Пароль Mail.ru'); });
    document.getElementById('s-mailru-test').addEventListener('click', async function (e) {
      var btn = e.target;
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Проверка…';
      try {
        // Сохраняет логин/пароль заодно (можно проверить до основного
        // "Сохранить") и по-настоящему ждёт загрузки в Облако — см.
        // POST /api/config/mailru-test в router.js.
        await Api.post('/config/mailru-test', {
          mailruLogin: document.getElementById('s-mailru-login').value.trim(),
          mailruAppPassword: document.getElementById('s-mailru-password').value.trim(),
          plantId: document.getElementById('s-mailru-plant').value
        });
        await State.loadAll();
        dirtyFields = {};
        document.getElementById('s-savebar').hidden = true;
        btn.textContent = 'Загружено — проверьте Облако';
        setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2500);
      } catch (err) {
        alert(err.message);
        btn.textContent = original;
        btn.disabled = false;
      }
    });
  }

  function renderAccess() {
    var section = document.getElementById('s-access');
    if (!Auth.isAtLeast('admin')) {
      section.innerHTML = '<div class="sec-h"><h2>Доступ</h2></div><p class="hint" style="margin:0">Ссылки доступа управляются администратором.</p>';
      return;
    }
    var cfg = State.data.config || {};
    var link = cfg.universalWorkerToken ? location.origin + '/v2/?token=' + encodeURIComponent(cfg.universalWorkerToken) : '';
    section.innerHTML =
      '<div class="sec-h"><h2>Доступ</h2></div>' +
      '<div class="field"><label>Общая ссылка · все заводы (переключатель завода для работника-подмены)</label>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px">' +
      '<input class="inp num" value="' + link + '" readonly style="background:var(--surface-3);color:var(--muted)">' +
      '<button type="button" class="btn ghost sm" id="s-copy-link" style="height:40px">Копировать</button>' +
      '<button type="button" class="btn ghost sm" id="s-reissue-link" style="height:40px">Перевыпустить</button>' +
      '</div></div>';
    document.getElementById('s-copy-link').addEventListener('click', async function (e) {
      try { await navigator.clipboard.writeText(link); e.target.textContent = 'Скопировано!'; setTimeout(function () { e.target.textContent = 'Копировать'; }, 2000); }
      catch (err) { window.prompt('Скопируйте ссылку (Ctrl+C):', link); }
    });
    document.getElementById('s-reissue-link').addEventListener('click', async function () {
      if (!confirm('Перевыпустить общую ссылку? Старая перестанет работать немедленно.')) return;
      try { await Api.post('/config/reissue-universal-token', {}); await State.loadAll(); render(); }
      catch (err) { alert(err.message); }
    });
  }

  function render() {
    renderOrg();
    renderPlants();
    renderTrips();
    renderRent();
    renderTelegram();
    renderMailru();
    renderAccess();
  }

  async function handleSave() {
    var saveBtn = document.getElementById('s-save-btn');
    saveBtn.disabled = true;
    try {
      var configBody = {
        companyRequisites: document.getElementById('s-requisites').value,
        driverShiftHours: NumericInput.parseNumber(document.getElementById('s-driver-hours').value) || 0,
        vehicleShiftHours: NumericInput.parseNumber(document.getElementById('s-vehicle-hours').value) || 0,
        avgSpeedKmh: NumericInput.parseNumber(document.getElementById('s-avg-speed').value) || 0,
        unloadMinutes: NumericInput.parseNumber(document.getElementById('s-unload').value) || 0,
        rentabilityThresholdPercent: NumericInput.parseNumber(document.getElementById('s-rent-threshold').value) || 0
      };
      // Поля Telegram есть в DOM только у admin (см. renderTelegram) — если
      // их нет, просто не отправляем (менеджерский PUT их и так проигнорирует
      // на бэкенде, но незачем слать undefined).
      var tgTokenEl = document.getElementById('s-tg-token');
      if (tgTokenEl) {
        configBody.telegramBotToken = tgTokenEl.value.trim();
        configBody.telegramChatId = document.getElementById('s-tg-chat').value.trim();
      }
      // Поля Mail.ru — тоже только у admin (см. renderMailru), тот же приём.
      var mailruLoginEl = document.getElementById('s-mailru-login');
      if (mailruLoginEl) {
        configBody.mailruLogin = mailruLoginEl.value.trim();
        configBody.mailruAppPassword = document.getElementById('s-mailru-password').value.trim();
      }
      await Api.put('/config', configBody);

      var plantWrites = Object.keys(pricesDirty).map(function (plantId) {
        var card = document.querySelector('[data-plant-id="' + plantId + '"]');
        return Api.put('/plants/' + plantId + '/prices', {
          fuelPrice: NumericInput.parseNumber(card.querySelector('.s-fuel-price').value) || 0,
          ureaPrice: NumericInput.parseNumber(card.querySelector('.s-urea-price').value) || 0,
          neighborCitySurcharge: NumericInput.parseNumber(card.querySelector('.s-surcharge').value) || 0
        });
      });
      await Promise.all(plantWrites);

      await State.loadAll();
      dirtyFields = {};
      pricesDirty = {};
      document.getElementById('s-savebar').hidden = true;
      render();
    } catch (err) {
      alert('Не удалось сохранить: ' + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  var initialized = false;
  function init() {
    document.getElementById('page-settings').innerHTML = HTML;

    ['s-requisites'].forEach(function (id) { document.getElementById(id).addEventListener('input', function () { markDirty('реквизиты'); }); });
    [['s-driver-hours', 'смена водителя'], ['s-vehicle-hours', 'смена машины'], ['s-avg-speed', 'скорость'], ['s-unload', 'разгрузка'], ['s-rent-threshold', 'порог рентабельности']].forEach(function (pair) {
      NumericInput.attach(document.getElementById(pair[0]));
      document.getElementById(pair[0]).addEventListener('input', function () { markDirty(pair[1]); });
    });

    document.getElementById('s-plants-add-btn').addEventListener('click', createPlant);
    document.getElementById('s-save-btn').addEventListener('click', handleSave);
    document.getElementById('s-cancel-btn').addEventListener('click', function () {
      dirtyFields = {};
      pricesDirty = {};
      document.getElementById('s-savebar').hidden = true;
      render();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.set-nav a'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        Array.prototype.forEach.call(document.querySelectorAll('.set-nav a'), function (x) { x.classList.remove('on'); });
        a.classList.add('on');
        document.getElementById('s-' + a.dataset.sec).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    initialized = true;
  }

  function show() { if (!initialized) init(); render(); }

  window.SettingsScreen = { show: show };
})();
