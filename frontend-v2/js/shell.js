(function () {
  // Каркас v2: сайдбар (свод завода/роли/навигации) — общий для всех
  // экранов, отрисовывается один раз и обновляется при каждом State.onChange.
  // Роутинг между экранами — в router.js, этот файл только про сайдбар.

  function roleLabel(role) {
    if (role === 'admin') return 'Администратор';
    if (role === 'manager') return 'Менеджер';
    return '—';
  }

  function renderPlantSwitch() {
    var plants = State.data.plants || [];
    var current = State.currentPlant();
    var wrap = document.getElementById('sb-plant-switch');
    var select = document.getElementById('sb-plant-select');
    wrap.hidden = plants.length === 0;
    if (!plants.length) return;

    select.innerHTML = '';
    plants.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    select.value = current ? current.id : '';
    // Переключатель имеет смысл, только если реально есть выбор — как в v1
    // (см. plant-switcher.js): >1 завода и роль хотя бы менеджера. Иначе —
    // тот же select, просто disabled, чтобы завод всё равно было видно.
    select.disabled = !(Auth.isAtLeast('manager') && plants.length > 1);
  }

  function applyRoleVisibility() {
    var role = Auth.getRole();
    document.getElementById('sb-role-label').textContent = roleLabel(role);
    document.getElementById('sb-user-role').textContent = roleLabel(role);
    document.getElementById('sb-nav-admin').hidden = !Auth.isAtLeast('admin');
    // «Путевые листы» и «Остатки» — как и в v1 (waybill-entries.js доступен
    // только manager+) видимы менеджеру и выше; анонимный работник v2 не
    // видит вообще (см. app.js — без роли сразу экран логина).
    var wbLink = document.querySelector('#sb-nav-main a[data-route="waybills"]');
    if (wbLink) wbLink.hidden = !Auth.isAtLeast('manager');
    var bottomWbLink = document.querySelector('.bottom-nav a[data-route="waybills"]');
    if (bottomWbLink) bottomWbLink.hidden = !Auth.isAtLeast('manager');
    // «Персонал» — как и в v1 (auth-ui.js: tabButton('personnel').hidden),
    // весь раздел целиком admin (см. router.js::MIN_ROLE.personnel и
    // screen-personnel.js — не-admin API отдаёт только водителей без
    // оклада/должности, показывать тут менеджеру нечего).
    var personnelLink = document.querySelector('#sb-nav-refs a[data-route="personnel"]');
    if (personnelLink) personnelLink.hidden = !Auth.isAtLeast('admin');
  }

  function highlightActive(routeName) {
    Array.prototype.forEach.call(document.querySelectorAll('nav.nav a[data-route]'), function (a) {
      a.classList.toggle('on', a.dataset.route === routeName);
      if (a.classList.contains('on')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function render() {
    renderPlantSwitch();
    applyRoleVisibility();
  }

  function init() {
    document.getElementById('sb-plant-select').addEventListener('change', function () {
      Plant.setCurrent(this.value);
      State.loadAll().then(render);
      if (window.Router) Router.rerender();
    });

    document.getElementById('sb-logout-btn').addEventListener('click', async function () {
      await Auth.logout();
    });
  }

  window.Shell = { init: init, render: render, highlightActive: highlightActive };
})();
