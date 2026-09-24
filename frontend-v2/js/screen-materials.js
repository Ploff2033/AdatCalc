(function () {
  // Материалы — справочник (новый экран поверх макета Materials.dc.html).
  // Тот же API, что и у v1 (frontend/js/tab-materials.js — тот же payload
  // формы), просто новая вёрстка + поле vatRate (ставка НДС закупки, см.
  // Calc.materialNetPrice в shared/calc.js) обычным числовым полем, а не
  // сегментом 22/10/0% из макета — так попросил пользователь. Категория
  // материала (Вяжущие/Инертные/Добавки) из макета — сознательно не делаем,
  // такого поля нет ни в v1, ни в v2 (тоже решение пользователя), список без
  // фильтра по категории.
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap" id="mt-scope">Материалы</span><h1>Материалы</h1></div><div class="page-head-actions"><button class="btn pri sm" id="mt-add-btn">Новый материал</button></div></div>' +
    '<div class="ref-layout">' +
      '<div class="ref-main">' +
        '<input class="inp" id="mt-search" style="max-width:320px" placeholder="Поиск материала" aria-label="Поиск материала">' +
        '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
          '<div class="row head" style="grid-template-columns:1.6fr 44px 110px 64px 64px 1.3fr 110px 70px"><div>Материал</div><div>Ед.</div><div class="r">Закупка с НДС</div><div class="r">НДС</div><div class="r">Потери</div><div>Доставка на завод</div><div class="r">Себест. ед.</div><div class="r">Смеси</div></div>' +
          '<div id="mt-rows"></div>' +
          '<p class="empty-state" id="mt-empty" hidden>Материалов не найдено.</p>' +
        '</section>' +
        '<p class="hint" style="margin:0">Себестоимость единицы: закупка без входящего НДС, с потерями и доставкой на завод.</p>' +
      '</div>' +
      '<aside class="drawer" id="mt-drawer" hidden>' +
        '<div class="drawer-head"><h2 id="mt-drawer-title">Новый материал</h2><button type="button" class="btn ghost icon" id="mt-drawer-close" aria-label="Закрыть">✕</button></div>' +
        '<form id="mt-form">' +
          '<div class="drawer-body">' +
            '<div class="field"><label for="mt-f-name">Название</label><input id="mt-f-name" class="inp" required></div>' +
            '<div class="grid-2">' +
              '<div class="field"><label for="mt-f-unit">Единица</label><select id="mt-f-unit" class="inp"><option>т</option><option>м³</option><option>кг</option><option>л</option></select></div>' +
              '<div class="field" id="mt-f-threshold-field"><label for="mt-f-threshold">Порог остатка на складе</label><input id="mt-f-threshold" class="inp num" inputmode="decimal" value="0"></div>' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer"><button type="button" class="tog" id="mt-f-unlimited" aria-pressed="false"><i></i></button>Неограниченный остаток (вода, газ по трубе и т.п.)</label>' +
            '<div class="grid-3">' +
              '<div class="field"><label for="mt-f-price">Цена закупки с НДС</label><input id="mt-f-price" class="inp num" inputmode="decimal" required></div>' +
              '<div class="field"><label for="mt-f-vat">Ставка НДС</label><div class="unit"><input id="mt-f-vat" class="inp num" inputmode="decimal" value="0"><span>%</span></div></div>' +
              '<div class="field"><label for="mt-f-loss">Потери</label><div class="unit"><input id="mt-f-loss" class="inp num" inputmode="decimal" value="0"><span>%</span></div></div>' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer"><button type="button" class="tog" id="mt-f-own-transport" aria-pressed="false"><i></i></button>Доставка своей техникой</label>' +
            '<div class="grid-2" id="mt-f-truck-fields" hidden>' +
              '<div class="field"><label for="mt-f-truck">Инертовоз</label><select id="mt-f-truck" class="inp"></select></div>' +
              '<div class="field"><label for="mt-f-km">Плечо</label><div class="unit"><input id="mt-f-km" class="inp num" inputmode="decimal" value="0"><span>км</span></div></div>' +
            '</div>' +
            '<div class="field" id="mt-f-manual-field"><label for="mt-f-manual">Доставка вручную (0 — включена в цену)</label><div class="unit"><input id="mt-f-manual" class="inp num" inputmode="decimal" value="0"><span id="mt-f-manual-unit">₽</span></div></div>' +
          '</div>' +
          '<div class="drawer-foot">' +
            '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Закупка без НДС</span><span class="num" id="mt-preview-net">—</span></div>' +
            '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">С учётом потерь</span><span class="num" id="mt-preview-loss">—</span></div>' +
            '<div class="spread" style="font-size:13px"><span style="color:var(--ink-soft)">Доставка</span><span class="num" id="mt-preview-delivery">—</span></div>' +
            '<div class="spread" style="font-weight:600"><span>Себестоимость единицы</span><span class="num" id="mt-preview-cost">—</span></div>' +
            '<p class="banner" id="mt-form-error" hidden></p>' +
            '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">' +
              '<button type="button" class="btn ghost" id="mt-delete-btn" style="color:#8C2217;border-color:#E3B8B1" hidden>Удалить</button>' +
              '<button type="submit" class="btn pri" id="mt-save-btn">Добавить материал</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</aside>' +
    '</div>';

  var searchValue = '';
  var editingId = null;

  function usageCount(materialId) {
    return (State.data.recipes || []).filter(function (r) { return r.items.some(function (i) { return i.materialId === materialId; }); }).length;
  }

  function filteredMaterials() {
    var q = searchValue.trim().toLowerCase();
    var list = State.data.materials || [];
    if (q) list = list.filter(function (m) { return m.name.toLowerCase().indexOf(q) >= 0; });
    return list.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
  }

  function deliveryLabel(mat) {
    if (!mat.delivery || !mat.delivery.ownTransport) {
      return mat.delivery && mat.delivery.manualCostPerUnit > 0 ? 'Вручную' : 'В цене';
    }
    var truck = (State.data.aggregateTrucks || []).find(function (t) { return t.id === mat.delivery.truckId; });
    return 'Своя техника' + (truck ? ' · ' + truck.name : '');
  }

  function renderTable() {
    var materials = filteredMaterials();
    document.getElementById('mt-empty').hidden = materials.length > 0;
    document.getElementById('mt-rows').innerHTML = materials.map(function (m) {
      var trucks = State.data.aggregateTrucks || [];
      var deliveryAddition = Calc.materialDeliveryAdditionPerTon(m, trucks);
      var effective = Calc.materialEffectivePrice(m, trucks);
      return '<div class="row" style="grid-template-columns:1.6fr 44px 110px 64px 64px 1.3fr 110px 70px;min-height:58px;cursor:pointer" data-material-id="' + m.id + '">' +
        '<div class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + m.name + '</span><span class="hint">' + (m.stockUnlimited ? 'остаток не учитывается' : 'порог ' + Format.fmtNum(m.stockThreshold, 0, m.unit)) + '</span></div>' +
        '<div class="hint">' + m.unit + '</div>' +
        '<div class="r num">' + Format.fmtNum(m.price, 2) + '</div>' +
        '<div class="r num hint">' + (m.vatRate > 0 ? Format.fmtNum(m.vatRate, 0, '%') : '—') + '</div>' +
        '<div class="r num hint">' + Format.fmtNum(m.lossPercent, 0, '%') + '</div>' +
        '<div class="stack" style="gap:1px;min-width:0"><span style="font-size:13px">' + deliveryLabel(m) + '</span>' + (deliveryAddition > 0 ? '<span class="num hint">' + Format.fmtNum(deliveryAddition, 2, '₽/' + m.unit) + '</span>' : '') + '</div>' +
        '<div class="r num" style="font-weight:600">' + Format.fmtNum(effective, 2) + '</div>' +
        '<div class="r num hint">' + usageCount(m.id) + '</div>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#mt-rows [data-material-id]'), function (row) {
      row.addEventListener('click', function () {
        var mat = (State.data.materials || []).find(function (m) { return m.id === row.dataset.materialId; });
        if (mat) openForEdit(mat);
      });
    });
  }

  function buildTruckOptions(selectedId) {
    var select = document.getElementById('mt-f-truck');
    select.innerHTML = (State.data.aggregateTrucks || []).map(function (t) {
      return '<option value="' + t.id + '">' + t.name + ' (' + Format.fmtNum(t.capacity, 1, 'т') + ')</option>';
    }).join('');
    var valid = (State.data.aggregateTrucks || []).some(function (t) { return t.id === selectedId; });
    select.value = valid ? selectedId : ((State.data.aggregateTrucks[0] && State.data.aggregateTrucks[0].id) || '');
  }

  function applyDeliveryModeVisibility() {
    var own = document.getElementById('mt-f-own-transport').classList.contains('on');
    document.getElementById('mt-f-truck-fields').hidden = !own;
    document.getElementById('mt-f-manual-field').hidden = own;
  }

  // Порог остатка не имеет смысла для материала, которого "не может стать
  // меньше" — прячем поле, а не просто дизейблим, чтобы не создавать
  // впечатление, что оно всё ещё на что-то влияет.
  function applyUnlimitedVisibility() {
    var unlimited = document.getElementById('mt-f-unlimited').classList.contains('on');
    document.getElementById('mt-f-threshold-field').hidden = unlimited;
  }

  function readDeliveryFromForm() {
    var own = document.getElementById('mt-f-own-transport').classList.contains('on');
    if (!own) {
      return { ownTransport: false, truckId: null, distanceKm: 0, fuelPricePerLiter: 0, ureaPricePerLiter: 0, driverSurcharge: 0, manualCostPerUnit: NumericInput.parseNumber(document.getElementById('mt-f-manual').value) || 0 };
    }
    var plant = State.currentPlant();
    return {
      ownTransport: true, truckId: document.getElementById('mt-f-truck').value,
      distanceKm: NumericInput.parseNumber(document.getElementById('mt-f-km').value) || 0,
      fuelPricePerLiter: (plant && plant.fuelPrice) || 0, ureaPricePerLiter: (plant && plant.ureaPrice) || 0,
      driverSurcharge: 0, manualCostPerUnit: 0
    };
  }

  function updatePreview() {
    var unit = document.getElementById('mt-f-unit').value;
    document.getElementById('mt-f-manual-unit').textContent = '₽/' + unit;
    var price = NumericInput.parseNumber(document.getElementById('mt-f-price').value) || 0;
    var vatRate = NumericInput.parseNumber(document.getElementById('mt-f-vat').value) || 0;
    var lossPercent = NumericInput.parseNumber(document.getElementById('mt-f-loss').value) || 0;
    var delivery = readDeliveryFromForm();
    var fakeMaterial = { price: price, vatRate: vatRate, lossPercent: lossPercent, delivery: delivery };
    var trucks = State.data.aggregateTrucks || [];

    var net = Calc.materialNetPrice(fakeMaterial);
    var deliveryAddition = Calc.materialDeliveryAdditionPerTon(fakeMaterial, trucks);
    var landed = Calc.materialLandedPrice(fakeMaterial, trucks);
    var effective = Calc.materialEffectivePrice(fakeMaterial, trucks);

    document.getElementById('mt-preview-net').textContent = Format.fmtNum(net, 2, '₽/' + unit);
    document.getElementById('mt-preview-loss').textContent = Format.fmtNum(net * (1 + lossPercent / 100), 2, '₽/' + unit);
    document.getElementById('mt-preview-delivery').textContent = Format.fmtNum(deliveryAddition, 2, '₽/' + unit);
    document.getElementById('mt-preview-cost').textContent = Format.fmtNum(effective, 2, '₽/' + unit);
  }

  function openForCreate() {
    editingId = null;
    document.getElementById('mt-drawer-title').textContent = 'Новый материал';
    document.getElementById('mt-save-btn').textContent = 'Добавить материал';
    document.getElementById('mt-delete-btn').hidden = true;
    document.getElementById('mt-form-error').hidden = true;
    document.getElementById('mt-f-name').value = '';
    document.getElementById('mt-f-unit').value = 'т';
    NumericInput.setFormattedValue(document.getElementById('mt-f-threshold'), 0);
    document.getElementById('mt-f-price').value = '';
    NumericInput.setFormattedValue(document.getElementById('mt-f-vat'), 0);
    NumericInput.setFormattedValue(document.getElementById('mt-f-loss'), 0);
    document.getElementById('mt-f-own-transport').classList.remove('on');
    NumericInput.setFormattedValue(document.getElementById('mt-f-km'), 0);
    NumericInput.setFormattedValue(document.getElementById('mt-f-manual'), 0);
    document.getElementById('mt-f-unlimited').classList.remove('on');
    document.getElementById('mt-f-unlimited').setAttribute('aria-pressed', 'false');
    buildTruckOptions('');
    applyDeliveryModeVisibility();
    applyUnlimitedVisibility();
    updatePreview();
    document.getElementById('mt-drawer').hidden = false;
  }

  function openForEdit(mat) {
    editingId = mat.id;
    document.getElementById('mt-drawer-title').textContent = 'Изменить материал';
    document.getElementById('mt-save-btn').textContent = 'Сохранить';
    document.getElementById('mt-delete-btn').hidden = false;
    document.getElementById('mt-form-error').hidden = true;
    document.getElementById('mt-f-name').value = mat.name;
    document.getElementById('mt-f-unit').value = mat.unit;
    NumericInput.setFormattedValue(document.getElementById('mt-f-threshold'), mat.stockThreshold || 0);
    NumericInput.setFormattedValue(document.getElementById('mt-f-price'), mat.price);
    NumericInput.setFormattedValue(document.getElementById('mt-f-vat'), mat.vatRate || 0);
    NumericInput.setFormattedValue(document.getElementById('mt-f-loss'), mat.lossPercent || 0);
    var d = mat.delivery || {};
    document.getElementById('mt-f-own-transport').classList.toggle('on', !!d.ownTransport);
    buildTruckOptions(d.truckId);
    NumericInput.setFormattedValue(document.getElementById('mt-f-km'), d.distanceKm || 0);
    NumericInput.setFormattedValue(document.getElementById('mt-f-manual'), d.manualCostPerUnit || 0);
    document.getElementById('mt-f-unlimited').classList.toggle('on', !!mat.stockUnlimited);
    document.getElementById('mt-f-unlimited').setAttribute('aria-pressed', mat.stockUnlimited ? 'true' : 'false');
    applyDeliveryModeVisibility();
    applyUnlimitedVisibility();
    updatePreview();
    document.getElementById('mt-drawer').hidden = false;
  }

  function closeDrawer() { document.getElementById('mt-drawer').hidden = true; }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('mt-form-error');
    errorEl.hidden = true;
    var payload = {
      plantId: Plant.currentPlantId(),
      name: document.getElementById('mt-f-name').value.trim(),
      unit: document.getElementById('mt-f-unit').value,
      price: NumericInput.parseNumber(document.getElementById('mt-f-price').value) || 0,
      vatRate: NumericInput.parseNumber(document.getElementById('mt-f-vat').value) || 0,
      lossPercent: NumericInput.parseNumber(document.getElementById('mt-f-loss').value) || 0,
      stockThreshold: NumericInput.parseNumber(document.getElementById('mt-f-threshold').value) || 0,
      stockUnlimited: document.getElementById('mt-f-unlimited').classList.contains('on'),
      delivery: readDeliveryFromForm()
    };
    if (!payload.name) { errorEl.textContent = 'Укажите название материала.'; errorEl.hidden = false; return; }
    try {
      if (editingId) await Api.put('/materials/' + editingId, payload);
      else await Api.post('/materials', payload);
      await State.loadAll();
      closeDrawer();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    var mat = (State.data.materials || []).find(function (m) { return m.id === editingId; });
    if (!confirm('Удалить материал «' + (mat ? mat.name : '') + '»?')) return;
    try {
      await Api.del('/materials/' + editingId);
      await State.loadAll();
      closeDrawer();
      render();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.blockingRecipes) {
        alert('Материал используется в смесях: ' + err.data.blockingRecipes.join(', ') + '. Сначала уберите его оттуда.');
      } else {
        alert(err.message);
      }
    }
  }

  function render() {
    document.getElementById('mt-scope').textContent = (State.currentPlant() && State.currentPlant().name || '') + ' · склад и закупка';
    renderTable();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-materials').innerHTML = HTML;
    document.getElementById('mt-add-btn').addEventListener('click', openForCreate);
    document.getElementById('mt-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('mt-search').addEventListener('input', function () { searchValue = this.value; renderTable(); });
    document.getElementById('mt-form').addEventListener('submit', handleSubmit);
    document.getElementById('mt-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('mt-f-own-transport').addEventListener('click', function () {
      this.classList.toggle('on');
      this.setAttribute('aria-pressed', this.classList.contains('on') ? 'true' : 'false');
      applyDeliveryModeVisibility();
      updatePreview();
    });
    document.getElementById('mt-f-unlimited').addEventListener('click', function () {
      this.classList.toggle('on');
      this.setAttribute('aria-pressed', this.classList.contains('on') ? 'true' : 'false');
      applyUnlimitedVisibility();
    });
    ['mt-f-unit', 'mt-f-price', 'mt-f-vat', 'mt-f-loss', 'mt-f-truck', 'mt-f-km', 'mt-f-manual'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', updatePreview);
      document.getElementById(id).addEventListener('change', updatePreview);
    });
    ['mt-f-threshold', 'mt-f-price', 'mt-f-vat', 'mt-f-loss', 'mt-f-km', 'mt-f-manual'].forEach(function (id) {
      NumericInput.attach(document.getElementById(id));
    });
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render();
  }

  window.MaterialsScreen = { show: show };
})();
