(function () {
  // ---- Mixers ----
  var dialog = document.getElementById('mixer-dialog');
  var form = document.getElementById('mixer-form');
  var errorEl = document.getElementById('mixer-dialog-error');
  var titleEl = document.getElementById('mixer-dialog-title');
  var idInput = document.getElementById('mixer-id');
  var nameInput = document.getElementById('mixer-name');
  var capacityInput = document.getElementById('mixer-capacity');
  var balanceInput = document.getElementById('mixer-balance');
  var residualInput = document.getElementById('mixer-residual');
  var mileageInput = document.getElementById('mixer-mileage');
  var fuelRateInput = document.getElementById('mixer-fuel-rate');

  function openForCreate() {
    titleEl.textContent = 'Новый миксер';
    idInput.value = '';
    nameInput.value = '';
    capacityInput.value = '';
    balanceInput.value = '';
    residualInput.value = '';
    mileageInput.value = '';
    fuelRateInput.value = '';
    errorEl.hidden = true;
    dialog.showModal();
  }

  function fillMixerForm(mixer, duplicate) {
    titleEl.textContent = duplicate ? 'Копия миксера' : 'Изменить миксер';
    idInput.value = duplicate ? '' : mixer.id;
    nameInput.value = duplicate ? (mixer.name + ' (копия)') : mixer.name;
    capacityInput.value = mixer.capacity;
    NumericInput.setFormattedValue(balanceInput, mixer.balance);
    NumericInput.setFormattedValue(residualInput, mixer.residual);
    mileageInput.value = mixer.mileage;
    fuelRateInput.value = mixer.fuelRate;
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openForEdit(mixer) { fillMixerForm(mixer, false); }
  function openForDuplicate(mixer) { fillMixerForm(mixer, true); }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    var payload = {
      name: nameInput.value,
      capacity: parseFloat(capacityInput.value),
      balance: NumericInput.parseNumber(balanceInput.value),
      residual: NumericInput.parseNumber(residualInput.value),
      mileage: parseFloat(mileageInput.value),
      fuelRate: parseFloat(fuelRateInput.value)
    };
    try {
      if (idInput.value) {
        await Api.put('/mixers/' + idInput.value, payload);
      } else {
        await Api.post('/mixers', payload);
      }
      dialog.close();
      await State.loadAll();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete(mixer) {
    if (!confirm('Удалить миксер «' + mixer.name + '»?')) return;
    try {
      await Api.del('/mixers/' + mixer.id);
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderTiles() {
    var container = document.getElementById('mixer-tiles');
    container.innerHTML = '';
    State.data.mixers.forEach(function (mixer) {
      var amortPerKm = Calc.amortPerKm(mixer);
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML =
        '<div class="tile-title"></div>' +
        '<div class="tile-meta"></div>' +
        '<div class="tile-value"></div>' +
        '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="copy-btn">Копировать</button><button type="button" class="danger del-btn">Удалить</button></div>';
      tile.querySelector('.tile-title').textContent = mixer.name;
      tile.querySelector('.tile-meta').textContent = Format.fmtNum(mixer.capacity, 1, 'м³') + ' · ' + Format.fmtNum(mixer.fuelRate, 1, 'л/100км');
      tile.querySelector('.tile-value').textContent = Format.fmt(amortPerKm, 2) + '/км';
      tile.querySelector('.edit-btn').addEventListener('click', function () { openForEdit(mixer); });
      tile.querySelector('.copy-btn').addEventListener('click', function () { openForDuplicate(mixer); });
      tile.querySelector('.del-btn').addEventListener('click', function () { handleDelete(mixer); });
      container.appendChild(tile);
    });
  }

  // ---- Aggregate-hauling trucks (доставка инертных на завод) ----
  var atDialog = document.getElementById('aggregate-truck-dialog');
  var atForm = document.getElementById('aggregate-truck-form');
  var atErrorEl = document.getElementById('aggregate-truck-dialog-error');
  var atTitleEl = document.getElementById('aggregate-truck-dialog-title');
  var atIdInput = document.getElementById('aggregate-truck-id');
  var atNameInput = document.getElementById('aggregate-truck-name');
  var atCapacityInput = document.getElementById('aggregate-truck-capacity');
  var atBalanceInput = document.getElementById('aggregate-truck-balance');
  var atResidualInput = document.getElementById('aggregate-truck-residual');
  var atMileageInput = document.getElementById('aggregate-truck-mileage');
  var atFuelRateInput = document.getElementById('aggregate-truck-fuel-rate');

  function openTruckForCreate() {
    atTitleEl.textContent = 'Новая техника';
    atIdInput.value = '';
    atNameInput.value = '';
    atCapacityInput.value = '';
    atBalanceInput.value = '';
    atResidualInput.value = '';
    atMileageInput.value = '';
    atFuelRateInput.value = '';
    atErrorEl.hidden = true;
    atDialog.showModal();
  }

  function fillTruckForm(truck, duplicate) {
    atTitleEl.textContent = duplicate ? 'Копия техники' : 'Изменить технику';
    atIdInput.value = duplicate ? '' : truck.id;
    atNameInput.value = duplicate ? (truck.name + ' (копия)') : truck.name;
    atCapacityInput.value = truck.capacity;
    NumericInput.setFormattedValue(atBalanceInput, truck.balance);
    NumericInput.setFormattedValue(atResidualInput, truck.residual);
    atMileageInput.value = truck.mileage;
    atFuelRateInput.value = truck.fuelRate;
    atErrorEl.hidden = true;
    atDialog.showModal();
  }

  function openTruckForEdit(truck) { fillTruckForm(truck, false); }
  function openTruckForDuplicate(truck) { fillTruckForm(truck, true); }

  async function handleTruckSubmit(e) {
    e.preventDefault();
    atErrorEl.hidden = true;
    var payload = {
      name: atNameInput.value,
      capacity: parseFloat(atCapacityInput.value),
      balance: NumericInput.parseNumber(atBalanceInput.value),
      residual: NumericInput.parseNumber(atResidualInput.value),
      mileage: parseFloat(atMileageInput.value),
      fuelRate: parseFloat(atFuelRateInput.value)
    };
    try {
      if (atIdInput.value) {
        await Api.put('/aggregate-trucks/' + atIdInput.value, payload);
      } else {
        await Api.post('/aggregate-trucks', payload);
      }
      atDialog.close();
      await State.loadAll();
    } catch (err) {
      atErrorEl.textContent = err.message;
      atErrorEl.hidden = false;
    }
  }

  async function handleTruckDelete(truck) {
    if (!confirm('Удалить технику «' + truck.name + '»?')) return;
    try {
      await Api.del('/aggregate-trucks/' + truck.id);
      await State.loadAll();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.blockingMaterials) {
        alert('Техника используется в доставке материалов: ' + err.data.blockingMaterials.join(', ') + '. Сначала уберите её оттуда.');
      } else {
        alert(err.message);
      }
    }
  }

  function renderTruckTiles() {
    var container = document.getElementById('aggregate-truck-tiles');
    container.innerHTML = '';
    State.data.aggregateTrucks.forEach(function (truck) {
      var amortPerKm = Calc.amortPerKm(truck);
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML =
        '<div class="tile-title"></div>' +
        '<div class="tile-meta"></div>' +
        '<div class="tile-value"></div>' +
        '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="copy-btn">Копировать</button><button type="button" class="danger del-btn">Удалить</button></div>';
      tile.querySelector('.tile-title').textContent = truck.name;
      tile.querySelector('.tile-meta').textContent = Format.fmtNum(truck.capacity, 1, 'т') + ' · ' + Format.fmtNum(truck.fuelRate, 1, 'л/100км');
      tile.querySelector('.tile-value').textContent = Format.fmt(amortPerKm, 2) + '/км';
      tile.querySelector('.edit-btn').addEventListener('click', function () { openTruckForEdit(truck); });
      tile.querySelector('.copy-btn').addEventListener('click', function () { openTruckForDuplicate(truck); });
      tile.querySelector('.del-btn').addEventListener('click', function () { handleTruckDelete(truck); });
      container.appendChild(tile);
    });
  }

  // ---- Общие настройки (цена топлива, надбавка за рейс в другой город) ----
  var fuelPriceDefaultInput = document.getElementById('fuel-price-default');
  var fuelPriceSaveTimer = null;

  function scheduleFuelPriceSave() {
    clearTimeout(fuelPriceSaveTimer);
    fuelPriceSaveTimer = setTimeout(saveFuelPriceDefault, 500);
  }

  async function saveFuelPriceDefault() {
    try {
      await Api.put('/config', { fuelPriceDefault: parseFloat(fuelPriceDefaultInput.value) || 0 });
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить цену топлива: ' + err.message);
    }
  }

  function renderFuelPriceDefault() {
    if (document.activeElement === fuelPriceDefaultInput) return;
    fuelPriceDefaultInput.value = State.data.config.fuelPriceDefault || 0;
  }

  var neighborSurchargeInput = document.getElementById('neighbor-city-surcharge');
  var neighborSurchargeSaveTimer = null;

  function scheduleNeighborSurchargeSave() {
    clearTimeout(neighborSurchargeSaveTimer);
    neighborSurchargeSaveTimer = setTimeout(saveNeighborSurcharge, 500);
  }

  async function saveNeighborSurcharge() {
    try {
      await Api.put('/config', { neighborCitySurcharge: parseFloat(neighborSurchargeInput.value) || 0 });
      await State.loadAll();
    } catch (err) {
      alert('Не удалось сохранить надбавку за рейс в другой город: ' + err.message);
    }
  }

  function renderNeighborSurcharge() {
    if (document.activeElement === neighborSurchargeInput) return;
    neighborSurchargeInput.value = State.data.config.neighborCitySurcharge || 0;
  }

  function init() {
    document.getElementById('add-mixer-btn').addEventListener('click', openForCreate);
    form.addEventListener('submit', handleSubmit);
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    NumericInput.attach(balanceInput);
    NumericInput.attach(residualInput);

    document.getElementById('add-aggregate-truck-btn').addEventListener('click', openTruckForCreate);
    atForm.addEventListener('submit', handleTruckSubmit);
    Array.prototype.forEach.call(atDialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { atDialog.close(); });
    });
    NumericInput.attach(atBalanceInput);
    NumericInput.attach(atResidualInput);

    fuelPriceDefaultInput.addEventListener('input', scheduleFuelPriceSave);
    neighborSurchargeInput.addEventListener('input', scheduleNeighborSurchargeSave);
  }

  function renderAdminOnlyCards() {
    var isAdmin = window.Auth && Auth.isAtLeast('admin');
    document.getElementById('mixers-card').hidden = !isAdmin;
    document.getElementById('aggregate-trucks-card').hidden = !isAdmin;
  }

  function render() {
    renderTiles();
    renderTruckTiles();
    renderFuelPriceDefault();
    renderNeighborSurcharge();
    renderAdminOnlyCards();
  }

  window.EquipmentTab = { init: init, render: render };
})();
