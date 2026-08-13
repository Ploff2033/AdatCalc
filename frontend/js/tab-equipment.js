(function () {
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
  var maintenanceInput = document.getElementById('mixer-maintenance');

  function openForCreate() {
    titleEl.textContent = 'Новый миксер';
    idInput.value = '';
    nameInput.value = '';
    capacityInput.value = '';
    balanceInput.value = '';
    residualInput.value = '';
    mileageInput.value = '';
    fuelRateInput.value = '';
    maintenanceInput.value = '0';
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openForEdit(mixer) {
    titleEl.textContent = 'Изменить миксер';
    idInput.value = mixer.id;
    nameInput.value = mixer.name;
    capacityInput.value = mixer.capacity;
    NumericInput.setFormattedValue(balanceInput, mixer.balance);
    NumericInput.setFormattedValue(residualInput, mixer.residual);
    mileageInput.value = mixer.mileage;
    fuelRateInput.value = mixer.fuelRate;
    maintenanceInput.value = mixer.maintenancePerKm || 0;
    errorEl.hidden = true;
    dialog.showModal();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    var payload = {
      name: nameInput.value,
      capacity: parseFloat(capacityInput.value),
      balance: NumericInput.parseNumber(balanceInput.value),
      residual: NumericInput.parseNumber(residualInput.value),
      mileage: parseFloat(mileageInput.value),
      fuelRate: parseFloat(fuelRateInput.value),
      maintenancePerKm: parseFloat(maintenanceInput.value) || 0
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
        '<div class="breakdown compact">' +
          '<div class="line"><span class="l">Амортизация</span><span class="v cost"></span></div>' +
          '<div class="line"><span class="l">Ремонт и ТО</span><span class="v cost"></span></div>' +
        '</div>' +
        '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="danger del-btn">Удалить</button></div>';
      tile.querySelector('.tile-title').textContent = mixer.name;
      tile.querySelector('.tile-meta').textContent = Format.fmtNum(mixer.capacity, 1, 'м³') + ' · ' + Format.fmtNum(mixer.fuelRate, 1, 'л/100км');
      var costEls = tile.querySelectorAll('.v.cost');
      costEls[0].textContent = Format.fmt(amortPerKm, 2) + '/км';
      costEls[1].textContent = Format.fmt(mixer.maintenancePerKm || 0, 2) + '/км';
      tile.querySelector('.edit-btn').addEventListener('click', function () { openForEdit(mixer); });
      tile.querySelector('.del-btn').addEventListener('click', function () { handleDelete(mixer); });
      container.appendChild(tile);
    });
  }

  function init() {
    document.getElementById('add-mixer-btn').addEventListener('click', openForCreate);
    form.addEventListener('submit', handleSubmit);
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    NumericInput.attach(balanceInput);
    NumericInput.attach(residualInput);
  }

  function render() {
    renderTiles();
  }

  window.EquipmentTab = { init: init, render: render };
})();
