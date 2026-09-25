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
    // «Путевые листы» и «Остатки» — видимы менеджеру и выше; до 25.09.2026
    // анонимный работник вообще не попадал в v2 (см. app.js), поэтому
    // скрытие «Остатки» тут было объявлено в комментарии, но не в коде —
    // теперь, когда анонимная ссылка ведёт в v2 (модуль ДДС), это уже не
    // теоретический случай, доскрываем по-настоящему.
    var wbLink = document.querySelector('#sb-nav-main a[data-route="waybills"]');
    if (wbLink) wbLink.hidden = !Auth.isAtLeast('manager');
    var bottomWbLink = document.querySelector('.bottom-nav a[data-route="waybills"]');
    if (bottomWbLink) bottomWbLink.hidden = !Auth.isAtLeast('manager');
    var stockLink = document.querySelector('#sb-nav-main a[data-route="stock"]');
    if (stockLink) stockLink.hidden = !Auth.isAtLeast('manager');
    // «Персонал» — как и в v1 (auth-ui.js: tabButton('personnel').hidden),
    // весь раздел целиком admin (см. router.js::MIN_ROLE.personnel и
    // screen-personnel.js — не-admin API отдаёт только водителей без
    // оклада/должности, показывать тут менеджеру нечего).
    var personnelLink = document.querySelector('#sb-nav-refs a[data-route="personnel"]');
    if (personnelLink) personnelLink.hidden = !Auth.isAtLeast('admin');
    // Весь блок «Справочники» (Клиенты/Материалы/Смеси/Персонал/Техника) —
    // каждый пункт и так manager+/admin в MIN_ROLE (router.js), но раньше
    // анонимный работник не мог сюда попасть вообще, так что скрывать
    // ссылки было незачем. Теперь может (см. app.js) — прячем группу
    // целиком, а не оставляем видимыми, но ведущими в никуда ссылками
    // (тот же принцип, что и с waybills/stock выше). Тот же приём, что и в
    // v1 (auth-ui.js прячет вкладки Материалы/Техника/Персонал целиком).
    var refsGroup = document.querySelector('.sidebar-refs');
    if (refsGroup) refsGroup.hidden = !Auth.isAtLeast('manager');
  }

  // Колокольчик дефицита — материалы ТЕКУЩЕГО завода (State.data.materials
  // уже отфильтрован по нему на бэкенде, см. shared/state.js::withPlantFilter,
  // отдельный запрос не нужен) ниже порога или уже в минусе. Докупить =
  // max(0, порог - доступно) — то же правило, что и в баннере на экране
  // «Остатки» (screen-stock.js), просто вынесено на видное место в сайдбаре.
  function renderBell() {
    var wrap = document.getElementById('sb-bell-wrap');
    var visible = Auth.isAtLeast('manager');
    wrap.hidden = !visible;
    if (!visible) return;

    var materials = (State.data.materials || []).filter(function (m) { return !m.stockUnlimited; });
    var deficit = [];
    var warn = [];
    materials.forEach(function (m) {
      var avail = m.stockOnHand - m.stockReserved;
      if (avail < 0) deficit.push(m);
      else if (avail < m.stockThreshold) warn.push(m);
    });
    var total = deficit.length + warn.length;

    var badge = document.getElementById('sb-bell-badge');
    badge.hidden = total === 0;
    badge.textContent = total;
    document.getElementById('sb-bell-btn').classList.toggle('act', total > 0);

    var panel = document.getElementById('sb-bell-panel');
    if (!total) {
      panel.innerHTML = '<div class="sidebar-bell-empty">Дефицита нет — все материалы в норме.</div>';
      return;
    }
    panel.innerHTML = deficit.concat(warn).map(function (m) {
      var avail = m.stockOnHand - m.stockReserved;
      var need = Math.max(0, m.stockThreshold - avail);
      var isDeficit = avail < 0;
      return '<div class="bell-row">' +
        '<div class="stack" style="gap:1px;min-width:0">' +
          '<span style="font-weight:600;font-size:13px">' + m.name + '</span>' +
          '<span class="hint" style="font-size:11px">доступно ' + Format.fmtNum(avail, 1, m.unit) + ' · порог ' + Format.fmtNum(m.stockThreshold, 1, m.unit) + '</span>' +
        '</div>' +
        '<span class="chip ' + (isDeficit ? 'bad' : 'warn') + '" style="flex:none;white-space:nowrap">докупить ' + Format.fmtNum(need, 1, m.unit) + '</span>' +
      '</div>';
    }).join('');
  }

  function toggleBellPanel(force) {
    var panel = document.getElementById('sb-bell-panel');
    panel.hidden = force === undefined ? !panel.hidden : !force;
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
    renderBell();
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

    document.getElementById('sb-bell-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleBellPanel();
    });
    document.addEventListener('click', function (e) {
      var wrap = document.getElementById('sb-bell-wrap');
      if (!wrap.contains(e.target)) toggleBellPanel(false);
    });
  }

  window.Shell = { init: init, render: render, highlightActive: highlightActive };
})();
