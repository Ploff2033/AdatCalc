(function () {
  // Хэш-роутинг между экранами — тот же паттерн, что у v1 (frontend/js/tabs.js:
  // показ/скрытие панелей через hidden + history.replaceState), просто по
  // сайдбар-навигации вместо вкладок сверху. #/v2/... не нужен — весь v2
  // уже живёт под /v2/, хэш внутри него отвечает только за экран.
  // Важно: window.MainScreen/OrdersScreen/... присваиваются своими файлами,
  // которые подключены ПОСЛЕ router.js (см. index.html) — если бы SCREENS
  // был обычным объектом, собранным один раз здесь, на момент его создания
  // все эти window.* ещё были бы undefined, и это undefined осталось бы
  // навсегда (объект больше не перечитывается). Поэтому SCREENS — функция,
  // вызываемая заново на каждый show(), когда все скрипты уже точно загружены.
  function screens() {
    return {
      main: window.MainScreen,
      orders: window.OrdersScreen,
      waybills: window.WaybillsScreen,
      stock: window.StockScreen,
      dashboard: window.DashboardScreen,
      settings: window.SettingsScreen,
      materials: window.MaterialsScreen,
      recipes: window.RecipesScreen,
      fleet: window.FleetScreen,
      clients: window.ClientsScreen,
      personnel: window.PersonnelScreen
    };
  }
  // Справочники (materials/recipes/fleet) — тот же уровень доступа, что и их
  // API на чтение сегодня (write у materials/recipes — manager, у fleet —
  // admin, но САМ экран техники доступен на просмотр и manager'у, кнопка
  // «Добавить» скрыта не-admin — см. screen-fleet.js::render).
  // personnel — единственный, целиком admin: GET /api/employees сам по себе
  // отдаёт не-admin только водителей без оклада/должности (см.
  // backend/handlers/employees.js::list), так что менеджеру тут просто
  // нечего показать полноценно, экран скрыт целиком (см. и
  // shell.js::applyRoleVisibility).
  // 'cash' (ДДС) намеренно НЕ в этом списке — открыт всем, включая
  // анонимного работника по токену (см. app.js — с 25.09.2026 его ссылка
  // ведёт сюда же, в v2), это и есть основной сценарий модуля.
  var MIN_ROLE = { dashboard: 'admin', waybills: 'manager', settings: 'manager', materials: 'manager', recipes: 'manager', fleet: 'manager', personnel: 'admin', clients: 'manager', stock: 'manager' };
  var current = null;

  function routeFromHash() {
    var h = location.hash.replace(/^#\/?/, '');
    return h || 'main';
  }

  function allowed(route) {
    var min = MIN_ROLE[route];
    return !min || Auth.isAtLeast(min);
  }

  function show(route) {
    if (window.Viewport) Viewport.applyBottomNavVisibility();
    var SCREENS = screens();
    if (!SCREENS[route] || !allowed(route)) route = 'main';
    Array.prototype.forEach.call(document.querySelectorAll('.page[data-route]'), function (el) {
      el.hidden = el.dataset.route !== route;
    });
    Shell.highlightActive(route);
    var screen = SCREENS[route];
    if (screen && screen.show) screen.show();
    current = route;
    if (location.hash.slice(1) !== '/' + route) history.replaceState(null, '', '#/' + route);
  }

  // Перерисовать текущий экран без смены маршрута — после смены завода/после
  // State.loadAll(), когда данные обновились, но пользователь остаётся там же.
  function rerender() {
    if (current) show(current);
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav a[data-route]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        location.hash = '/' + a.dataset.route;
      });
    });
    window.addEventListener('hashchange', function () { show(routeFromHash()); });
    show(routeFromHash());
  }

  window.Router = { init: init, rerender: rerender, show: show };
})();
