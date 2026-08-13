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

  function openMaterialForCreate() {
    matTitleEl.textContent = 'Новый материал';
    matIdInput.value = '';
    matNameInput.value = '';
    matUnitInput.value = '';
    matPriceInput.value = '';
    matErrorEl.hidden = true;
    matDialog.showModal();
  }

  function openMaterialForEdit(mat) {
    matTitleEl.textContent = 'Изменить материал';
    matIdInput.value = mat.id;
    matNameInput.value = mat.name;
    matUnitInput.value = mat.unit;
    NumericInput.setFormattedValue(matPriceInput, mat.price);
    matErrorEl.hidden = true;
    matDialog.showModal();
  }

  async function handleMaterialSubmit(e) {
    e.preventDefault();
    matErrorEl.hidden = true;
    var payload = {
      name: matNameInput.value,
      unit: matUnitInput.value,
      price: NumericInput.parseNumber(matPriceInput.value)
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
    header.innerHTML = '<div class="col-label">Материал</div><div class="col-label">Ед.</div><div class="col-label">Цена</div><div></div>';
    container.appendChild(header);

    State.data.materials.forEach(function (mat) {
      var row = document.createElement('div');
      row.className = 'mat-catalog-row';
      row.innerHTML =
        '<div class="mat-name"></div>' +
        '<div class="mat-unit"></div>' +
        '<div class="mat-price"></div>' +
        '<div class="tile-actions"></div>';
      row.querySelector('.mat-name').textContent = mat.name;
      row.querySelector('.mat-unit').textContent = mat.unit;
      row.querySelector('.mat-price').textContent = Format.fmt(mat.price, 2) + ' / ' + mat.unit;
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
    var cost = Calc.materialsCostPerM3({ items: readRecipeItemsFromForm() }, State.data.materials);
    recCostEl.textContent = Format.fmt(cost, 2);
  }

  function openRecipeForCreate() {
    if (!State.data.materials.length) {
      alert('Сначала добавьте хотя бы один материал в справочник выше.');
      return;
    }
    recTitleEl.textContent = 'Новый рецепт';
    recIdInput.value = '';
    recNameInput.value = '';
    recItemsContainer.innerHTML = '';
    recErrorEl.hidden = true;
    addRecipeItemRow();
    updateRecipeDialogCost();
    recDialog.showModal();
  }

  function openRecipeForEdit(recipe) {
    recTitleEl.textContent = 'Изменить рецепт';
    recIdInput.value = recipe.id;
    recNameInput.value = recipe.name;
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
      var cost = Calc.materialsCostPerM3(recipe, State.data.materials);
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML =
        '<div class="tile-title"></div>' +
        '<div class="tile-meta"></div>' +
        '<div class="tile-value"></div>' +
        '<div class="tile-actions"><button type="button" class="edit-btn">Изменить</button><button type="button" class="danger del-btn">Удалить</button></div>';
      tile.querySelector('.tile-title').textContent = recipe.name;
      tile.querySelector('.tile-meta').textContent = recipe.items.length + ' компонент(ов)';
      tile.querySelector('.tile-value').textContent = Format.fmt(cost, 2) + '/м³';
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

    document.getElementById('add-recipe-btn').addEventListener('click', openRecipeForCreate);
    document.getElementById('recipe-add-item-btn').addEventListener('click', function () {
      addRecipeItemRow();
    });
    recForm.addEventListener('submit', handleRecipeSubmit);
    closeOnBackdropButtons(recDialog);
  }

  function render() {
    renderMaterials();
    renderRecipeTiles();
  }

  window.MaterialsTab = { init: init, render: render };
})();
