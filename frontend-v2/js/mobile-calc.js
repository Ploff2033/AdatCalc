(function () {
  // Мобильный экран «Расчёт» (макет MobileCalc.dc.html) — своя разметка под
  // телефон, но те же формулы: вся математика идёт через OrderCalc.run(), ту
  // же самую, что использует screen-main.js на десктопе (см. order-calc.js).
  // Верхний бар с заводом/переключателем — общий сайдбар приложения, он уже
  // складывается в горизонтальную шапку на этой ширине (см. styles.css).
  var VAT_MULT = 1.22;
  var HTML =
    '<div class="mobile-page mobile-page-flat">' +
      // Режим исправления заказа (change order-edit) — см. screen-main.js.
      '<section class="card-flat stack g10" id="mc-edit-banner" style="padding:12px;background:var(--act-bg)" hidden>' +
        '<div class="spread" style="gap:8px;align-items:flex-start"><b id="mc-edit-title" style="overflow-wrap:anywhere"></b><button type="button" class="btn ghost sm" id="mc-edit-cancel" style="height:44px">Отмена</button></div>' +
        '<div class="field"><label for="mc-edit-created">Дата заказа</label><input id="mc-edit-created" type="datetime-local" class="inp" style="height:48px"></div>' +
        '<div class="field"><label for="mc-edit-plant">Завод</label><select id="mc-edit-plant" class="inp" style="height:48px"></select><span class="hint" id="mc-edit-plant-name"></span></div>' +
        '<p class="hint" id="mc-edit-locked" style="margin:0;color:#8A3410" hidden></p>' +
      '</section>' +
      '<section class="card-flat stack g10" style="padding:12px">' +
        '<span class="sub">Смесь</span>' +
        '<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px">' +
          '<div class="field"><label for="mc-recipe">Рецепт</label><select id="mc-recipe" class="inp" style="height:48px"></select></div>' +
          '<div class="field"><label for="mc-volume">Объём</label><div class="unit short"><input id="mc-volume" class="inp num" style="height:48px;font-size:16px" inputmode="decimal"><span>м³</span></div></div>' +
        '</div>' +
        '<div class="field"><label for="mc-ship-date">Дата отгрузки</label><input id="mc-ship-date" type="date" class="inp" style="height:48px"></div>' +
        '<div class="field"><label for="mc-client">Клиент</label><select id="mc-client" class="inp" style="height:48px"></select></div>' +
        '<div class="stack g8" id="mc-client-new-fields" hidden>' +
          '<div class="field"><label for="mc-client-new-name">Название нового клиента</label><input id="mc-client-new-name" class="inp" style="height:48px" placeholder="ФИО или организация"></div>' +
          '<div class="field"><label for="mc-client-new-type">Тип</label><select id="mc-client-new-type" class="inp" style="height:48px"><option value="individual">Физлицо</option><option value="legal">Юрлицо</option></select></div>' +
        '</div>' +
        '<div class="field"><label for="mc-price">Цена за м³</label>' +
          '<div style="display:grid;grid-template-columns:minmax(0,1fr) 138px;gap:8px">' +
            '<div class="unit"><input id="mc-price" class="inp num" style="height:48px;font-size:16px" inputmode="decimal"><span>₽</span></div>' +
            '<div class="seg" role="group" aria-label="НДС"><button type="button" id="mc-vat-on" style="height:46px">с НДС</button><button type="button" id="mc-vat-off" class="on" style="height:46px">без</button></div>' +
          '</div>' +
          '<div class="spread"><span class="hint" id="mc-price-hint"></span><button type="button" class="btn ghost sm" id="mc-reset-price" style="height:32px;padding:0 10px;font-size:12px">Вернуть прайс</button></div>' +
        '</div>' +
      '</section>' +
      '<section class="card-flat stack g10" style="padding:12px">' +
        '<div class="spread" style="min-height:44px"><span class="sub">Доставка</span><label style="display:flex;align-items:center;gap:10px;font-size:13px">Самовывоз<button type="button" class="tog" id="mc-self-pickup" aria-pressed="false"><i></i></button></label></div>' +
        '<div class="field"><label for="mc-delivery-charge">Цена доставки для клиента</label><div class="unit"><input id="mc-delivery-charge" class="inp num" value="500" style="height:48px;font-size:16px" inputmode="decimal"><span>₽/м³</span></div>' +
          '<span class="hint" id="mc-delivery-hint" style="font-size:12px"></span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);gap:8px">' +
          '<div class="field"><label for="mc-mixer">Миксер</label><select id="mc-mixer" class="inp" style="height:48px"></select></div>' +
          '<div class="field"><label for="mc-dist">Км</label><div class="unit short"><input id="mc-dist" class="inp num" style="height:48px;font-size:16px" inputmode="decimal"><span>км</span></div></div>' +
          '<div class="field"><label for="mc-max-load">Загрузка</label><div class="unit short"><input id="mc-max-load" class="inp num" style="height:48px;font-size:16px" inputmode="decimal"><span>м³</span></div></div>' +
        '</div>' +
        '<span class="hint" id="mc-max-load-hint" style="font-size:12px;margin-top:-4px"></span>' +
        '<div class="field"><label for="mc-address">Адрес доставки</label><input id="mc-address" class="inp" style="height:48px"></div>' +
        '<label style="display:flex;align-items:center;gap:12px;min-height:48px;padding:0 12px;border-radius:4px;background:var(--surface-3);font-size:14px"><input type="checkbox" id="mc-nb-city" style="width:20px;height:20px"><span style="flex:1">Рейс в соседний город</span><span class="num hint" id="mc-nb-hint"></span></label>' +
        '<div class="spread" style="padding-top:10px;border-top:1px dashed var(--border)"><span class="hint" id="mc-fuel-summary"></span><button type="button" class="btn ghost sm" id="mc-toggle-prices" style="height:32px;padding:0 10px;font-size:12px">Изменить</button></div>' +
        '<div class="grid-2" id="mc-price-fields" hidden>' +
          '<div class="field"><label for="mc-fuel-price">Топливо, ₽/л</label><input id="mc-fuel-price" class="inp num" inputmode="decimal"></div>' +
          '<div class="field"><label for="mc-urea-price">AdBlue, ₽/л</label><input id="mc-urea-price" class="inp num" inputmode="decimal"></div>' +
        '</div>' +
      '</section>' +
      '<details open class="card-flat" id="mc-mix-details">' +
        '<summary><span class="sub" id="mc-mix-summary-label">Смесь</span><span class="num" id="mc-mix-summary-val" style="font-weight:600"></span></summary>' +
        '<div class="stack" style="gap:2px;padding-top:8px">' +
          '<div class="kv"><span>Выручка без НДС</span><span class="num" id="mc-mix-revenue"></span></div>' +
          '<div class="kv"><span>Материалы</span><span class="num" id="mc-mix-materials" style="color:var(--ink-soft)"></span></div>' +
          '<div class="kv"><span>ФОТ</span><span class="num" id="mc-mix-payroll" style="color:var(--ink-soft)"></span></div>' +
          '<div class="kv"><span>Амортизация завода</span><span class="num" id="mc-mix-depr" style="color:var(--ink-soft)"></span></div>' +
          '<div class="kv"><span>Коммуналка</span><span class="num" id="mc-mix-utilities" style="color:var(--ink-soft)"></span></div>' +
          '<div style="height:1px;background:var(--border-soft);margin:6px 0"></div>' +
          '<div class="kv"><span>Себестоимость 1 м³</span><span class="num" id="mc-mix-cost-per-m3" style="font-weight:600"></span></div>' +
          '<div class="kv"><span>Себестоимость смеси</span><span class="num" id="mc-mix-cost"></span></div>' +
          '<div class="kv"><span>Запас прочности</span><span class="num" id="mc-mix-safety"></span></div>' +
        '</div>' +
      '</details>' +
      '<details open class="card-flat" id="mc-delivery-details">' +
        '<summary><span class="sub" id="mc-delivery-summary-label">Доставка</span><span class="num" id="mc-delivery-summary-val" style="font-weight:600"></span></summary>' +
        '<div class="stack" style="gap:2px;padding-top:8px">' +
          '<div class="kv"><span>Доход от доставки</span><span class="num" id="mc-delivery-revenue"></span></div>' +
          '<div class="kv"><span>Топливо</span><span class="num" id="mc-delivery-fuel" style="color:var(--ink-soft)"></span></div>' +
          '<div class="kv"><span>Мочевина</span><span class="num" id="mc-delivery-urea" style="color:var(--ink-soft)"></span></div>' +
          '<div class="kv"><span>Платон/доплата</span><span class="num" id="mc-delivery-surcharge" style="color:var(--ink-soft)"></span></div>' +
          '<div class="kv"><span>Амортизация миксера</span><span class="num" id="mc-delivery-amort" style="color:var(--ink-soft)"></span></div>' +
          '<div style="height:1px;background:var(--border-soft);margin:6px 0"></div>' +
          '<div class="kv"><span>Расход на доставку</span><span class="num" id="mc-delivery-cost" style="font-weight:600"></span></div>' +
        '</div>' +
      '</details>' +
    '</div>' +
    '<div class="mobile-sticky mobile-sticky-flat">' +
      '<p class="banner" id="mc-error" hidden style="margin:0"></p>' +
      '<div class="stack" id="mc-edit-diff" style="gap:2px;font-size:12px" hidden></div>' +
      '<div class="mobile-kpi-grid">' +
        '<div class="mobile-kpi dark"><span class="l">К оплате</span><span class="num v" id="mc-pay"></span><span class="num" id="mc-pay-vat" style="font-size:11px;color:var(--sidebar-muted)"></span></div>' +
        '<div class="mobile-kpi"><span class="l">Чистая прибыль</span><span class="num v" id="mc-net-profit"></span><span class="num" id="mc-net-margin" style="font-size:11px"></span></div>' +
        '<div class="mobile-kpi"><span class="l">Прибыль с куба</span><span class="num v" id="mc-profit-per-m3"></span><span class="hint" style="font-size:11px">смесь + доставка</span></div>' +
        '<div class="mobile-kpi"><span class="l">Запас прочности</span><span class="num v" id="mc-safety"></span><span class="num" id="mc-safety-pct" style="font-size:11px"></span></div>' +
      '</div>' +
      '<div class="spread" style="font-size:12px;padding:6px 10px;border-radius:4px;background:var(--surface-3)"><span>Смесь <b class="num" id="mc-split-mix"></b></span><span>Доставка <b class="num" id="mc-split-delivery"></b></span></div>' +
      '<button class="btn pri" id="mc-place-order-btn" style="height:50px;width:100%;font-size:15px">Оформить заказ</button>' +
    '</div>';

  var selectedRecipeId = '', selectedMixerId = '';
  var selectedClientId = ''; // '' | реальный id | '__new__'
  // Ограничение загрузки миксера (м³, сложный подъезд) — null = по вместимости.
  // В поле показывается ограничение или вместимость выбранного миксера.
  var maxLoadLimit = null;
  var vatGrossMode = false, priceDirty = false, priceNetStored = 0;
  var fuelPriceDirty = false, ureaPriceDirty = false, lastPricePlantId = null;
  var lastCalc = null;
  var editCreatedInitial = '';

  function mixerLabel(mixer) {
    return mixer.name + (mixer.licensePlate ? ' (' + mixer.licensePlate + ')' : '');
  }

  function populateSelect(select, items, preferredId, labelFn) {
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— выберите —';
    select.appendChild(placeholder);
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = labelFn ? labelFn(item) : item.name;
      select.appendChild(opt);
    });
    var validId = items.some(function (i) { return i.id === preferredId; }) ? preferredId : '';
    select.value = validId;
    return validId;
  }

  // Клиент — модуль от 25.09.2026 (запрошен Капланом), обязателен у любого
  // заказа, в т.ч. и с этого экрана. С change client-list привязан к заводу:
  // в списке клиенты текущего завода и «Без завода» (ClientMemory). Клиент
  // другого завода (после переключения завода) из выбора выпадает.
  function populateClientSelect() {
    var select = document.getElementById('mc-client');
    var prev = selectedClientId || select.value;
    var plant = State.currentPlant();
    select.innerHTML = '<option value="">— выберите —</option>' +
      ClientMemory.clientsForPlant(State.data.clients, plant ? plant.id : null).map(function (c) {
        return '<option value="' + c.id + '">' + c.name + (c.type === 'legal' ? ' (юрлицо)' : '') + '</option>';
      }).join('') + '<option value="__new__">+ Новый клиент</option>';
    var valid = Array.prototype.some.call(select.options, function (o) { return o.value === prev; });
    select.value = valid ? prev : '';
    selectedClientId = select.value;
    document.getElementById('mc-client-new-fields').hidden = selectedClientId !== '__new__';
  }

  function clientSelectionMissing() {
    var select = document.getElementById('mc-client');
    return !select.value || (select.value === '__new__' && !document.getElementById('mc-client-new-name').value.trim());
  }

  // Резолвится только при реальном оформлении — см. комментарий в
  // screen-main.js::resolveClientForSubmit.
  async function resolveClientForSubmit() {
    var select = document.getElementById('mc-client');
    if (select.value === '__new__') {
      var name = document.getElementById('mc-client-new-name').value.trim();
      if (!name) return null;
      var type = document.getElementById('mc-client-new-type').value;
      var plant = State.currentPlant();
      // withPlantFilter — работнику по ссылке сервер берёт завод из токена.
      var created = await Api.post(State.withPlantFilter('/clients'), { name: name, type: type, plantId: plant ? plant.id : null });
      return { clientId: created.id, clientName: created.name, clientType: created.type };
    }
    var client = (State.data.clients || []).find(function (c) { return c.id === select.value; });
    if (!client) return null;
    return { clientId: client.id, clientName: client.name, clientType: client.type };
  }

  function selectedClient() {
    return (State.data.clients || []).find(function (c) { return c.id === selectedClientId; }) || null;
  }

  function setVatMode(gross) {
    vatGrossMode = gross;
    document.getElementById('mc-vat-on').classList.toggle('on', gross);
    document.getElementById('mc-vat-off').classList.toggle('on', !gross);
  }

  // Память клиента → поля формы. Один раз на выбор клиента (не в render(),
  // иначе каждая перерисовка затирала бы ручную правку оператора). Поля выше
  // клиента (рецепт, объём, дата) не трогаются; пустые значения памяти тоже.
  function applyClientMemory() {
    priceDirty = false;
    if (selectedClientId === '__new__') { setVatMode(false); return; }
    var terms = ClientMemory.termsToApply(selectedClient(), State.data.mixers);
    if (!terms) return;
    setVatMode(terms.vatGross);
    if (!('selfPickup' in terms)) return;
    var pickup = document.getElementById('mc-self-pickup');
    pickup.classList.toggle('on', terms.selfPickup);
    pickup.setAttribute('aria-pressed', terms.selfPickup ? 'true' : 'false');
    if (terms.selfPickup) return; // разовый самовывоз в памяти — объект не подставляем
    if ('address' in terms) document.getElementById('mc-address').value = terms.address;
    if ('distanceKm' in terms) NumericInput.setFormattedValue(document.getElementById('mc-dist'), terms.distanceKm);
    if ('deliveryChargePerM3' in terms) NumericInput.setFormattedValue(document.getElementById('mc-delivery-charge'), terms.deliveryChargePerM3);
    if ('mixerId' in terms) selectedMixerId = terms.mixerId;
    document.getElementById('mc-nb-city').checked = terms.neighborCity;
    maxLoadLimit = terms.maxLoad;
  }

  function netFromField(input) {
    var entered = NumericInput.parseNumber(input.value) || 0;
    return vatGrossMode ? entered / VAT_MULT : entered;
  }
  function displayVatField(input, netValue) {
    if (document.activeElement === input) return;
    NumericInput.setFormattedValue(input, vatGrossMode ? netValue * VAT_MULT : netValue);
  }

  function render() {
    var editing = OrderEdit.current();
    if (editing && OrderEdit.takeFill('mobile')) applyEditFill(editing);
    renderCore();
    renderEditUi();
  }

  function renderCore() {
    var data = State.data;
    var plant = State.currentPlant();
    var recipeSelect = document.getElementById('mc-recipe');
    var mixerSelect = document.getElementById('mc-mixer');
    var distInput = document.getElementById('mc-dist');
    var addressInput = document.getElementById('mc-address');
    var selfPickup = document.getElementById('mc-self-pickup').classList.contains('on');
    var placeBtn = document.getElementById('mc-place-order-btn');
    var errorEl = document.getElementById('mc-error');

    var maxLoadInput = document.getElementById('mc-max-load');
    [mixerSelect, distInput, addressInput, maxLoadInput].forEach(function (el) { el.disabled = selfPickup; });
    document.getElementById('mc-nb-city').disabled = selfPickup;
    document.getElementById('mc-delivery-charge').disabled = selfPickup;

    selectedRecipeId = populateSelect(recipeSelect, data.recipes, selectedRecipeId || recipeSelect.value);
    selectedMixerId = populateSelect(mixerSelect, data.mixers, selectedMixerId || mixerSelect.value, mixerLabel);
    populateClientSelect();
    var recipe = data.recipes.find(function (r) { return r.id === selectedRecipeId; });
    var mixer = data.mixers.find(function (m) { return m.id === selectedMixerId; });

    var pricePlantId = plant ? plant.id : null;
    if (pricePlantId !== lastPricePlantId) { fuelPriceDirty = false; ureaPriceDirty = false; lastPricePlantId = pricePlantId; }
    var fuelPriceInput = document.getElementById('mc-fuel-price');
    if (!fuelPriceDirty) NumericInput.setFormattedValue(fuelPriceInput, (plant && plant.fuelPrice) || 0);
    var fuelPrice = NumericInput.parseNumber(fuelPriceInput.value) || 0;
    var ureaPriceInput = document.getElementById('mc-urea-price');
    if (!ureaPriceDirty) NumericInput.setFormattedValue(ureaPriceInput, (plant && plant.ureaPrice) || 0);
    var ureaPrice = NumericInput.parseNumber(ureaPriceInput.value) || 0;
    document.getElementById('mc-fuel-summary').innerHTML = 'Топливо <b class="num" style="color:var(--ink)">' + Format.fmtNum(fuelPrice, 2) + '</b> · AdBlue <b class="num" style="color:var(--ink)">' + Format.fmtNum(ureaPrice, 0) + '</b> ₽/л';

    var neighborCitySurcharge = (plant && plant.neighborCitySurcharge) || 0;
    document.getElementById('mc-nb-hint').textContent = '+' + Format.fmt(neighborCitySurcharge, 0) + ' водителю';

    if (!recipe) { placeBtn.disabled = true; lastCalc = null; return; }

    var client = selectedClient();
    // На телефоне дата без года — подсказка должна влезть в 360 px.
    document.getElementById('mc-price-hint').textContent = ClientMemory.priceHint(client, recipe, vatGrossMode, true);

    var saleVolume = NumericInput.parseNumber(document.getElementById('mc-volume').value) || 0;
    var priceInput = document.getElementById('mc-price');
    // Базовая цена — цена клиента по рецепту, иначе прайс; на неё же
    // возвращает «Вернуть прайс».
    var priceNet = priceDirty ? priceNetStored : ClientMemory.basePriceNet(client, recipe);
    displayVatField(priceInput, priceNet);

    // Поле «Макс. загрузка»: ограничение или вместимость миксера; пока
    // оператор в нём печатает — не перезаписываем.
    if (document.activeElement !== maxLoadInput) {
      var shownLoad = maxLoadLimit != null ? maxLoadLimit : (mixer && mixer.capacity) || '';
      if (shownLoad === '') maxLoadInput.value = ''; else NumericInput.setFormattedValue(maxLoadInput, shownLoad);
    }
    var loadHint = ClientMemory.loadHint(mixer, maxLoadLimit, saleVolume);
    var loadHintEl = document.getElementById('mc-max-load-hint');
    loadHintEl.hidden = selfPickup || !loadHint.text;
    loadHintEl.textContent = loadHint.text;
    loadHintEl.style.color = loadHint.warn ? '#8C2217' : (loadHint.limited ? '#8A3410' : '');
    maxLoadInput.style.borderColor = loadHint.warn ? '#A62A1E' : (loadHint.limited ? '#B8481A' : '');

    var distRaw = distInput.value;
    var dist = NumericInput.parseNumber(distRaw) || 0;
    var addressFilled = selfPickup || !!addressInput.value.trim();

    var calc = OrderCalc.run({
      plant: plant, recipe: recipe, mixer: mixer, data: data, selfPickup: selfPickup, saleVolume: saleVolume,
      dist: dist, addressFilled: addressFilled, priceNet: priceNet, vatGrossMode: vatGrossMode,
      nbCity: document.getElementById('mc-nb-city').checked, fuelPrice: fuelPrice, ureaPrice: ureaPrice,
      deliveryChargePerM3: NumericInput.parseNumber(document.getElementById('mc-delivery-charge').value) || 0,
      maxLoad: maxLoadLimit
    });

    document.getElementById('mc-mix-summary-label').textContent = 'Смесь · ' + Format.fmtNum(saleVolume, 1, 'м³');
    var mixSummaryEl = document.getElementById('mc-mix-summary-val');
    mixSummaryEl.textContent = (calc.mixProfit >= 0 ? '+' : '') + Format.fmt(calc.mixProfit, 0) + ' · ' + Format.fmtNum(calc.mixMarginPercent, 1, '%');
    mixSummaryEl.style.color = calc.mixProfit >= 0 ? '#1F5239' : '#8C2217';

    document.getElementById('mc-mix-revenue').textContent = Format.fmt(calc.mixRevenue, 0);
    document.getElementById('mc-mix-materials').textContent = Format.fmt(calc.materialsCost, 2) + '/м³';
    document.getElementById('mc-mix-payroll').textContent = Format.fmt(calc.payroll, 2) + '/м³';
    document.getElementById('mc-mix-depr').textContent = Format.fmt(calc.depr, 2) + '/м³';
    document.getElementById('mc-mix-utilities').textContent = Format.fmt(calc.utilities, 2) + '/м³';
    // costPerM3 — себестоимость, в ней по определению нет НДС (это не
    // выручка). В режиме "с НДС" рядом показываем ещё и порог цены с НДС —
    // иначе тестовую цену (введённую с НДС) не с чем сравнить напрямую,
    // см. отзыв пользователя ("пишет 6500, ввожу 7000 с НДС и не перебиваю
    // в плюс" — 6500 без НДС и 7000 с НДС в разных величинах).
    document.getElementById('mc-mix-cost-per-m3').textContent = Format.fmt(calc.costPerM3, 2) + (vatGrossMode ? ' (' + Format.fmt(calc.costPerM3Gross, 2) + ' с НДС)' : '');
    document.getElementById('mc-mix-cost').textContent = Format.fmt(calc.mixCost, 0);
    var safetyEl = document.getElementById('mc-mix-safety');
    safetyEl.textContent = Format.fmt(calc.safetyMargin, 0) + ' ₽/м³';
    safetyEl.style.color = calc.safetyMargin >= 0 ? '#1F5239' : '#8C2217';

    var deliveryDetails = document.getElementById('mc-delivery-details');
    deliveryDetails.hidden = selfPickup;
    deliveryDetails.style.borderColor = calc.deliveryProfit < 0 ? '#E3B8B1' : '';
    document.getElementById('mc-delivery-summary-label').textContent = ClientMemory.deliverySummary(calc.trips, calc.effectiveLoad, calc.loadLimited, dist);
    var deliverySummaryEl = document.getElementById('mc-delivery-summary-val');
    deliverySummaryEl.textContent = (calc.deliveryProfit >= 0 ? '+' : '') + Format.fmt(calc.deliveryProfit, 0);
    deliverySummaryEl.style.color = calc.deliveryProfit >= 0 ? '#1F5239' : '#8C2217';
    document.getElementById('mc-delivery-revenue').textContent = Format.fmt(calc.deliveryRevenue, 0);
    document.getElementById('mc-delivery-fuel').textContent = Format.fmt(calc.fuelCostPerTrip, 0);
    document.getElementById('mc-delivery-urea').textContent = Format.fmt(calc.ureaCostPerTrip, 0);
    document.getElementById('mc-delivery-surcharge').textContent = Format.fmt(calc.platonCostPerTrip + calc.surchargePerTrip, 0);
    document.getElementById('mc-delivery-amort').textContent = Format.fmt(calc.amortCostPerTrip, 0);
    document.getElementById('mc-delivery-cost').textContent = Format.fmt(calc.deliveryCostTotal, 0);

    var deliveryChargeInput = document.getElementById('mc-delivery-charge');
    var deliveryHint = document.getElementById('mc-delivery-hint');
    if (!selfPickup && calc.deliveryProfit < 0 && calc.trips > 0) {
      deliveryChargeInput.style.borderColor = '#A62A1E';
      deliveryHint.style.color = '#8C2217';
      deliveryHint.textContent = 'Доставка в минус. Безубыточно от ' + Format.fmt(calc.deliveryBreakevenPerM3, 0) + '/м³';
    } else {
      deliveryChargeInput.style.borderColor = '';
      deliveryHint.textContent = '';
    }

    document.getElementById('mc-pay').textContent = Format.fmt(calc.totalRevenueDisplayed, 2);
    document.getElementById('mc-pay-vat').textContent = calc.vatAmount > 0 ? 'в т.ч. НДС ' + Format.fmt(calc.vatAmount, 2) : '';
    document.getElementById('mc-net-profit').textContent = Format.fmt(calc.totalProfit, 0);
    document.getElementById('mc-net-margin').textContent = Format.fmtNum(calc.totalMarginPercent, 1, '% рент.');
    document.getElementById('mc-profit-per-m3').textContent = Format.fmt(calc.profitPerM3, 0);
    document.getElementById('mc-safety').textContent = Format.fmt(calc.safetyMargin, 0) + '/м³';
    document.getElementById('mc-safety-pct').textContent = Format.fmtNum(calc.safetyMarginPercent, 1, '%')
      + (vatGrossMode ? ' · порог с НДС ' + Format.fmt(calc.costPerM3Gross, 0) : '');
    document.getElementById('mc-split-mix').textContent = (calc.mixProfit >= 0 ? '+' : '') + Format.fmt(calc.mixProfit, 0);
    document.getElementById('mc-split-delivery').textContent = (calc.deliveryProfit >= 0 ? '+' : '') + Format.fmt(calc.deliveryProfit, 0);

    if (!calc.deliveryReady) {
      placeBtn.disabled = true;
      lastCalc = null;
      errorEl.hidden = true;
      return;
    }
    placeBtn.disabled = false;
    errorEl.hidden = true;
    lastCalc = OrderCalc.toOrderPayload({
      plant: plant, recipe: recipe, mixer: mixer, selfPickup: selfPickup, saleVolume: saleVolume, dist: dist,
      address: addressInput.value.trim(), fuelPrice: fuelPrice, ureaPrice: ureaPrice,
      nbCity: document.getElementById('mc-nb-city').checked, vatGrossMode: vatGrossMode
    }, calc);
    delete lastCalc.createdAt; // проставляется заново в момент нажатия «Оформить», а не на каждый пересчёт
    lastCalc.shipDate = document.getElementById('mc-ship-date').value || null;
  }

  // ---- Исправление заказа (change order-edit), та же логика, что в
  // screen-main.js: поля из заказа, цены топлива/AdBlue — как ручные.
  function applyEditFill(order) {
    var st = OrderEdit.formState(order, State.data);
    selectedRecipeId = st.recipeId;
    selectedMixerId = st.mixerId;
    selectedClientId = st.clientId;
    NumericInput.setFormattedValue(document.getElementById('mc-volume'), st.saleVolume);
    document.getElementById('mc-ship-date').value = st.shipDate;
    setVatMode(st.vatGross);
    priceDirty = true;
    priceNetStored = st.priceNet;
    var pickup = document.getElementById('mc-self-pickup');
    pickup.classList.toggle('on', st.selfPickup);
    pickup.setAttribute('aria-pressed', st.selfPickup ? 'true' : 'false');
    document.getElementById('mc-address').value = st.address;
    if (st.distanceKm === '') document.getElementById('mc-dist').value = '';
    else NumericInput.setFormattedValue(document.getElementById('mc-dist'), st.distanceKm);
    document.getElementById('mc-nb-city').checked = st.neighborCity;
    NumericInput.setFormattedValue(document.getElementById('mc-delivery-charge'), st.deliveryChargePerM3);
    maxLoadLimit = st.maxLoad;
    var plant = State.currentPlant();
    lastPricePlantId = plant ? plant.id : null;
    fuelPriceDirty = true;
    ureaPriceDirty = true;
    NumericInput.setFormattedValue(document.getElementById('mc-fuel-price'), st.fuelPrice);
    NumericInput.setFormattedValue(document.getElementById('mc-urea-price'), st.ureaPrice);
    editCreatedInitial = st.createdAtLocal;
    document.getElementById('mc-edit-created').value = st.createdAtLocal;
  }

  function editPayload(order) {
    if (!lastCalc) return null;
    var client = (State.data.clients || []).find(function (c) { return c.id === selectedClientId; });
    var clientPart = client ? { clientId: client.id, clientName: client.name, clientType: client.type } : { clientId: selectedClientId || null };
    var created = document.getElementById('mc-edit-created').value;
    var createdAt = !created || created === editCreatedInitial ? order.createdAt : new Date(created).toISOString();
    return Object.assign({}, lastCalc, clientPart, { createdAt: createdAt, version: order.version });
  }

  var LOCKABLE = ['mc-recipe', 'mc-volume', 'mc-self-pickup', 'mc-mixer', 'mc-max-load'];

  function renderEditUi() {
    var order = OrderEdit.current();
    var btn = document.getElementById('mc-place-order-btn');
    var diffEl = document.getElementById('mc-edit-diff');
    document.getElementById('mc-edit-banner').hidden = !order;
    diffEl.hidden = !order;
    if (!order) {
      btn.textContent = 'Оформить заказ';
      ['mc-recipe', 'mc-volume', 'mc-self-pickup'].forEach(function (id) { document.getElementById(id).disabled = false; });
      return;
    }
    document.getElementById('mc-edit-title').textContent = OrderEdit.bannerTitle(order);
    var plant = State.currentPlant();
    var canMove = Auth.isAtLeast('manager');
    var plantSelect = document.getElementById('mc-edit-plant');
    var plantName = document.getElementById('mc-edit-plant-name');
    plantSelect.hidden = !canMove;
    plantName.hidden = canMove;
    plantName.textContent = plant ? plant.name : order.plantName;
    if (canMove && document.activeElement !== plantSelect) {
      plantSelect.innerHTML = (State.data.plants || []).map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
      plantSelect.value = plant ? plant.id : order.plantId;
    }
    var locked = OrderEdit.lockedFields(order).length > 0;
    var lockedHint = document.getElementById('mc-edit-locked');
    lockedHint.hidden = !locked;
    lockedHint.textContent = OrderEdit.LOCKED_HINT + ': рецепт, объём, самовывоз, миксер и загрузка не меняются.';
    if (locked) LOCKABLE.forEach(function (id) { document.getElementById(id).disabled = true; });
    else ['mc-recipe', 'mc-volume', 'mc-self-pickup'].forEach(function (id) { document.getElementById(id).disabled = false; });

    var payload = editPayload(order);
    btn.textContent = 'Сохранить исправление';
    btn.disabled = !payload || !OrderEdit.isDirty(order, payload);
    diffEl.innerHTML = OrderEdit.beforeAfter(order, payload).map(function (r) {
      return '<div class="spread"><span>' + r.label + '</span><span class="num">' + Format.fmt(r.before, 0) + ' → ' + (r.after == null ? '—' : Format.fmt(r.after, 0)) + '</span></div>';
    }).join('');
  }

  // afterEdit — выход из исправления: цены топлива/AdBlue заказа были
  // выставлены как ручные, возвращаем текущие. После обычного оформления
  // ручная цена остаётся, как и раньше.
  function resetForm(afterEdit) {
    selectedRecipeId = '';
    priceDirty = false;
    if (afterEdit) { fuelPriceDirty = false; ureaPriceDirty = false; }
    document.getElementById('mc-volume').value = '';
    document.getElementById('mc-dist').value = '';
    document.getElementById('mc-address').value = '';
    document.getElementById('mc-ship-date').value = new Date().toISOString().slice(0, 10);
    // Клиент тоже сбрасывается (в отличие от миксера) — см. tab-main.js.
    selectedClientId = '';
    maxLoadLimit = null;
    document.getElementById('mc-client').value = '';
    document.getElementById('mc-client-new-name').value = '';
    document.getElementById('mc-client-new-type').value = 'individual';
    document.getElementById('mc-client-new-fields').hidden = true;
    editCreatedInitial = '';
    document.getElementById('mc-edit-created').value = '';
  }

  function exitEdit() {
    OrderEdit.finish();
    resetForm(true);
    render();
  }

  async function handleSaveEdit() {
    var errorEl = document.getElementById('mc-error');
    var order = OrderEdit.current();
    var payload = editPayload(order);
    if (!payload) {
      errorEl.textContent = 'Заполните обязательные поля: рецепт, миксер, расстояние и адрес.';
      errorEl.hidden = false;
      return;
    }
    if (clientSelectionMissing()) {
      errorEl.textContent = 'Выберите клиента или укажите название нового.';
      errorEl.hidden = false;
      return;
    }
    var btn = document.getElementById('mc-place-order-btn');
    btn.disabled = true;
    try {
      Object.assign(payload, await resolveClientForSubmit());
      await Api.put(State.withPlantFilter('/orders/' + encodeURIComponent(order.id)), payload);
      OrderEdit.finish();
      await State.loadAll();
      resetForm(true);
      render();
    } catch (err) {
      errorEl.textContent = 'Не удалось сохранить исправление: ' + err.message;
      errorEl.hidden = false;
      if (OrderEdit.isTerminalError(err)) {
        OrderEdit.finish();
        await State.loadAll();
        resetForm(true);
        render();
        errorEl.hidden = false;
      } else {
        render();
      }
    }
  }

  async function handleEditPlantChange() {
    var recipe = State.data.recipes.find(function (r) { return r.id === selectedRecipeId; });
    Plant.setCurrent(this.value);
    await State.loadAll();
    if (window.Shell) Shell.render();
    var same = recipe && State.data.recipes.find(function (r) { return r.name === recipe.name; });
    selectedRecipeId = same ? same.id : '';
    render();
  }

  async function handlePlaceOrder() {
    if (OrderEdit.current()) { await handleSaveEdit(); return; }
    var errorEl = document.getElementById('mc-error');
    if (!lastCalc) {
      errorEl.textContent = 'Заполните обязательные поля: рецепт, миксер, расстояние и адрес.';
      errorEl.hidden = false;
      return;
    }
    if (clientSelectionMissing()) {
      errorEl.textContent = 'Выберите клиента или укажите название нового.';
      errorEl.hidden = false;
      return;
    }
    var btn = document.getElementById('mc-place-order-btn');
    btn.disabled = true;
    try {
      // Резолвится тут (не в render()) — новый клиент создаётся в БД только
      // в момент реального оформления, см. screen-main.js за тем же приёмом.
      var clientPayload = await resolveClientForSubmit();
      if (!clientPayload) {
        errorEl.textContent = 'Выберите клиента или укажите название нового.';
        errorEl.hidden = false;
        return;
      }
      await Api.post('/orders', Object.assign({}, lastCalc, clientPayload, { createdAt: new Date().toISOString() }));
      await State.loadAll();
      resetForm();
      render();
    } catch (err) {
      errorEl.textContent = 'Не удалось оформить заказ: ' + err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    document.getElementById('page-main').innerHTML = HTML;
    OrderEdit.releaseFill('mobile');
    document.getElementById('mc-ship-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('mc-ship-date').addEventListener('change', render);

    document.getElementById('mc-vat-off').addEventListener('click', function () {
      vatGrossMode = false;
      this.classList.add('on');
      document.getElementById('mc-vat-on').classList.remove('on');
      render();
    });
    document.getElementById('mc-vat-on').addEventListener('click', function () {
      vatGrossMode = true;
      this.classList.add('on');
      document.getElementById('mc-vat-off').classList.remove('on');
      render();
    });

    document.getElementById('mc-self-pickup').addEventListener('click', function () {
      this.classList.toggle('on');
      this.setAttribute('aria-pressed', this.classList.contains('on') ? 'true' : 'false');
      render();
    });

    NumericInput.attach(document.getElementById('mc-price'));
    document.getElementById('mc-price').addEventListener('input', function () { priceDirty = true; priceNetStored = netFromField(this); render(); });
    document.getElementById('mc-reset-price').addEventListener('click', function () { priceDirty = false; render(); });

    NumericInput.attach(document.getElementById('mc-delivery-charge'));
    NumericInput.attach(document.getElementById('mc-dist'));
    NumericInput.attach(document.getElementById('mc-volume'));
    document.getElementById('mc-delivery-charge').addEventListener('input', render);
    ['mc-dist', 'mc-address', 'mc-volume'].forEach(function (id) { document.getElementById(id).addEventListener('input', render); });
    document.getElementById('mc-nb-city').addEventListener('change', render);
    document.getElementById('mc-recipe').addEventListener('change', function () { selectedRecipeId = this.value; priceDirty = false; render(); });
    document.getElementById('mc-mixer').addEventListener('change', function () { selectedMixerId = this.value; render(); });
    document.getElementById('mc-client').addEventListener('change', function () { selectedClientId = this.value; applyClientMemory(); render(); });
    NumericInput.attach(document.getElementById('mc-max-load'));
    document.getElementById('mc-max-load').addEventListener('input', function () {
      var mixer = State.data.mixers.find(function (m) { return m.id === selectedMixerId; });
      maxLoadLimit = ClientMemory.normalizeMaxLoad(NumericInput.parseNumber(this.value), mixer);
      render();
    });
    document.getElementById('mc-max-load').addEventListener('blur', render);
    document.getElementById('mc-client-new-name').addEventListener('input', render);

    document.getElementById('mc-toggle-prices').addEventListener('click', function () {
      document.getElementById('mc-price-fields').hidden = !document.getElementById('mc-price-fields').hidden;
    });
    NumericInput.attach(document.getElementById('mc-fuel-price'));
    document.getElementById('mc-fuel-price').addEventListener('input', function () { fuelPriceDirty = true; render(); });
    NumericInput.attach(document.getElementById('mc-urea-price'));
    document.getElementById('mc-urea-price').addEventListener('input', function () { ureaPriceDirty = true; render(); });

    document.getElementById('mc-place-order-btn').addEventListener('click', handlePlaceOrder);
    document.getElementById('mc-edit-cancel').addEventListener('click', exitEdit);
    document.getElementById('mc-edit-created').addEventListener('change', render);
    document.getElementById('mc-edit-plant').addEventListener('change', handleEditPlantChange);
  }

  window.MobileCalcScreen = { init: init, render: render };
})();
