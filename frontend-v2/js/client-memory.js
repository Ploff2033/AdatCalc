(function (root) {
  // Память клиента в форме заказа (change client-list) — чистые функции без
  // DOM, общие для мобильной (mobile-calc.js) и десктопной (screen-main.js)
  // форм: каждая форма сама раскладывает результат по своим input'ам.
  // Экспортируется и как window.ClientMemory, и как CommonJS-модуль — для
  // node:test (backend/test/client-memory-ui.test.js).
  var VAT_MULT = 1.22;

  function money(n) {
    return (isFinite(n) ? n : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }
  function num(n) {
    return (isFinite(n) ? n : 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  }

  // 01.10.2026 (ПК) или 01.10 (телефон — подсказка должна влезть в 360 px).
  function dateLabel(iso, short) {
    var parts = new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });
    return short ? parts.slice(0, 5) : parts;
  }

  // Клиенты, которых видно в форме текущего завода: свои + "Без завода".
  function clientsForPlant(clients, plantId) {
    return (clients || []).filter(function (c) { return !c.plantId || c.plantId === plantId; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
  }

  function belongsToPlant(client, plantId) {
    return !!client && (!client.plantId || client.plantId === plantId);
  }

  // Разовые покупатели (общий «Физлицо») — без памяти: ни цены, ни условий.
  function priceFor(client, recipeId) {
    if (!client || !recipeId || client.walkIn) return null;
    return (client.prices || []).find(function (p) { return p.recipeId === recipeId; }) || null;
  }

  // Базовая цена без НДС: цена клиента по рецепту, иначе прайс рецепта.
  // На неё же возвращает «Вернуть прайс».
  function basePriceNet(client, recipe) {
    if (!recipe) return 0;
    var own = priceFor(client, recipe.id);
    return own ? own.priceNet : (recipe.salePrice || 0);
  }

  // Подсказка под полем цены, обе суммы — в текущем режиме НДС.
  function priceHint(client, recipe, vatGross, short) {
    if (!recipe) return '';
    var k = vatGross ? VAT_MULT : 1;
    var list = money((recipe.salePrice || 0) * k);
    var own = priceFor(client, recipe.id);
    if (!own) return 'По прайсу рецепта ' + list;
    return 'Цена клиента ' + money(own.priceNet * k) + ' от ' + dateLabel(own.updatedAt, short) + ' · прайс ' + list;
  }

  // Что подставить в форму при выборе клиента. Пустые значения памяти не
  // возвращаются (не затирают поля формы); у клиента, условия которого ещё ни
  // разу не записывались, — только режим НДС. Миксер — только существующий.
  // maxLoad: null = "по вместимости" (ограничения нет) — форма его снимает.
  function termsToApply(client, mixers) {
    if (!client || client.walkIn) return null;
    var out = { vatGross: !!client.vatGross };
    if (!client.termsUpdatedAt) return out;
    out.selfPickup = !!client.selfPickup;
    out.neighborCity = !!client.siteNeighborCity;
    out.maxLoad = client.maxLoadM3 > 0 ? client.maxLoadM3 : null;
    if (client.siteAddress) out.address = client.siteAddress;
    if (client.siteDistanceKm != null) out.distanceKm = client.siteDistanceKm;
    if (client.deliveryChargePerM3 != null) out.deliveryChargePerM3 = client.deliveryChargePerM3;
    if (client.mixerId && (mixers || []).some(function (m) { return m.id === client.mixerId; })) out.mixerId = client.mixerId;
    return out;
  }

  // Ввод поля «Макс. загрузка» → ограничение (или null). Пусто, ноль или
  // ровно вместимость — ограничения нет. Больше вместимости — оставляем как
  // ввели (расчёт всё равно идёт по вместимости, см. Calc.loadPerTrip), чтобы
  // поле не "прыгало" под пальцем; в заказ/память такое не попадёт.
  function normalizeMaxLoad(value, mixer) {
    if (!(value > 0)) return null;
    if (mixer && mixer.capacity > 0 && value === mixer.capacity) return null;
    return value;
  }

  // Подсказка под полем «Макс. загрузка».
  // { text, warn: больше вместимости, limited: загрузка меньше вместимости }
  function loadHint(mixer, maxLoad, volume) {
    var capacity = mixer && mixer.capacity > 0 ? mixer.capacity : 0;
    if (!capacity) return { text: '', warn: false, limited: false };
    if (maxLoad > capacity) {
      return { text: 'больше вместимости миксера (' + num(capacity) + ' м³), считаем по ' + num(capacity), warn: true, limited: false };
    }
    if (maxLoad > 0 && maxLoad < capacity) {
      var full = volume > 0 ? Math.max(1, Math.ceil(volume / capacity)) : 1;
      var limited = volume > 0 ? Math.max(1, Math.ceil(volume / maxLoad)) : 1;
      return { text: 'рейсов: ' + limited + ' вместо ' + full, warn: false, limited: true };
    }
    return { text: 'вместимость миксера ' + num(capacity) + ' м³', warn: false, limited: false };
  }

  // Заголовок свёрнутой сводки «Доставка»: при ограничении — «4 × 5 м³».
  // hireRate не null — режим «Найм» (change order-hired-delivery): рейсов
  // нет, вместо них ставка перевозчика.
  function deliverySummary(trips, effectiveLoad, limited, distKm, hireRate) {
    if (hireRate != null) return 'Доставка · Найм · ' + (hireRate > 0 ? num(hireRate) : '—') + ' ₽/м³ · ' + num(distKm) + ' км';
    var tripsPart = limited ? trips + ' × ' + num(effectiveLoad) + ' м³' : num(trips) + ' рейс(ов)';
    return 'Доставка · ' + tripsPart + ' · ' + num(distKm) + ' км';
  }

  var api = {
    clientsForPlant: clientsForPlant, belongsToPlant: belongsToPlant, priceFor: priceFor, basePriceNet: basePriceNet,
    priceHint: priceHint, termsToApply: termsToApply, normalizeMaxLoad: normalizeMaxLoad, loadHint: loadHint,
    deliverySummary: deliverySummary
  };
  root.ClientMemory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
