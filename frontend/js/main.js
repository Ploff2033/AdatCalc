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

  function showLoadError(err) {
    var el = document.getElementById('load-error');
    el.hidden = false;
    el.textContent = 'Не удалось загрузить данные с сервера: ' + err.message + '. Проверьте, что сервер запущен (node server.js).';
  }

  function renderAll() {
    PersonnelTab.render();
    MaterialsTab.render();
    EquipmentTab.render();
    MainTab.render();
  }

  async function boot() {
    initTheme();
    Tabs.init();

    try {
      await State.loadAll();
    } catch (err) {
      showLoadError(err);
      return;
    }

    PersonnelTab.init();
    MaterialsTab.init();
    EquipmentTab.init();
    MainTab.init();

    renderAll();
    State.onChange(renderAll);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
