(function () {
  var dialog = document.getElementById('mixer-dialog');
  var form = document.getElementById('mixer-form');
  var errorEl = document.getElementById('mixer-dialog-error');
  var titleEl = document.getElementById('mixer-dialog-title');
  var idInput = document.getElementById('mixer-id');
  var nameInput = document.getElementById('mixer-name');
  var balanceInput = document.getElementById('mixer-balance');
  var residualInput = document.getElementById('mixer-residual');
  var mileageInput = document.getElementById('mixer-mileage');
  var fuelRateInput = document.getElementById('mixer-fuel-rate');

  function openForCreate() {
    titleEl.textContent = 'Новый миксер';
    idInput.value = '';
    nameInput.value = '';
    balanceInput.value = '';
    residualInput.value = '';
    mileageInput.value = '';
    fuelRateInput.value = '';
    errorEl.hidden = true;
    dialog.showModal();
  }

  function openForEdit(mixer) {
    titleEl.textContent = 'Изменить миксер';
    idInput.value = mixer.id;
    nameInput.value = mixer.name;
    balanceInput.value = mixer.balance;
    residualInput.value = mixer.residual;
    mileageInput.value = mixer.mileage;
    fuelRateInput.value = mixer.fuelRate;
    errorEl.hidden = true;
    dialog.showModal();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errorEl.hidden = true;
    var payload = {
      name: nameInput.value,
      balance: parseFloat(balanceInput.value),
      residual: parseFloat(residualInput.value),
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
        '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="danger del-btn">Удалить</button></div>';
      tile.querySelector('.tile-title').textContent = mixer.name;
      tile.querySelector('.tile-meta').textContent = Format.fmtNum(mixer.fuelRate, 1, 'л/100км');
      tile.querySelector('.tile-value').textContent = Format.fmt(amortPerKm, 2) + '/км';
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
  }

  function render() {
    renderTiles();
  }

  window.EquipmentTab = { init: init, render: render };
})();
