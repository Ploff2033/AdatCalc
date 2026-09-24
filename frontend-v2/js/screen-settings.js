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
          '<div class="sec-h"><h2>Заводы · цены</h2><span class="hint">Полное редактирование заводов — в <a href="/" target="_blank" rel="noopener">прежнем интерфейсе</a></span></div>' +
          '<div id="s-plants-list" class="stack g16"></div>' +
        '</section>' +
        '<section id="s-trips" class="card sec">' +
          '<div class="sec-h"><h2>Доставка и смены</h2></div>' +
          '<div class="grid-2">' +
            '<div class="field"><label for="s-nb-surcharge">Доплата водителю за рейс в соседний город</label><div class="unit"><input id="s-nb-surcharge" class="inp num" inputmode="decimal"><span>₽/рейс</span></div></div>' +
            '<div class="field"><label for="s-driver-hours">Смена водителя</label><div class="unit"><input id="s-driver-hours" class="inp num" inputmode="decimal"><span>ч</span></div></div>' +
            '<div class="field"><label for="s-vehicle-hours">Смена машины</label><div class="unit"><input id="s-vehicle-hours" class="inp num" inputmode="decimal"><span>ч</span></div></div>' +
            '<div class="field"><label for="s-avg-speed">Средняя скорость миксера</label><div class="unit"><input id="s-avg-speed" class="inp num" inputmode="decimal"><span>км/ч</span></div></div>' +
            '<div class="field"><label for="s-unload">Время разгрузки</label><div class="unit"><input id="s-unload" class="inp num" inputmode="decimal"><span>мин</span></div></div>' +
          '</div>' +
        '</section>' +
        '<section id="s-rent" class="card sec">' +
          '<div class="sec-h"><h2>Контроль рентабельности</h2></div>' +
          '<div class="grid-2"><div class="field"><label for="s-rent-threshold">Порог рентабельности сделки</label><div class="unit"><input id="s-rent-threshold" class="inp num" inputmode="decimal"><span>%</span></div></div><div></div></div>' +
          '<p class="hint" style="margin:0">Заказы с рентабельностью ниже этого значения подсвечиваются оранжевым в списке «Заказы». 0 — подсветка выключена.</p>' +
        '</section>' +
        '<section id="s-tg" class="card sec"></section>' +
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

  function renderPlants() {
    var container = document.getElementById('s-plants-list');
    var plants = State.data.plants || [];
    container.innerHTML = plants.map(function (p) {
      return '<div class="stack g10" data-plant-id="' + p.id + '" style="padding:14px;border:1px solid var(--border-soft);border-radius:6px">' +
        '<b>' + p.name + '</b>' +
        '<div class="grid-2">' +
          '<div class="field"><label>Цена топлива</label><div class="unit"><input class="inp num s-fuel-price" inputmode="decimal"><span>₽/л</span></div></div>' +
          '<div class="field"><label>Цена мочевины (AdBlue)</label><div class="unit"><input class="inp num s-urea-price" inputmode="decimal"><span>₽/л</span></div></div>' +
        '</div>' +
      '</div>';
    }).join('') || '<p class="hint">Заводов ещё нет.</p>';
    plants.forEach(function (p) {
      var card = container.querySelector('[data-plant-id="' + p.id + '"]');
      if (!card) return;
      NumericInput.setFormattedValue(card.querySelector('.s-fuel-price'), p.fuelPrice || 0);
      NumericInput.setFormattedValue(card.querySelector('.s-urea-price'), p.ureaPrice || 0);
    });
    Array.prototype.forEach.call(container.querySelectorAll('.s-fuel-price, .s-urea-price'), function (input) {
      NumericInput.attach(input);
      input.addEventListener('input', function () {
        var plantId = input.closest('[data-plant-id]').dataset.plantId;
        pricesDirty[plantId] = true;
        markDirty('цены завода');
      });
    });
  }

  function renderTrips() {
    var c = State.data.config || {};
    var map = { 's-nb-surcharge': c.neighborCitySurcharge, 's-driver-hours': c.driverShiftHours, 's-vehicle-hours': c.vehicleShiftHours, 's-avg-speed': c.avgSpeedKmh, 's-unload': c.unloadMinutes };
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

  function renderAccess() {
    var section = document.getElementById('s-access');
    if (!Auth.isAtLeast('admin')) {
      section.innerHTML = '<div class="sec-h"><h2>Доступ</h2></div><p class="hint" style="margin:0">Ссылки доступа управляются администратором.</p>';
      return;
    }
    var cfg = State.data.config || {};
    var link = cfg.universalWorkerToken ? location.origin + '/?token=' + encodeURIComponent(cfg.universalWorkerToken) : '';
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
    renderAccess();
  }

  async function handleSave() {
    var saveBtn = document.getElementById('s-save-btn');
    saveBtn.disabled = true;
    try {
      var configBody = {
        companyRequisites: document.getElementById('s-requisites').value,
        neighborCitySurcharge: NumericInput.parseNumber(document.getElementById('s-nb-surcharge').value) || 0,
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
      await Api.put('/config', configBody);

      var plantWrites = Object.keys(pricesDirty).map(function (plantId) {
        var card = document.querySelector('[data-plant-id="' + plantId + '"]');
        return Api.put('/plants/' + plantId + '/prices', {
          fuelPrice: NumericInput.parseNumber(card.querySelector('.s-fuel-price').value) || 0,
          ureaPrice: NumericInput.parseNumber(card.querySelector('.s-urea-price').value) || 0
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
    [['s-nb-surcharge', 'доплата за город'], ['s-driver-hours', 'смена водителя'], ['s-vehicle-hours', 'смена машины'], ['s-avg-speed', 'скорость'], ['s-unload', 'разгрузка'], ['s-rent-threshold', 'порог рентабельности']].forEach(function (pair) {
      NumericInput.attach(document.getElementById(pair[0]));
      document.getElementById(pair[0]).addEventListener('input', function () { markDirty(pair[1]); });
    });

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
