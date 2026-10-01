(function () {
  // Мобильный экран «Расчёт» (макет MobileCalc.dc.html) — своя разметка под
  // телефон, но те же формулы: вся математика идёт через OrderCalc.run(), ту
  // же самую, что использует screen-main.js на десктопе (см. order-calc.js).
  // Верхний бар с заводом/переключателем — общий сайдбар приложения, он уже
  // складывается в горизонтальную шапку на этой ширине (см. styles.css).
  var VAT_MULT = 1.22;
  var HTML =
    '<div class="mobile-page mobile-page-flat">' +
      // Свой компактный хедер экрана (завод · роль / "Расчёт") — заменяет
      // собой название программы в общей шапке-сайдбаре (см. CSS
      // body[data-route="main"] .sidebar-brand в styles.css), чтобы не
      // было двух хедеров подряд с дублирующей информацией — нашёл
      // пользователь на реальном телефоне. Переключатель завода отдельной
      // кнопкой тут не дублируем — рабочий остался в самой шапке-сайдбаре
      // (там же, где и кнопка "выйти"), просто без подписи бренда рядом.
      '<header style="padding:10px 12px;background:var(--sidebar-bg);color:#fff;display:flex;flex-direction:column;gap:2px">' +
        '<span style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--sidebar-muted);font-weight:600" id="mc-header-caption">—</span>' +
        '<h1 style="font-size:22px;font-weight:600;margin:0">Расчёт</h1>' +
      '</header>' +
      '<section class="card-flat stack g10" style="padding:12px">' +
        '<span class="sub">Смесь</span>' +
        '<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px">' +
          '<div class="field"><label for="mc-recipe">Рецепт</label><select id="mc-recipe" class="inp" style="height:48px"></select></div>' +
          '<div class="field"><label for="mc-volume">Объём</label><div class="unit"><input id="mc-volume" class="inp num" style="height:48px;font-size:16px" inputmode="decimal"><span>м³</span></div></div>' +
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
          '<div class="spread"><span class="hint">По прайсу рецепта <span class="num" id="mc-recipe-price">—</span></span><button type="button" class="btn ghost sm" id="mc-reset-price" style="height:32px;padding:0 10px;font-size:12px">Вернуть прайс</button></div>' +
        '</div>' +
      '</section>' +
      '<section class="card-flat stack g10" style="padding:12px">' +
        '<div class="spread" style="min-height:44px"><span class="sub">Доставка</span><label style="display:flex;align-items:center;gap:10px;font-size:13px">Самовывоз<button type="button" class="tog" id="mc-self-pickup" aria-pressed="false"><i></i></button></label></div>' +
        '<div class="field"><label for="mc-delivery-charge">Цена доставки для клиента</label><div class="unit"><input id="mc-delivery-charge" class="inp num" value="500" style="height:48px;font-size:16px" inputmode="decimal"><span>₽/м³</span></div>' +
          '<span class="hint" id="mc-delivery-hint" style="font-size:12px"></span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1.3fr 1fr;gap:8px">' +
          '<div class="field"><label for="mc-mixer">Миксер</label><select id="mc-mixer" class="inp" style="height:48px"></select></div>' +
          '<div class="field"><label for="mc-dist">В одну сторону</label><div class="unit"><input id="mc-dist" class="inp num" style="height:48px;font-size:16px" inputmode="decimal"><span>км</span></div></div>' +
        '</div>' +
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
  var vatGrossMode = false, priceDirty = false, priceNetStored = 0;
  var fuelPriceDirty = false, ureaPriceDirty = false, lastPricePlantId = null;
  var lastCalc = null;

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
  // заказа, в т.ч. и с этого экрана. НЕ привязан к заводу (общий список,
  // см. shared/state.js). Та же логика, что в screen-main.js/tab-main.js.
  function populateClientSelect() {
    var select = document.getElementById('mc-client');
    var prev = selectedClientId || select.value;
    select.innerHTML = '<option value="">— выберите —</option>' +
      (State.data.clients || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); }).map(function (c) {
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
      var created = await Api.post('/clients', { name: name, type: type });
      return { clientId: created.id, clientName: created.name, clientType: created.type };
    }
    var client = (State.data.clients || []).find(function (c) { return c.id === select.value; });
    if (!client) return null;
    return { clientId: client.id, clientName: client.name, clientType: client.type };
  }

  function netFromField(input) {
    var entered = NumericInput.parseNumber(input.value) || 0;
    return vatGrossMode ? entered / VAT_MULT : entered;
  }
  function displayVatField(input, netValue) {
    if (document.activeElement === input) return;
    NumericInput.setFormattedValue(input, vatGrossMode ? netValue * VAT_MULT : netValue);
  }

  // Та же подпись роли, что и в shell.js::roleLabel — мелкая дублированная
  // функция, не общий экспорт (shell.js её наружу не отдаёт).
  function roleLabel(role) {
    if (role === 'admin') return 'администратор';
    if (role === 'manager') return 'менеджер';
    return '—';
  }

  function render() {
    var data = State.data;
    var plant = State.currentPlant();
    var headerCaption = document.getElementById('mc-header-caption');
    if (headerCaption) headerCaption.textContent = (plant ? plant.name : 'Завод не выбран') + ' · ' + roleLabel(Auth.getRole());
    var recipeSelect = document.getElementById('mc-recipe');
    var mixerSelect = document.getElementById('mc-mixer');
    var distInput = document.getElementById('mc-dist');
    var addressInput = document.getElementById('mc-address');
    var selfPickup = document.getElementById('mc-self-pickup').classList.contains('on');
    var placeBtn = document.getElementById('mc-place-order-btn');
    var errorEl = document.getElementById('mc-error');

    [mixerSelect, distInput, addressInput].forEach(function (el) { el.disabled = selfPickup; });
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

    document.getElementById('mc-recipe-price').textContent = Format.fmt(vatGrossMode ? (recipe.salePrice || 0) * VAT_MULT : (recipe.salePrice || 0), 0);

    var saleVolume = NumericInput.parseNumber(document.getElementById('mc-volume').value) || 0;
    var priceInput = document.getElementById('mc-price');
    var priceNet = priceDirty ? priceNetStored : (recipe.salePrice || 0);
    displayVatField(priceInput, priceNet);

    var distRaw = distInput.value;
    var dist = NumericInput.parseNumber(distRaw) || 0;
    var addressFilled = selfPickup || !!addressInput.value.trim();

    var calc = OrderCalc.run({
      plant: plant, recipe: recipe, mixer: mixer, data: data, selfPickup: selfPickup, saleVolume: saleVolume,
      dist: dist, addressFilled: addressFilled, priceNet: priceNet, vatGrossMode: vatGrossMode,
      nbCity: document.getElementById('mc-nb-city').checked, fuelPrice: fuelPrice, ureaPrice: ureaPrice,
      deliveryChargePerM3: NumericInput.parseNumber(document.getElementById('mc-delivery-charge').value) || 0
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
    document.getElementById('mc-delivery-summary-label').textContent = 'Доставка · ' + Format.fmtNum(calc.trips, 0, 'рейс(ов)') + ' · ' + Format.fmtNum(dist, 0, 'км');
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

  async function handlePlaceOrder() {
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
      selectedRecipeId = '';
      priceDirty = false;
      document.getElementById('mc-volume').value = '';
      document.getElementById('mc-dist').value = '';
      document.getElementById('mc-address').value = '';
      document.getElementById('mc-ship-date').value = new Date().toISOString().slice(0, 10);
      // Клиент тоже сбрасывается (в отличие от миксера) — см. tab-main.js.
      selectedClientId = '';
      document.getElementById('mc-client').value = '';
      document.getElementById('mc-client-new-name').value = '';
      document.getElementById('mc-client-new-type').value = 'individual';
      document.getElementById('mc-client-new-fields').hidden = true;
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
    document.getElementById('mc-client').addEventListener('change', function () { selectedClientId = this.value; render(); });
    document.getElementById('mc-client-new-name').addEventListener('input', render);

    document.getElementById('mc-toggle-prices').addEventListener('click', function () {
      document.getElementById('mc-price-fields').hidden = !document.getElementById('mc-price-fields').hidden;
    });
    NumericInput.attach(document.getElementById('mc-fuel-price'));
    document.getElementById('mc-fuel-price').addEventListener('input', function () { fuelPriceDirty = true; render(); });
    NumericInput.attach(document.getElementById('mc-urea-price'));
    document.getElementById('mc-urea-price').addEventListener('input', function () { ureaPriceDirty = true; render(); });

    document.getElementById('mc-place-order-btn').addEventListener('click', handlePlaceOrder);
  }

  window.MobileCalcScreen = { init: init, render: render };
})();
