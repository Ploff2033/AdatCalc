(function () {
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.tab-panel'));

  function activate(tabName) {
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-selected', btn.dataset.tab === tabName ? 'true' : 'false');
    });
    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.tab !== tabName;
    });
    var tabModules = { location: window.LocationTab, main: window.MainTab };
    var mod = tabModules[tabName];
    if (mod && mod.onShow) mod.onShow();
    if (location.hash.slice(1) !== tabName) {
      history.replaceState(null, '', '#' + tabName);
    }
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () { activate(btn.dataset.tab); });
  });

  window.addEventListener('hashchange', function () {
    var tab = location.hash.slice(1);
    var btn = buttons.find(function (b) { return b.dataset.tab === tab; });
    if (btn && !btn.hidden) activate(tab);
  });

  function init() {
    var initial = location.hash.slice(1);
    var initialBtn = buttons.find(function (b) { return b.dataset.tab === initial && !b.hidden; });
    if (initialBtn) {
      activate(initial);
      return;
    }
    var firstVisible = buttons.find(function (b) { return !b.hidden; });
    activate(firstVisible ? firstVisible.dataset.tab : 'main');
  }

  window.Tabs = { init: init, activate: activate };
})();
