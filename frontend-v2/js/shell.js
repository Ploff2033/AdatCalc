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
    // (см. plant-switcher.js): >1 завода И (роль хотя бы менеджера ИЛИ это
    // универсальная ссылка подмены — Plant.isUniversal()). Второе условие
    // при портировании в v2 потерялось: универсальный токен (подмена
    // работника другого завода на время отпуска/больничного) давал
    // Auth.isAtLeast('manager') === false (роль всё ещё null), поэтому
    // select оставался disabled всегда — реальный баг, найден пользователем
    // ("на универсальной ссылке нельзя менять завод"). Иначе — тот же
    // select, просто disabled, чтобы завод всё равно было видно.
    select.disabled = !((Auth.isAtLeast('manager') || Plant.isUniversal()) && plants.length > 1);
  }

  function applyRoleVisibility() {
    var role = Auth.getRole();
    document.getElementById('sb-role-label').textContent = roleLabel(role);
    document.getElementById('sb-user-role').textContent = roleLabel(role);
    document.getElementById('sb-nav-admin').hidden = !Auth.isAtLeast('admin');
    // «Путевые листы» — по просьбе пользователя ("уберём вкладку с рейсами
    // для работников, видна только у админа") сузили с manager+ до
    // admin-only — менеджер больше не видит и не заходит на этот раздел.
    // «Остатки» — видимы менеджеру и выше как раньше; до 25.09.2026
    // анонимный работник вообще не попадал в v2 (см. app.js), поэтому
    // скрытие тут было объявлено в комментарии, но не в коде — теперь,
    // когда анонимная ссылка ведёт в v2 (модуль ДДС), это уже не
    // теоретический случай, доскрываем по-настоящему.
    var wbLink = document.querySelector('#sb-nav-main a[data-route="waybills"]');
    if (wbLink) wbLink.hidden = !Auth.isAtLeast('admin');
    var bottomWbLink = document.querySelector('.bottom-nav a[data-route="waybills"]');
    if (bottomWbLink) bottomWbLink.hidden = !Auth.isAtLeast('admin');
    // «Поступления» — тот же уровень доступа, что и «Путевые листы» (см.
    // router.js::MIN_ROLE.receipts) — только в сайдбаре, в нижнем меню
    // телефона пункта нет вообще (это не сценарий анонимного работника).
    var receiptsLink = document.querySelector('#sb-nav-main a[data-route="receipts"]');
    if (receiptsLink) receiptsLink.hidden = !Auth.isAtLeast('admin');
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
    // Компактная "Выйти" в шапке для телефона (см. index.html) — только
    // для manager/admin. Анонимному работнику скрываем: ему нечего
    // "выходить" (у него нет пароля/сессии, только сохранённая ссылка), а
    // случайный тап стёр бы её через Plant.clearSaved() (см. auth.js).
    var mobileLogout = document.getElementById('sb-logout-btn-mobile');
    if (mobileLogout) mobileLogout.hidden = !role;
  }

  // Колокольчик дефицита в сайдбаре убран по просьбе пользователя —
  // "уведомление о дефиците материалов пусть будет только на дашборде"
  // (там уже есть секция "Остатки на складах", см. screen-dashboard.js).

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
    document.getElementById('sb-logout-btn-mobile').addEventListener('click', async function () {
      await Auth.logout();
    });
  }

  window.Shell = { init: init, render: render, highlightActive: highlightActive };
})();
