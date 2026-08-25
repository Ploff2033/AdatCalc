(function () {
  function initTheme() {
    var btn = document.getElementById('theme-btn');
    var saved = localStorage.getItem('theme-pref');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var effectiveCurrent = current || (prefersDark ? 'dark' : 'light');
      var next = effectiveCurrent === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme-pref', next);
    });
  }

  function showLoadError(message) {
    var el = document.getElementById('load-error');
    el.hidden = false;
    el.textContent = message;
  }

  function renderAll() {
    PersonnelTab.render();
    MaterialsTab.render();
    EquipmentTab.render();
    LocationTab.render();
    MainTab.render();
    OrdersTab.render();
    DashboardTab.render();
    PlantSwitcher.render();
  }

  async function boot() {
    initTheme();
    Auth.init();
    await Auth.refreshMe();

    var plants;
    try {
      plants = await Api.get('/plants');
    } catch (err) {
      showLoadError('Не удалось загрузить данные с сервера: ' + err.message + '. Проверьте, что сервер запущен (node server.js).');
      return;
    }
    await Plant.resolve(plants, Auth.getRole());
    if (!Plant.currentPlantId()) {
      showLoadError(Plant.error());
      return;
    }

    try {
      await State.loadAll();
    } catch (err) {
      showLoadError('Не удалось загрузить данные с сервера: ' + err.message + '. Проверьте, что сервер запущен (node server.js).');
      return;
    }
    Tabs.init();

    PersonnelTab.init();
    MaterialsTab.init();
    EquipmentTab.init();
    LocationTab.init();
    MainTab.init();
    OrdersTab.init();
    DashboardTab.init();
    PlantSwitcher.init();

    renderAll();
    State.onChange(renderAll);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
