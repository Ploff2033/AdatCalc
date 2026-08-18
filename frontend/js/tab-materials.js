(function () {
  // ---- Materials catalog ----
  var matDialog = document.getElementById('material-dialog');
  var matForm = document.getElementById('material-form');
  var matErrorEl = document.getElementById('material-dialog-error');
  var matTitleEl = document.getElementById('material-dialog-title');
  var matIdInput = document.getElementById('material-id');
  var matNameInput = document.getElementById('material-name');
  var matUnitInput = document.getElementById('material-unit');
  var matPriceInput = document.getElementById('material-price');
  var matLossInput = document.getElementById('material-loss');

  // ---- Доставка инертных на завод ----
  var matDeliveryOwnTransportCheckbox = document.getElementById('material-delivery-own-transport');
  var matDeliveryManualField = document.getElementById('material-delivery-manual-field');
  var matDeliveryManualCostInput = document.getElementById('material-delivery-manual-cost');
  var matDeliveryManualUnitEl = document.getElementById('material-delivery-manual-unit');
  var matDeliveryTruckSelect = document.getElementById('material-delivery-truck');
  var matDeliveryFields = document.getElementById('material-delivery-fields');
  var matDeliveryDistanceInput = document.getElementById('material-delivery-distance');
  var matDeliveryFuelPriceInput = document.getElementById('material-delivery-fuel-price');
  var matDeliverySurchargeInput = document.getElementById('material-delivery-surcharge');
  var matDeliveryAmortRateInput = document.getElementById('material-delivery-amort-rate');

  function buildTruckOptions(selectedId) {
    matDeliveryTruckSelect.innerHTML = '';
    State.data.aggregateTrucks.forEach(function (truck) {
      var opt = document.createElement('option');
      opt.value = truck.id;
      opt.textContent = truck.name + ' (' + Format.fmtNum(truck.capacity, 1, 'т') + ')';
      matDeliveryTruckSelect.appendChild(opt);
    });
    var validId = State.data.aggregateTrucks.some(function (t) { return t.id === selectedId; })
      ? selectedId
      : (State.data.aggregateTrucks[0] && State.data.aggregateTrucks[0].id) || '';
    matDeliveryTruckSelect.value = validId;
    return validId;
  }

  function clearDeliveryFields() {
    matDeliveryDistanceInput.value = '';
    matDeliveryFuelPriceInput.value = State.data.config.fuelPriceDefault || '';
    matDeliverySurchargeInput.value = '';
    matDeliveryAmortRateInput.value = '';
  }

  function applyDeliveryModeVisibility() {
    var ownTransport = matDeliveryOwnTransportCheckbox.checked;
    matDeliveryManualField.hidden = ownTransport;
    matDeliveryFields.hidden = !ownTransport;
  }

  function handleOwnTransportToggle() {
    applyDeliveryModeVisibility();
    if (matDeliveryOwnTransportCheckbox.checked) {
      handleDeliveryTruckChange();
    } else {
      updateMaterialDialogPricing();
    }
  }

  function handleDeliveryTruckChange() {
    var truck = State.data.aggregateTrucks.find(function (t) { return t.id === matDeliveryTruckSelect.value; });
    if (truck) {
      matDeliveryAmortRateInput.value = Calc.amortPerKm(truck).toFixed(2);
      if (!matDeliveryFuelPriceInput.value) {
        matDeliveryFuelPriceInput.value = State.data.config.fuelPriceDefault || '';
      }
    }
    updateMaterialDialogPricing();
  }

  function readDeliveryDraftFromForm() {
    var ownTransport = matDeliveryOwnTransportCheckbox.checked;
    if (!ownTransport) {
      return {
        ownTransport: false,
        truckId: null,
        distanceKm: 0,
        fuelPricePerLiter: 0,
        driverSurcharge: 0,
        amortRatePerKm: 0,
        manualCostPerUnit: parseFloat(matDeliveryManualCostInput.value) || 0
      };
    }
    return {
      ownTransport: true,
      truckId: matDeliveryTruckSelect.value,
      distanceKm: parseFloat(matDeliveryDistanceInput.value) || 0,
      fuelPricePerLiter: parseFloat(matDeliveryFuelPriceInput.value) || 0,
      driverSurcharge: parseFloat(matDeliverySurchargeInput.value) || 0,
      amortRatePerKm: parseFloat(matDeliveryAmortRateInput.value) || 0,
      manualCostPerUnit: 0
    };
  }

  function updateMaterialDialogPricing() {
    var delivery = readDeliveryDraftFromForm();
    var truck = delivery.ownTransport ? State.data.aggregateTrucks.find(function (t) { return t.id === delivery.truckId; }) : null;
    var perUnit;

    if (delivery.ownTransport) {
      var perTrip = Calc.aggregateDeliveryPerTrip(delivery, truck);
      perUnit = truck && truck.capacity > 0 ? perTrip.total / truck.capacity : 0;
      document.getElementById('material-delivery-fuel-cost').textContent = Format.fmt(perTrip.fuel, 2);
      document.getElementById('material-delivery-amort-cost').textContent = Format.fmt(perTrip.amort, 2);
      document.getElementById('material-delivery-surcharge-cost').textContent = Format.fmt(perTrip.surcharge, 2);
      document.getElementById('material-delivery-trip-total').textContent = Format.fmt(perTrip.total, 2);
      document.getElementById('material-delivery-per-ton').textContent = Format.fmt(perUnit, 2);
    } else {
      perUnit = delivery.manualCostPerUnit;
    }

    var warehousePrice = NumericInput.parseNumber(matPriceInput.value) || 0;
    var landed = warehousePrice + perUnit;
    document.getElementById('material-price-warehouse').textContent = Format.fmt(warehousePrice, 2);
    document.getElementById('material-price-delivery-addition').textContent = Format.fmt(perUnit, 2);
    document.getElementById('material-price-landed').textContent = Format.fmt(landed, 2);
  }

  function openMaterialForCreate() {
    matTitleEl.textContent = 'Новый материал';
    matIdInput.value = '';
    matNameInput.value = '';
    matUnitInput.value = '';
    matPriceInput.value = '';
    matLossInput.value = '0';
    matErrorEl.hidden = true;
    matDeliveryOwnTransportCheckbox.checked = false;
    buildTruckOptions('');
    clearDeliveryFields();
    matDeliveryManualCostInput.value = '0';
    matDeliveryManualUnitEl.textContent = '₽/т';
    applyDeliveryModeVisibility();
    updateMaterialDialogPricing();
    matDialog.showModal();
  }

  function openMaterialForEdit(mat) {
    matTitleEl.textContent = 'Изменить материал';
    matIdInput.value = mat.id;
    matNameInput.value = mat.name;
    matUnitInput.value = mat.unit;
    NumericInput.setFormattedValue(matPriceInput, mat.price);
    matLossInput.value = mat.lossPercent || 0;
    matErrorEl.hidden = true;

    var delivery = mat.delivery;
    var ownTransport = !!(delivery && delivery.ownTransport);
    matDeliveryOwnTransportCheckbox.checked = ownTransport;
    buildTruckOptions(delivery ? delivery.truckId : '');
    if (ownTransport) {
      matDeliveryDistanceInput.value = delivery.distanceKm;
      matDeliveryFuelPriceInput.value = delivery.fuelPricePerLiter;
      matDeliverySurchargeInput.value = delivery.driverSurcharge;
      matDeliveryAmortRateInput.value = delivery.amortRatePerKm;
      matDeliveryManualCostInput.value = '0';
    } else {
      clearDeliveryFields();
      matDeliveryManualCostInput.value = (delivery && delivery.manualCostPerUnit) || 0;
    }
    matDeliveryManualUnitEl.textContent = '₽/' + (mat.unit || 'т');
    applyDeliveryModeVisibility();
    updateMaterialDialogPricing();
    matDialog.showModal();
  }

  async function handleMaterialSubmit(e) {
    e.preventDefault();
    matErrorEl.hidden = true;
    var payload = {
      name: matNameInput.value,
      unit: matUnitInput.value,
      price: NumericInput.parseNumber(matPriceInput.value),
      lossPercent: parseFloat(matLossInput.value) || 0,
      delivery: readDeliveryDraftFromForm()
    };
    try {
      if (matIdInput.value) {
        await Api.put('/materials/' + matIdInput.value, payload);
      } else {
        await Api.post('/materials', payload);
      }
      matDialog.close();
      await State.loadAll();
    } catch (err) {
      matErrorEl.textContent = err.message;
      matErrorEl.hidden = false;
    }
  }

  async function handleMaterialDelete(mat) {
    if (!confirm('Удалить материал «' + mat.name + '»?')) return;
    try {
      await Api.del('/materials/' + mat.id);
      await State.loadAll();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.blockingRecipes) {
        alert('Материал используется в рецептах: ' + err.data.blockingRecipes.join(', ') + '. Сначала уберите его оттуда.');
      } else {
        alert(err.message);
      }
    }
  }

  function renderMaterials() {
    var container = document.getElementById('material-rows');
    container.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'mat-catalog-row';
    header.innerHTML =
      '<div class="col-label">Материал</div><div class="col-label">Ед.</div>' +
      '<div class="col-label">Закупочная цена</div><div class="col-label">Потери</div>' +
      '<div class="col-label">Реальная цена</div><div></div>';
    container.appendChild(header);

    State.data.materials.forEach(function (mat) {
      var row = document.createElement('div');
      row.className = 'mat-catalog-row';
      row.innerHTML =
        '<div class="mat-name"></div>' +
        '<div class="mat-unit"></div>' +
        '<div class="mat-price"></div>' +
        '<div class="mat-loss"></div>' +
        '<div class="mat-real-price"></div>' +
        '<div class="tile-actions"></div>';
      var effectivePrice = Calc.materialEffectivePrice(mat, State.data.aggregateTrucks);
      row.querySelector('.mat-name').textContent = mat.name;
      row.querySelector('.mat-unit').textContent = mat.unit;
      row.querySelector('.mat-price').textContent = Format.fmt(mat.price, 2) + ' / ' + mat.unit;
      row.querySelector('.mat-loss').textContent = (mat.lossPercent || 0) + '%';
      row.querySelector('.mat-real-price').textContent = Format.fmt(effectivePrice, 2) + ' / ' + mat.unit;
      var actions = row.querySelector('.tile-actions');
      actions.style.marginTop = '0';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Изменить';
      editBtn.addEventListener('click', function () { openMaterialForEdit(mat); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger';
      delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', function () { handleMaterialDelete(mat); });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      container.appendChild(row);
    });
  }

  // ---- Recipes ----
  var recDialog = document.getElementById('recipe-dialog');
  var recForm = document.getElementById('recipe-form');
  var recErrorEl = document.getElementById('recipe-dialog-error');
  var recTitleEl = document.getElementById('recipe-dialog-title');
  var recIdInput = document.getElementById('recipe-id');
  var recNameInput = document.getElementById('recipe-name');
  var recSalePriceInput = document.getElementById('recipe-sale-price');
  var recItemsContainer = document.getElementById('recipe-items');
  var recCostEl = document.getElementById('recipe-dialog-cost');
  var recItemTemplate = document.getElementById('recipe-item-row-template');

  function buildMaterialOptions(select, selectedId) {
    select.innerHTML = '';
    State.data.materials.forEach(function (mat) {
      var opt = document.createElement('option');
      opt.value = mat.id;
      opt.textContent = mat.name + ' (' + mat.unit + ')';
      select.appendChild(opt);
    });
    if (selectedId) select.value = selectedId;
  }

  function addRecipeItemRow(item) {
    var node = recItemTemplate.content.firstElementChild.cloneNode(true);
    var select = node.querySelector('.recipe-item-material');
    var qtyInput = node.querySelector('.recipe-item-qty');
    buildMaterialOptions(select, item ? item.materialId : (State.data.materials[0] && State.data.materials[0].id));
    qtyInput.value = item ? item.qty : '';
    select.addEventListener('change', updateRecipeDialogCost);
    qtyInput.addEventListener('input', updateRecipeDialogCost);
    node.querySelector('.recipe-item-remove').addEventListener('click', function () {
      node.remove();
      updateRecipeDialogCost();
    });
    recItemsContainer.appendChild(node);
  }

  function readRecipeItemsFromForm() {
    return Array.prototype.map.call(recItemsContainer.querySelectorAll('.recipe-item-row'), function (row) {
      return {
        materialId: row.querySelector('.recipe-item-material').value,
        qty: parseFloat(row.querySelector('.recipe-item-qty').value) || 0
      };
    });
  }

  function updateRecipeDialogCost() {
    var byId = {};
    State.data.materials.forEach(function (m) { byId[m.id] = m; });
    var total = 0;
    Array.prototype.forEach.call(recItemsContainer.querySelectorAll('.recipe-item-row'), function (row) {
      var materialId = row.querySelector('.recipe-item-material').value;
      var qty = parseFloat(row.querySelector('.recipe-item-qty').value) || 0;
      var mat = byId[materialId];
      var cost = mat ? qty * Calc.materialEffectivePrice(mat, State.data.aggregateTrucks) : 0;
      row.querySelector('.recipe-item-cost').textContent = Format.fmt(cost, 2);
      total += cost;
    });
    recCostEl.textContent = Format.fmt(total, 2);
  }

  function openRecipeForCreate() {
    if (!State.data.materials.length) {
      alert('Сначала добавьте хотя бы один материал в справочник выше.');
      return;
    }
    recTitleEl.textContent = 'Новая смесь';
    recIdInput.value = '';
    recNameInput.value = '';
    recSalePriceInput.value = '';
    recItemsContainer.innerHTML = '';
    recErrorEl.hidden = true;
    addRecipeItemRow();
    updateRecipeDialogCost();
    recDialog.showModal();
  }

  function openRecipeForEdit(recipe) {
    recTitleEl.textContent = 'Изменить смесь';
    recIdInput.value = recipe.id;
    recNameInput.value = recipe.name;
    NumericInput.setFormattedValue(recSalePriceInput, recipe.salePrice);
    recItemsContainer.innerHTML = '';
    recErrorEl.hidden = true;
    recipe.items.forEach(addRecipeItemRow);
    updateRecipeDialogCost();
    recDialog.showModal();
  }

  async function handleRecipeSubmit(e) {
    e.preventDefault();
    recErrorEl.hidden = true;
    var payload = {
      name: recNameInput.value,
      salePrice: NumericInput.parseNumber(recSalePriceInput.value),
      items: readRecipeItemsFromForm()
    };
    try {
      if (recIdInput.value) {
        await Api.put('/recipes/' + recIdInput.value, payload);
      } else {
        await Api.post('/recipes', payload);
      }
      recDialog.close();
      await State.loadAll();
    } catch (err) {
      recErrorEl.textContent = err.message;
      recErrorEl.hidden = false;
    }
  }

  async function handleRecipeDelete(recipe) {
    if (!confirm('Удалить рецепт «' + recipe.name + '»?')) return;
    try {
      await Api.del('/recipes/' + recipe.id);
      await State.loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderRecipeTiles() {
    var container = document.getElementById('recipe-tiles');
    container.innerHTML = '';
    State.data.recipes.forEach(function (recipe) {
      var cost = Calc.materialsCostPerM3(recipe, State.data.materials, State.data.aggregateTrucks);
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML =
        '<div class="tile-title"></div>' +
        '<div class="tile-meta"></div>' +
        '<div class="breakdown compact">' +
          '<div class="line"><span class="l">Себестоимость</span><span class="v cost"></span></div>' +
          '<div class="line"><span class="l">Цена отпуска</span><span class="v price"></span></div>' +
        '</div>' +
        '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="danger del-btn">Удалить</button></div>';
      tile.querySelector('.tile-title').textContent = recipe.name;
      tile.querySelector('.tile-meta').textContent = recipe.items.length + ' компонент(ов)';
      tile.querySelector('.cost').textContent = Format.fmt(cost, 2);
      tile.querySelector('.price').textContent = Format.fmt(recipe.salePrice || 0, 2);
      tile.querySelector('.edit-btn').addEventListener('click', function () { openRecipeForEdit(recipe); });
      tile.querySelector('.del-btn').addEventListener('click', function () { handleRecipeDelete(recipe); });
      container.appendChild(tile);
    });
  }

  function closeOnBackdropButtons(dialog) {
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
  }

  function init() {
    document.getElementById('add-material-btn').addEventListener('click', openMaterialForCreate);
    matForm.addEventListener('submit', handleMaterialSubmit);
    closeOnBackdropButtons(matDialog);
    NumericInput.attach(matPriceInput);
    matPriceInput.addEventListener('input', updateMaterialDialogPricing);

    matDeliveryOwnTransportCheckbox.addEventListener('change', handleOwnTransportToggle);
    matDeliveryTruckSelect.addEventListener('change', handleDeliveryTruckChange);
    matDeliveryManualCostInput.addEventListener('input', updateMaterialDialogPricing);
    [matDeliveryDistanceInput, matDeliveryFuelPriceInput, matDeliverySurchargeInput, matDeliveryAmortRateInput].forEach(function (input) {
      input.addEventListener('input', updateMaterialDialogPricing);
    });

    document.getElementById('add-recipe-btn').addEventListener('click', openRecipeForCreate);
    document.getElementById('recipe-add-item-btn').addEventListener('click', function () {
      addRecipeItemRow();
    });
    recForm.addEventListener('submit', handleRecipeSubmit);
    closeOnBackdropButtons(recDialog);
    NumericInput.attach(recSalePriceInput);
  }

  function render() {
    renderMaterials();
    renderRecipeTiles();
  }

  window.MaterialsTab = { init: init, render: render };
})();
