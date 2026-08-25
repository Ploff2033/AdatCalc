(function () {
  var dialog = document.getElementById('employee-dialog');
  var form = document.getElementById('employee-form');
  var errorEl = document.getElementById('employee-dialog-error');
  var titleEl = document.getElementById('employee-dialog-title');
  var idInput = document.getElementById('employee-id');
  var nameInput = document.getElementById('employee-name');
  var positionInput = document.getElementById('employee-position');
  var salaryInput = document.getElementById('employee-salary');
  var draftPlantId = null; // '' (общий) или id завода — решается кнопкой "+ Добавить..."

  var configIds = ['cfg-target-output', 'cfg-utilities', 'cfg-depr-balance', 'cfg-depr-residual', 'cfg-depr-lifespan'];
  var moneyConfigIds = ['cfg-utilities', 'cfg-depr-balance', 'cfg-depr-residual'];
  var configSaveTimer = null;

  function openForCreate(plantId) {
    draftPlantId = plantId;
    titleEl.textContent = plantId ? 'Новый сотрудник завода' : 'Новый общий сотрудник';
    idInput.value = '';
    nameInput.value = '';
    positionInput.value = '';
    salaryInput.value = '';
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openForEdit(emp) {
    draftPlantId = emp.plantId;
    titleEl.textContent = 'Изменить сотрудника';
    idInput.value = emp.id;
    nameInput.value = emp.name;
    positionInput.value = emp.position;
    NumericInput.setFormattedValue(salaryInput, emp.salary);
    errorEl.hidden = true;
    dialog.showModal();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    var payload = {
      name: nameInput.value,
      position: positionInput.value,
      salary: NumericInput.parseNumber(salaryInput.value),
      plantId: draftPlantId || null
    };
    try {
      if (idInput.value) {
        await Api.put('/employees/' + idInput.value, payload);
      } else {
        await Api.post('/employees', payload);
      }
      dialog.close();
      await State.loadAll();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete(emp) {
    if (!confirm('Удалить сотрудника «' + emp.name + '»?')) return;
    try {
      await Api.del('/employees/' + emp.id);
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function buildTile(emp) {
    var tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML =
      '<div class="tile-title"></div>' +
      '<div class="tile-sub"></div>' +
      '<div class="tile-value"></div>' +
      '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="danger del-btn">Удалить</button></div>';
    tile.querySelector('.tile-title').textContent = emp.name;
    tile.querySelector('.tile-sub').textContent = emp.position;
    tile.querySelector('.tile-value').textContent = Format.fmt(emp.salary, 0) + '/мес';
    tile.querySelector('.edit-btn').addEventListener('click', function () { openForEdit(emp); });
    tile.querySelector('.del-btn').addEventListener('click', function () { handleDelete(emp); });
    return tile;
  }

  function renderEmployeeTiles() {
    var plantId = Plant.currentPlantId();
    var ownContainer = document.getElementById('employee-tiles');
    var sharedContainer = document.getElementById('shared-employee-tiles');
    ownContainer.innerHTML = '';
    sharedContainer.innerHTML = '';
    State.data.employees.forEach(function (emp) {
      if (emp.plantId === plantId) {
        ownContainer.appendChild(buildTile(emp));
      } else if (!emp.plantId) {
        sharedContainer.appendChild(buildTile(emp));
      }
    });
  }

  function setIfNotFocused(id, value) {
    var el = document.getElementById(id);
    if (document.activeElement === el) return;
    el.value = value;
  }

  function setMoneyIfNotFocused(id, value) {
    var el = document.getElementById(id);
    if (document.activeElement === el) return;
    NumericInput.setFormattedValue(el, value);
  }

  function renderConfigForm() {
    var plant = State.currentPlant();
    if (!plant) return;
    setIfNotFocused('cfg-target-output', plant.targetOutput);
    setMoneyIfNotFocused('cfg-utilities', plant.utilitiesMonthly);
    setMoneyIfNotFocused('cfg-depr-balance', plant.plantDepr.balance);
    setMoneyIfNotFocused('cfg-depr-residual', plant.plantDepr.residual);
    setIfNotFocused('cfg-depr-lifespan', plant.plantDepr.lifespanMonths);
  }

  function renderBreakdown() {
    var plant = State.currentPlant();
    var payroll = Calc.payrollPerM3(plant, State.data.plants, State.data.personnelSummary);
    var depr = Calc.plantDeprPerM3(plant);
    var util = Calc.utilitiesPerM3(plant);
    document.getElementById('out-payroll-per-m3').textContent = Format.fmt(payroll, 2);
    document.getElementById('out-depr-per-m3').textContent = Format.fmt(depr, 2);
    document.getElementById('out-utilities-per-m3').textContent = Format.fmt(util, 2);
    document.getElementById('out-overhead-per-m3').textContent = Format.fmt(payroll + depr + util, 2);
  }

  function scheduleConfigSave() {
    clearTimeout(configSaveTimer);
    configSaveTimer = setTimeout(saveConfig, 500);
  }

  async function saveConfig() {
    var plant = State.currentPlant();
    if (!plant) return;
    var payload = {
      name: plant.name,
      targetOutput: parseFloat(document.getElementById('cfg-target-output').value) || 0,
      utilitiesMonthly: NumericInput.parseNumber(document.getElementById('cfg-utilities').value) || 0,
      plantDepr: {
        balance: NumericInput.parseNumber(document.getElementById('cfg-depr-balance').value) || 0,
        residual: NumericInput.parseNumber(document.getElementById('cfg-depr-residual').value) || 0,
        lifespanMonths: parseFloat(document.getElementById('cfg-depr-lifespan').value) || 0
      }
    };
    try {
      await Api.put('/plants/' + plant.id, payload);
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить настройки: ' + err.message);
    }
  }

  function init() {
    document.getElementById('add-employee-btn').addEventListener('click', function () { openForCreate(Plant.currentPlantId()); });
    document.getElementById('add-shared-employee-btn').addEventListener('click', function () { openForCreate(''); });
    form.addEventListener('submit', handleSubmit);
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    NumericInput.attach(salaryInput);
    moneyConfigIds.forEach(function (id) {
      NumericInput.attach(document.getElementById(id));
    });
    configIds.forEach(function (id) {
      document.getElementById(id).addEventListener('input', scheduleConfigSave);
    });
  }

  function render() {
    renderEmployeeTiles();
    renderConfigForm();
    renderBreakdown();
  }

  window.PersonnelTab = { init: init, render: render };
})();
