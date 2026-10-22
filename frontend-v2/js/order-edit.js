(function (root) {
  // Исправление оформленного заказа (change order-edit) — общее для списка
  // заказов (screen-orders.js, mobile-orders.js) и формы расчёта
  // (screen-main.js, mobile-calc.js). Чистые функции без DOM + маленькое
  // состояние «какой заказ сейчас исправляется», переживающее переход между
  // экранами. Экспортируется и как window.OrderEdit, и как CommonJS-модуль —
  // для node:test (backend/test/order-edit-ui.test.js).
  //
  // Права здесь — только чтобы не показывать бесполезную кнопку: окно в
  // сутки, завод работника и блокировки при путевых листах проверяет сервер
  // (backend/handlers/orders.js::update).
  var VAT_MULT = 1.22;
  var WINDOW_MS = 24 * 60 * 60 * 1000;
  var SELF_PICKUP = 'Самовывоз';
  var LOCKED_HINT = 'По заказу есть путевые листы — сначала удалите их';

  function isSelfPickup(order) { return order.mixerName === SELF_PICKUP; }

  // Рецепт заказа среди рецептов завода: по сохранённой ссылке, у старых
  // заказов (до change) — по названию. Не нашли — null, поле остаётся пустым.
  function findRecipe(order, recipes) {
    var list = (recipes || []).filter(function (r) { return !r.plantId || !order.plantId || r.plantId === order.plantId; });
    if (order.recipeId) {
      var byId = list.find(function (r) { return r.id === order.recipeId; });
      if (byId) return byId;
    }
    return list.find(function (r) { return r.name === order.recipeName; }) || null;
  }

  function findMixer(order, mixers) {
    if (isSelfPickup(order)) return null;
    var list = mixers || [];
    if (order.mixerId) {
      var byId = list.find(function (m) { return m.id === order.mixerId; });
      if (byId) return byId;
    }
    return list.find(function (m) { return m.name === order.mixerName; }) || null;
  }

  // 'YYYY-MM-DD' по Москве — дата отгрузки старых заказов, где её не было.
  function moscowYmd(iso) {
    var parts = {};
    new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(new Date(iso)).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  // Значение для <input type="datetime-local"> в часовом поясе браузера.
  function toDatetimeLocal(iso) {
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ctx: { role: null | 'manager' | 'admin', now: Date, recipes }.
  // → { show, enabled, reason }: show — кнопка «Исправить» вообще видна,
  // enabled — можно нажать (иначе reason — подсказка).
  function canEdit(order, ctx) {
    if (!order || order.cancelledAt) return { show: false, enabled: false, reason: '' };
    var now = ctx && ctx.now ? ctx.now : new Date();
    var privileged = ctx && (ctx.role === 'manager' || ctx.role === 'admin');
    if (!privileged && now - new Date(order.insertedAt || order.createdAt) > WINDOW_MS) {
      return { show: false, enabled: false, reason: '' };
    }
    if (order.hasWaybills && !findRecipe(order, ctx && ctx.recipes)) {
      return { show: true, enabled: false, reason: 'Рецепт заказа не найден, а по заказу есть путевые листы' };
    }
    return { show: true, enabled: true, reason: '' };
  }

  // Поля формы из заказа. Память клиента тут не участвует: форма показывает
  // ровно заказ. Чего в данных нет — пусто (рецепт/миксер/клиент удалены),
  // дата отгрузки старых заказов — дата заказа. maxLoad: null — «по
  // вместимости», форма сама покажет вместимость миксера.
  function formState(order, data) {
    var recipe = findRecipe(order, data && data.recipes);
    var mixer = findMixer(order, data && data.mixers);
    var clientExists = (data && data.clients || []).some(function (c) { return c.id === order.clientId; });
    return {
      recipeId: recipe ? recipe.id : '',
      mixerId: mixer ? mixer.id : '',
      clientId: clientExists ? order.clientId : '',
      saleVolume: order.saleVolume,
      shipDate: order.shipDate || moscowYmd(order.createdAt),
      createdAtLocal: toDatetimeLocal(order.createdAt),
      priceNet: order.salePrice,
      vatGross: !!order.vatApplied,
      selfPickup: isSelfPickup(order),
      address: order.address || '',
      distanceKm: isSelfPickup(order) ? '' : order.distanceKm,
      neighborCity: !!order.neighborCity,
      deliveryChargePerM3: order.deliveryChargePerM3,
      maxLoad: order.maxLoadM3 != null ? order.maxLoadM3 : null,
      fuelPrice: order.fuelPricePerLiter,
      ureaPrice: order.ureaPricePerLiter
    };
  }

  // Поля, заблокированные при путевых листах (ключи — как у formState).
  function lockedFields(order) {
    return order && order.hasWaybills ? ['recipeId', 'saleVolume', 'selfPickup', 'mixerId', 'maxLoad'] : [];
  }

  // Снимок полей формы для «есть ли изменения» — одинаково строится из
  // заказа и из payload формы (у них общие имена полей, см. order-calc.js).
  // Сравниваются названия рецепта/миксера: у старых заказов нет id.
  var SNAPSHOT_FIELDS = ['plantId', 'createdAt', 'recipeName', 'saleVolume', 'shipDate', 'clientId', 'salePrice', 'vatApplied',
    'mixerName', 'address', 'distanceKm', 'neighborCity', 'deliveryChargePerM3', 'maxLoadM3', 'fuelPricePerLiter', 'ureaPricePerLiter'];

  function snapshot(o) {
    var out = {};
    SNAPSHOT_FIELDS.forEach(function (f) { out[f] = o[f] === undefined ? null : o[f]; });
    if (out.createdAt) out.createdAt = new Date(out.createdAt).toISOString().slice(0, 16);
    if (!out.shipDate && o.createdAt) out.shipDate = moscowYmd(o.createdAt);
    if (out.mixerName === SELF_PICKUP) { out.distanceKm = 0; out.deliveryChargePerM3 = 0; out.address = ''; out.maxLoadM3 = null; }
    return out;
  }

  function same(a, b) {
    if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.005;
    return (a == null ? '' : a) === (b == null ? '' : b);
  }

  function isDirty(order, payload) {
    if (!payload) return false;
    var a = snapshot(order), b = snapshot(payload);
    return SNAPSHOT_FIELDS.some(function (f) { return !same(a[f], b[f]); });
  }

  // «Было → стало» над кнопкой сохранения: выручка (К оплате), себестоимость
  // (смесь + доставка), прибыль.
  function beforeAfter(order, payload) {
    var cost = function (o) { return (o.mixCost || 0) + (o.deliveryCostTotal || 0); };
    return [
      { label: 'Выручка', before: order.totalRevenue || 0, after: payload ? payload.totalRevenue || 0 : null },
      { label: 'Себестоимость', before: cost(order), after: payload ? cost(payload) : null },
      { label: 'Прибыль', before: order.totalProfit || 0, after: payload ? payload.totalProfit || 0 : null }
    ];
  }

  function moscowShort(iso) {
    var parts = {};
    new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso)).forEach(function (p) { parts[p.type] = p.value; });
    return parts.day + '.' + parts.month + ' ' + parts.hour + ':' + parts.minute;
  }

  // Строки журнала под пометкой «испр.», новые сверху (сервер уже так отдаёт):
  // «20.10 14:32 · Работник · Северный · Объём: 10 → 12 м³, Прибыль: …».
  function editLines(order) {
    return (order && order.edits || []).map(function (e) {
      var parts = e.changes.map(function (c) { return c.text; });
      parts.push(e.profit);
      return moscowShort(e.editedAt) + ' · ' + e.actor + ' · ' + parts.join(', ');
    });
  }

  // Заголовок плашки: «Исправление заказа · СтройИнвест · 20.10.2026».
  function bannerTitle(order) {
    var d = moscowYmd(order.createdAt).split('-');
    return 'Исправление заказа · ' + (order.clientName || 'Без клиента') + ' · ' + d[2] + '.' + d[1] + '.' + d[0];
  }

  // Ошибки сохранения, после которых форма выходит из режима исправления:
  // заказ уже исправили, отменили, окно истекло — оставаться бессмысленно.
  function isTerminalError(err) {
    return !!err && (err.status === 409 || err.status === 403 || err.status === 404) && err.message !== LOCKED_HINT;
  }

  // Какой заказ сейчас исправляется — общий для ПК и телефона, чтобы
  // переход списка → форма и смена брейкпоинта не теряли режим.
  var session = null;
  function start(order) { session = { order: order, applied: { desktop: false, mobile: false } }; }
  function current() { return session ? session.order : null; }
  // Форма забирает заполнение один раз (дальше — правки оператора).
  function takeFill(view) {
    if (!session || session.applied[view]) return false;
    session.applied[view] = true;
    return true;
  }
  // Разметку формы пересобрали (первый показ, переход через брейкпоинт) —
  // поля пустые, заполнение из заказа нужно применить заново.
  function releaseFill(view) {
    if (session) session.applied[view] = false;
  }
  function finish() { session = null; }

  // Из списка заказов: справочники формы (рецепты, материалы) грузятся под
  // текущий завод, поэтому сначала переключаемся на завод заказа — так же,
  // как это делает переключатель заводов в сайдбаре (shell.js).
  async function open(order) {
    start(order);
    if (root.Plant && Plant.currentPlantId() !== order.plantId && (root.Auth && Auth.getRole() || Plant.isUniversal())) {
      Plant.setCurrent(order.plantId);
      await State.loadAll();
      if (root.Shell) Shell.render();
    }
    if (location.hash === '#/main' && root.Router) Router.rerender();
    else location.hash = '/main';
  }

  var api = {
    VAT_MULT: VAT_MULT, LOCKED_HINT: LOCKED_HINT,
    findRecipe: findRecipe, findMixer: findMixer, canEdit: canEdit, formState: formState, lockedFields: lockedFields,
    isDirty: isDirty, beforeAfter: beforeAfter, editLines: editLines, bannerTitle: bannerTitle, isTerminalError: isTerminalError,
    toDatetimeLocal: toDatetimeLocal, start: start, open: open, current: current, takeFill: takeFill, releaseFill: releaseFill, finish: finish
  };
  root.OrderEdit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
