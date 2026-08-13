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
    if (tabName === 'location' && window.LocationTab) {
      window.LocationTab.onShow();
    }
    if (location.hash.slice(1) !== tabName) {
      history.replaceState(null, '', '#' + tabName);
    }
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () { activate(btn.dataset.tab); });
  });

  window.addEventListener('hashchange', function () {
    var tab = location.hash.slice(1);
    if (buttons.some(function (b) { return b.dataset.tab === tab; })) activate(tab);
  });

  function init() {
    var initial = location.hash.slice(1);
    var valid = buttons.some(function (b) { return b.dataset.tab === initial; });
    activate(valid ? initial : 'personnel');
  }

  window.Tabs = { init: init, activate: activate };
})();
