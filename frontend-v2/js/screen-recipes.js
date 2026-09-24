(function () {
  // Смеси — справочник рецептов (макет Recipes.dc.html). Тот же API, что и
  // v1 (frontend/js/tab-materials.js — рецепты POST/PUT /api/recipes), та же
  // формула себестоимости (Calc.materialsCostPerM3/payrollPerM3/...), просто
  // трёхколоночная вёрстка вместо диалога: список слева, состав по центру,
  // сводка справа — выбор смеси меняет центр/правую колонку, а не открывает
  // модалку.
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap" id="rc-scope">Смеси</span><h1>Смеси</h1></div><div class="page-head-actions"><button class="btn pri sm" id="rc-add-btn">Новая смесь</button></div></div>' +
    '<div style="display:grid;grid-template-columns:250px minmax(0,1fr) 280px;gap:16px;align-items:start;flex:1;min-height:0" class="rc-grid">' +
      '<section class="card" style="display:flex;flex-direction:column;overflow:hidden;align-self:start">' +
        '<div style="padding:12px 14px;border-bottom:1px solid var(--border-soft)"><input class="inp" id="rc-search" placeholder="Поиск смеси" aria-label="Поиск смеси"></div>' +
        '<div id="rc-list"></div>' +
        '<p class="empty-state" id="rc-list-empty" hidden>Смесей нет.</p>' +
      '</section>' +
      '<section class="card" style="display:flex;flex-direction:column;overflow:hidden" id="rc-detail" hidden>' +
        '<div style="padding:20px 22px;border-bottom:1px solid var(--border-soft)" class="grid-3">' +
          '<div class="field"><label for="rc-f-name">Название смеси</label><input id="rc-f-name" class="inp"></div>' +
          '<div class="field"><label for="rc-f-price-gross">Цена отпуска с НДС</label><input id="rc-f-price-gross" class="inp num" inputmode="decimal"></div>' +
          '<div class="field"><label for="rc-f-price-net">Без НДС</label><input id="rc-f-price-net" class="inp num" inputmode="decimal"></div>' +
        '</div>' +
        '<div class="spread" style="padding:16px 22px 6px"><h2 style="font-size:18px;font-weight:600">Состав на 1 м³</h2><button type="button" class="btn ghost sm" id="rc-add-item-btn">Добавить материал</button></div>' +
        '<div class="row head" style="grid-template-columns:1.6fr 150px 110px 110px 36px;margin:0 6px"><div>Материал</div><div class="r">Расход на м³</div><div class="r">Себест. ед.</div><div class="r">На 1 м³</div><div></div></div>' +
        '<div id="rc-items" style="margin:0 6px"></div>' +
        '<div class="spread" style="padding:12px 22px 16px;margin:0 6px;font-weight:600"><span>Материалы на 1 м³</span><span class="num" id="rc-items-total">—</span></div>' +
      '</section>' +
      '<aside class="card" style="display:flex;flex-direction:column;overflow:hidden;align-self:start;border-color:var(--ink)" id="rc-summary" hidden>' +
        '<div style="padding:16px 18px;background:var(--sidebar-bg);color:#fff" class="stack" style="gap:2px"><span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--sidebar-muted);font-weight:600" id="rc-summary-scope">Себестоимость 1 м³</span><span class="num" id="rc-summary-cost" style="font-size:28px;font-weight:500">—</span></div>' +
        '<div class="stack g8" style="padding:16px 18px">' +
          '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Материалы</span><span class="num" id="rc-sum-materials">—</span></div>' +
          '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">ФОТ</span><span class="num" id="rc-sum-payroll">—</span></div>' +
          '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Амортизация завода</span><span class="num" id="rc-sum-depr">—</span></div>' +
          '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Коммуналка</span><span class="num" id="rc-sum-utilities">—</span></div>' +
          '<div style="height:1px;background:var(--border-soft);margin:4px 0"></div>' +
          '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Цена без НДС</span><span class="num" id="rc-sum-price" style="font-weight:600">—</span></div>' +
          '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Цена безубыточности</span><span class="num" id="rc-sum-breakeven">—</span></div>' +
        '</div>' +
        '<div class="spread" id="rc-sum-margin-box" style="padding:14px 18px;border-top:1px solid var(--border-soft)"><span style="font-weight:600">Запас прочности</span><span class="num" id="rc-sum-margin" style="font-weight:600;font-size:18px">—</span></div>' +
        '<div style="padding:14px 18px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;border-top:1px solid var(--border-soft)"><button type="button" class="btn ghost sm" id="rc-delete-btn" style="color:#8C2217;border-color:#E3B8B1">Удалить</button><button type="button" class="btn pri sm" id="rc-save-btn">Сохранить смесь</button></div>' +
      '</aside>' +
    '</div>';

  var VAT_MULT = 1.22;
  var searchValue = '';
  var selectedId = null; // null = создаём новую
  var items = []; // [{materialId, qty}]
  var formError = null;

  function materialsById() {
    var byId = {};
    (State.data.materials || []).forEach(function (m) { byId[m.id] = m; });
    return byId;
  }

  function filteredRecipes() {
    var q = searchValue.trim().toLowerCase();
    var list = (State.data.recipes || []).slice();
    if (q) list = list.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0; });
    return list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
  }

  function costFor(recipe) {
    var plant = State.currentPlant();
    var materialsCost = Calc.materialsCostPerM3(recipe, State.data.materials, State.data.aggregateTrucks);
    var fixed = Calc.payrollPerM3(plant, State.data.plants, State.data.personnelSummary) + Calc.plantDeprPerM3(plant) + Calc.utilitiesPerM3(plant);
    return materialsCost + fixed;
  }

  function renderList() {
    var recipes = filteredRecipes();
    document.getElementById('rc-list-empty').hidden = recipes.length > 0;
    document.getElementById('rc-list').innerHTML = recipes.map(function (r) {
      var cost = costFor(r);
      var margin = r.salePrice > 0 ? ((r.salePrice - cost) / r.salePrice) * 100 : null;
      var mc = margin === null ? 'var(--muted)' : (margin < 8 ? '#6E4700' : '#1C1D1B');
      var active = r.id === selectedId;
      return '<a href="#" class="lnk" data-recipe-id="' + r.id + '" style="display:flex;flex-direction:column;gap:4px;padding:12px 16px;border-bottom:1px solid var(--border-soft);border-left:3px solid ' + (active ? 'var(--accent)' : 'transparent') + ';background:' + (active ? 'var(--act-bg)' : 'transparent') + '">' +
        '<div class="spread"><span style="font-weight:600">' + r.name + '</span><span class="num" style="font-weight:500">' + Format.fmt(r.salePrice, 0) + '</span></div>' +
        '<div class="spread"><span class="num hint">себест. ' + Format.fmt(cost, 0) + '</span><span class="num" style="font-size:12px;font-weight:600;color:' + mc + '">' + (margin === null ? '—' : 'запас ' + Format.fmtNum(margin, 1, '%')) + '</span></div>' +
      '</a>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#rc-list [data-recipe-id]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var recipe = (State.data.recipes || []).find(function (r) { return r.id === a.dataset.recipeId; });
        if (recipe) selectRecipe(recipe);
      });
    });
  }

  function renderItemRow(item, index) {
    var byId = materialsById();
    var mat = byId[item.materialId];
    var cost = mat ? Calc.materialEffectivePrice(mat, State.data.aggregateTrucks) : 0;
    var sum = cost * (item.qty || 0);
    var options = (State.data.materials || []).map(function (m) {
      return '<option value="' + m.id + '"' + (m.id === item.materialId ? ' selected' : '') + '>' + m.name + ' (' + m.unit + ')</option>';
    }).join('');
    var row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'grid-template-columns:1.6fr 150px 110px 110px 36px;min-height:52px';
    row.innerHTML =
      '<select class="inp rc-item-material" style="height:36px">' + options + '</select>' +
      '<div class="unit"><input class="inp num rc-item-qty" style="height:36px;text-align:right"><span>' + (mat ? mat.unit : '') + '</span></div>' +
      '<div class="r num hint rc-item-cost">' + Format.fmt(cost, 2) + '</div>' +
      '<div class="r num rc-item-sum" style="font-weight:600">' + Format.fmt(sum, 2) + '</div>' +
      '<button type="button" class="btn ghost rc-item-remove" style="width:32px;height:32px;padding:0;border-color:transparent;color:var(--muted)" aria-label="Убрать материал"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    var qtyInput = row.querySelector('.rc-item-qty');
    NumericInput.attach(qtyInput);
    NumericInput.setFormattedValue(qtyInput, item.qty || '');
    row.querySelector('.rc-item-material').addEventListener('change', function () { items[index].materialId = this.value; renderItems(); });
    // Не перерисовываем весь список на каждый ввод цифры (как раньше) — это
    // пересоздавало DOM-узел инпута и сбрасывало фокус/курсор после первого
    // же символа, из-за чего маска разрядов не смогла бы работать. Вместо
    // этого точечно обновляем только цифры в этой строке и итоги.
    qtyInput.addEventListener('input', function () {
      items[index].qty = NumericInput.parseNumber(this.value) || 0;
      updateItemRowTotals(row, item);
      updateTotals();
      updateSummary();
    });
    row.querySelector('.rc-item-remove').addEventListener('click', function () { items.splice(index, 1); renderItems(); });
    return row;
  }

  function updateItemRowTotals(row, item) {
    var byId = materialsById();
    var mat = byId[item.materialId];
    var cost = mat ? Calc.materialEffectivePrice(mat, State.data.aggregateTrucks) : 0;
    var sum = cost * (item.qty || 0);
    row.querySelector('.rc-item-cost').textContent = Format.fmt(cost, 2);
    row.querySelector('.rc-item-sum').textContent = Format.fmt(sum, 2);
  }

  function updateTotals() {
    var byId = materialsById();
    var total = items.reduce(function (sum, item) {
      var mat = byId[item.materialId];
      return sum + (mat ? Calc.materialEffectivePrice(mat, State.data.aggregateTrucks) * (item.qty || 0) : 0);
    }, 0);
    document.getElementById('rc-items-total').textContent = Format.fmt(total, 2);
  }

  function renderItems() {
    var container = document.getElementById('rc-items');
    container.innerHTML = '';
    items.forEach(function (item, i) { container.appendChild(renderItemRow(item, i)); });
    updateTotals();
    updateSummary();
  }

  function updateSummary() {
    var plant = State.currentPlant();
    var byId = materialsById();
    var materialsCost = items.reduce(function (sum, item) {
      var mat = byId[item.materialId];
      return sum + (mat ? Calc.materialEffectivePrice(mat, State.data.aggregateTrucks) * (item.qty || 0) : 0);
    }, 0);
    var payroll = Calc.payrollPerM3(plant, State.data.plants, State.data.personnelSummary);
    var depr = Calc.plantDeprPerM3(plant);
    var utilities = Calc.utilitiesPerM3(plant);
    var costPerM3 = materialsCost + payroll + depr + utilities;
    var priceNet = NumericInput.parseNumber(document.getElementById('rc-f-price-net').value) || 0;
    var margin = priceNet - costPerM3;
    var marginPercent = priceNet > 0 ? (margin / priceNet) * 100 : 0;

    document.getElementById('rc-summary-scope').textContent = 'Себестоимость 1 м³' + (plant ? ' · ' + plant.name : '');
    document.getElementById('rc-summary-cost').textContent = Format.fmt(costPerM3, 2);
    document.getElementById('rc-sum-materials').textContent = Format.fmt(materialsCost, 2);
    document.getElementById('rc-sum-payroll').textContent = Format.fmt(payroll, 2);
    document.getElementById('rc-sum-depr').textContent = Format.fmt(depr, 2);
    document.getElementById('rc-sum-utilities').textContent = Format.fmt(utilities, 2);
    document.getElementById('rc-sum-price').textContent = Format.fmt(priceNet, 2);
    document.getElementById('rc-sum-breakeven').textContent = Format.fmt(costPerM3, 2);
    var marginEl = document.getElementById('rc-sum-margin');
    var marginBox = document.getElementById('rc-sum-margin-box');
    marginEl.textContent = Format.fmt(margin, 0) + ' · ' + Format.fmtNum(marginPercent, 1, '%');
    marginBox.style.background = margin < 0 ? 'var(--bad-bg)' : (marginPercent < 8 ? 'var(--warn-bg)' : 'transparent');
    marginBox.style.color = margin < 0 ? 'var(--bad-fg)' : (marginPercent < 8 ? 'var(--warn-fg)' : 'inherit');
  }

  function selectRecipe(recipe) {
    selectedId = recipe.id;
    items = recipe.items.map(function (i) { return { materialId: i.materialId, qty: i.qty }; });
    document.getElementById('rc-f-name').value = recipe.name;
    NumericInput.setFormattedValue(document.getElementById('rc-f-price-net'), recipe.salePrice);
    NumericInput.setFormattedValue(document.getElementById('rc-f-price-gross'), recipe.salePrice * VAT_MULT);
    document.getElementById('rc-delete-btn').hidden = false;
    document.getElementById('rc-save-btn').textContent = 'Сохранить смесь';
    document.getElementById('rc-detail').hidden = false;
    document.getElementById('rc-summary').hidden = false;
    renderItems();
    renderList();
  }

  function newRecipe() {
    if (!(State.data.materials || []).length) {
      alert('Сначала добавьте хотя бы один материал в справочник «Материалы».');
      return;
    }
    selectedId = null;
    items = [{ materialId: State.data.materials[0].id, qty: '' }];
    document.getElementById('rc-f-name').value = '';
    document.getElementById('rc-f-price-net').value = '';
    document.getElementById('rc-f-price-gross').value = '';
    document.getElementById('rc-delete-btn').hidden = true;
    document.getElementById('rc-save-btn').textContent = 'Добавить смесь';
    document.getElementById('rc-detail').hidden = false;
    document.getElementById('rc-summary').hidden = false;
    renderItems();
    renderList();
  }

  async function handleSave() {
    var name = document.getElementById('rc-f-name').value.trim();
    if (!name) { alert('Укажите название смеси.'); return; }
    var payload = {
      plantId: Plant.currentPlantId(),
      name: name,
      salePrice: NumericInput.parseNumber(document.getElementById('rc-f-price-net').value) || 0,
      items: items.filter(function (i) { return i.materialId; }).map(function (i) { return { materialId: i.materialId, qty: i.qty || 0 }; })
    };
    var btn = document.getElementById('rc-save-btn');
    btn.disabled = true;
    try {
      var result;
      if (selectedId) result = await Api.put('/recipes/' + selectedId, payload);
      else result = await Api.post('/recipes', payload);
      await State.loadAll();
      selectRecipe(result);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    var recipe = (State.data.recipes || []).find(function (r) { return r.id === selectedId; });
    if (!confirm('Удалить смесь «' + (recipe ? recipe.name : '') + '»?')) return;
    try {
      await Api.del('/recipes/' + selectedId);
      await State.loadAll();
      selectedId = null;
      document.getElementById('rc-detail').hidden = true;
      document.getElementById('rc-summary').hidden = true;
      renderList();
    } catch (err) {
      alert(err.message);
    }
  }

  function render() {
    document.getElementById('rc-scope').textContent = (State.currentPlant() && State.currentPlant().name || '') + ' · рецепты и прайс';
    renderList();
    if (selectedId) {
      var recipe = (State.data.recipes || []).find(function (r) { return r.id === selectedId; });
      if (recipe) { renderItems(); return; }
      selectedId = null;
    }
    document.getElementById('rc-detail').hidden = true;
    document.getElementById('rc-summary').hidden = true;
  }

  var initialized = false;
  function init() {
    document.getElementById('page-recipes').innerHTML = HTML;
    document.getElementById('rc-add-btn').addEventListener('click', newRecipe);
    document.getElementById('rc-add-item-btn').addEventListener('click', function () {
      if (!(State.data.materials || []).length) return;
      items.push({ materialId: State.data.materials[0].id, qty: '' });
      renderItems();
    });
    document.getElementById('rc-search').addEventListener('input', function () { searchValue = this.value; renderList(); });
    document.getElementById('rc-save-btn').addEventListener('click', handleSave);
    document.getElementById('rc-delete-btn').addEventListener('click', handleDelete);
    NumericInput.attach(document.getElementById('rc-f-price-net'));
    NumericInput.attach(document.getElementById('rc-f-price-gross'));
    document.getElementById('rc-f-price-net').addEventListener('input', function () {
      var net = NumericInput.parseNumber(this.value) || 0;
      NumericInput.setFormattedValue(document.getElementById('rc-f-price-gross'), net * VAT_MULT);
      updateSummary();
    });
    document.getElementById('rc-f-price-gross').addEventListener('input', function () {
      var gross = NumericInput.parseNumber(this.value) || 0;
      NumericInput.setFormattedValue(document.getElementById('rc-f-price-net'), gross / VAT_MULT);
      updateSummary();
    });
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.RecipesScreen = { show: show };
})();
