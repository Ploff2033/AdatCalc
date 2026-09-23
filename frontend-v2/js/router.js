(function () {
  // Хэш-роутинг между экранами — тот же паттерн, что у v1 (frontend/js/tabs.js:
  // показ/скрытие панелей через hidden + history.replaceState), просто по
  // сайдбар-навигации вместо вкладок сверху. #/v2/... не нужен — весь v2
  // уже живёт под /v2/, хэш внутри него отвечает только за экран.
  var SCREENS = {
    main: window.MainScreen,
    orders: window.OrdersScreen,
    waybills: window.WaybillsScreen,
    stock: window.StockScreen,
    dashboard: window.DashboardScreen,
    settings: window.SettingsScreen
  };
  var MIN_ROLE = { dashboard: 'admin', waybills: 'manager', settings: 'manager' };
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
