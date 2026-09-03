(function () {
  var dialog = document.getElementById('plant-dialog');
  var form = document.getElementById('plant-form');
  var errorEl = document.getElementById('plant-dialog-error');
  var titleEl = document.getElementById('plant-dialog-title');
  var idInput = document.getElementById('plant-id');
  var nameInput = document.getElementById('plant-name');
  var submitBtn = document.getElementById('plant-form-submit');

  function plantLink(plant) {
    return location.origin + location.pathname + '?token=' + encodeURIComponent(plant.accessToken);
  }

  async function copyPlantLink(plant, btn) {
    var url = plantLink(plant);
    var originalText = btn.textContent;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Скопировано!';
      setTimeout(function () { btn.textContent = originalText; }, 2000);
    } catch (err) {
      // Clipboard API недоступен без HTTPS (пока сайт на голом HTTP) — запасной
      // способ: показываем ссылку в диалоге, откуда можно скопировать вручную.
      window.prompt('Скопируйте ссылку (Ctrl+C):', url);
    }
  }

  // Генерирует новый токен — старая ссылка перестаёт работать немедленно —
  // и сразу копирует новую (та же реакция, что у обычной кнопки "Ссылка").
  async function reissuePlantLink(plant, btn) {
    if (!confirm('Перевыпустить ссылку для «' + plant.name + '»? Старая ссылка перестанет работать немедленно.')) return;
    try {
      var updated = await Api.post('/plants/' + plant.id + '/reissue-token', {});
      await State.loadAll();
      await copyPlantLink(updated, btn);
    } catch (err) {
      alert(err.message);
    }
  }

  function openForCreate() {
    titleEl.textContent = 'Новый завод';
    idInput.value = '';
    nameInput.value = '';
    submitBtn.textContent = 'Создать';
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openForEdit(plant) {
    titleEl.textContent = 'Изменить завод';
    idInput.value = plant.id;
    nameInput.value = plant.name;
    submitBtn.textContent = 'Сохранить';
    errorEl.hidden = true;
    dialog.showModal();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    try {
      if (idInput.value) {
        await Api.put('/plants/' + idInput.value, { name: nameInput.value });
      } else {
        var created = await Api.post('/plants', { name: nameInput.value });
        Plant.setCurrent(created.id);
      }
      dialog.close();
      await State.loadAll();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete(plant) {
    if (!confirm('Удалить завод «' + plant.name + '»?')) return;
    try {
      await Api.del('/plants/' + plant.id);
      if (Plant.currentPlantId() === plant.id) {
        var remaining = State.data.plants.find(function (p) { return p.id !== plant.id; });
        if (remaining) Plant.setCurrent(remaining.id);
      }
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderPlantTiles() {
    var container = document.getElementById('dashboard-plant-tiles');
    container.innerHTML = '';
    State.data.plants.forEach(function (plant) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML =
        '<div class="tile-title"></div>' +
        '<div class="tile-meta"></div>' +
        '<div class="tile-meta tile-meta-access"></div>' +
        '<div class="tile-actions">' +
          '<button type="button" class="edit-btn">Изменить</button>' +
          '<button type="button" class="link-btn">Ссылка для работника</button>' +
          '<button type="button" class="reissue-btn">Перевыпустить ссылку</button>' +
          '<button type="button" class="danger del-btn">Удалить</button>' +
        '</div>';
      tile.querySelector('.tile-title').textContent = plant.name;
      tile.querySelector('.tile-meta').textContent =
        Format.fmtNum(plant.targetOutput, 0, 'м³/мес') + ' · амортизация ' + Format.fmt(Calc.plantDeprMonthly(plant), 0) + '/мес';
      tile.querySelector('.tile-meta-access').textContent = plant.tokenLastUsedAt
        ? 'Посл. доступ по ссылке: ' + new Date(plant.tokenLastUsedAt).toLocaleString('ru-RU') + (plant.tokenLastUsedIp ? ' (' + plant.tokenLastUsedIp + ')' : '')
        : 'Ссылка ещё не использовалась';
      tile.querySelector('.edit-btn').addEventListener('click', function () { openForEdit(plant); });
      tile.querySelector('.link-btn').addEventListener('click', function (e) { copyPlantLink(plant, e.target); });
      tile.querySelector('.reissue-btn').addEventListener('click', function (e) { reissuePlantLink(plant, e.target); });
      tile.querySelector('.del-btn').addEventListener('click', function () { handleDelete(plant); });
      container.appendChild(tile);
    });
  }

  function renderSummary() {
    var plants = State.data.plants;
    var orders = State.data.orders || [];
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };

    var totalDepr = plants.reduce(function (sum, p) { return sum + Calc.plantDeprMonthly(p); }, 0);
    var totalOutput = plants.reduce(function (sum, p) { return sum + (p.targetOutput || 0); }, 0);
    var totalPayroll = plants.reduce(function (sum, p) { return sum + ((summary.byPlant && summary.byPlant[p.id]) || 0); }, 0) + (summary.sharedTotal || 0);
    var totalProfit = orders.reduce(function (sum, o) { return sum + (o.totalProfit || 0); }, 0);
    var totalRevenue = orders.reduce(function (sum, o) { return sum + (o.totalRevenue || 0); }, 0);

    document.getElementById('dash-total-depr').textContent = Format.fmt(totalDepr, 0);
    document.getElementById('dash-total-payroll').textContent = Format.fmt(totalPayroll, 0);
    document.getElementById('dash-total-output').textContent = Format.fmtNum(totalOutput, 0, 'м³/мес');
    document.getElementById('dash-orders-count').textContent = Format.fmtNum(orders.length, 0, '');

    var profitEl = document.getElementById('dash-total-profit');
    var profitWrap = document.getElementById('dash-total-profit-wrap');
    profitEl.textContent = Format.fmt(totalProfit, 0);
    profitWrap.classList.remove('positive', 'negative');
    profitWrap.classList.add(totalProfit >= 0 ? 'positive' : 'negative');

    document.getElementById('dash-total-revenue').textContent = Format.fmt(totalRevenue, 0);
  }

  function universalTokenLink(token) {
    return location.origin + location.pathname + '?token=' + encodeURIComponent(token);
  }

  async function copyLink(url, btn) {
    var originalText = btn.textContent;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Скопировано!';
      setTimeout(function () { btn.textContent = originalText; }, 2000);
    } catch (err) {
      window.prompt('Скопируйте ссылку (Ctrl+C):', url);
    }
  }

  async function reissueUniversalToken(btn) {
    if (!confirm('Перевыпустить общую ссылку подмены? Старая перестанет работать немедленно у всех, кто ей пользовался.')) return;
    try {
      await Api.post('/config/reissue-universal-token', {});
      await State.loadAll();
      var token = State.data.config.universalWorkerToken;
      if (token) await copyLink(universalTokenLink(token), btn);
    } catch (err) {
      alert(err.message);
    }
  }

  function renderUniversalToken() {
    var config = State.data.config;
    var token = config && config.universalWorkerToken;
    document.getElementById('universal-token-meta').textContent = config && config.universalTokenLastUsedAt
      ? 'Посл. доступ по ссылке: ' + new Date(config.universalTokenLastUsedAt).toLocaleString('ru-RU') + (config.universalTokenLastUsedIp ? ' (' + config.universalTokenLastUsedIp + ')' : '')
      : 'Ссылка ещё не использовалась';
    document.getElementById('universal-token-copy-btn').onclick = function (e) {
      if (token) copyLink(universalTokenLink(token), e.target);
    };
  }

  function renderPlantTable() {
    var tbody = document.getElementById('dash-plant-table-body');
    tbody.innerHTML = '';
    var orders = State.data.orders || [];
    State.data.plants.forEach(function (plant) {
      var plantOrders = orders.filter(function (o) { return o.plantId === plant.id; });
      var profit = plantOrders.reduce(function (sum, o) { return sum + (o.totalProfit || 0); }, 0);

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td></td><td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = plant.name;
      cells[1].textContent = Format.fmtNum(plant.targetOutput, 0, 'м³');
      cells[2].textContent = Format.fmt(Calc.plantDeprMonthly(plant), 0);
      cells[3].textContent = Format.fmt(plant.utilitiesMonthly || 0, 0);
      cells[4].textContent = Format.fmtNum(plantOrders.length, 0, '');
      cells[5].textContent = Format.fmt(profit, 0);
      cells[5].classList.add(profit >= 0 ? 'positive' : 'negative');
      tbody.appendChild(tr);
    });
  }

  // Начало текущего календарного месяца (локальное время браузера — этот
  // раздел только для admin, точность до часового пояса тут не критична).
  function monthStartMs() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }

  function renderBreakevenTable() {
    var tbody = document.getElementById('dash-breakeven-table-body');
    tbody.innerHTML = '';
    var plants = State.data.plants;
    var orders = State.data.orders || [];
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };
    var monthStart = monthStartMs();

    plants.forEach(function (plant) {
      var fixedCosts = Calc.fixedCostsMonthly(plant, plants, summary);
      var contribution = orders
        .filter(function (o) { return o.plantId === plant.id && new Date(o.createdAt).getTime() >= monthStart; })
        .reduce(function (sum, o) { return sum + Calc.orderContribution(o); }, 0);
      var coveredPercent = fixedCosts > 0 ? (contribution / fixedCosts) * 100 : (contribution > 0 ? 100 : 0);
      var realProfit = contribution - fixedCosts;

      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
      var cells = tr.querySelectorAll('td');
      cells[0].textContent = plant.name;
      cells[1].textContent = Format.fmt(fixedCosts, 0);
      cells[2].textContent = Format.fmt(contribution, 0);
      cells[3].textContent = Format.fmtNum(Math.max(0, coveredPercent), 0, '%');
      cells[3].classList.add(coveredPercent >= 100 ? 'positive' : 'negative');
      cells[4].textContent = Format.fmt(realProfit, 0);
      cells[4].classList.add(realProfit >= 0 ? 'positive' : 'negative');
      tbody.appendChild(tr);
    });
  }

  function init() {
    document.getElementById('add-plant-btn').addEventListener('click', openForCreate);
    form.addEventListener('submit', handleSubmit);
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    document.getElementById('universal-token-reissue-btn').addEventListener('click', function (e) {
      reissueUniversalToken(e.target);
    });
  }

  function render() {
    if (!window.Auth || !Auth.isAtLeast('admin')) return;
    renderPlantTiles();
    renderSummary();
    renderPlantTable();
    renderBreakevenTable();
    renderUniversalToken();
  }

  window.DashboardTab = { init: init, render: render };
})();
