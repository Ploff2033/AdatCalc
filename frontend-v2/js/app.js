(function () {
  // До 25.09.2026 v2 был только для авторизованных ролей — анонимная
  // ссылка работника (?token=) вела на v1. С модулем ДДС (см. документ
  // "AdatBeton Calc — ДДС и Дашборд (MVP)") форму должны открывать те же
  // анонимные работники по той же ссылке, а мобильные экраны ДДС сделаны
  // только под v2 — поэтому ссылку переключили на v2 целиком (решение
  // пользователя), и здесь, как и в v1 (frontend/js/main.js), появился
  // Plant.resolve() по токену вместо сразу-логина без роли.
  function showLoadError(message) {
    var el = document.getElementById('load-error');
    el.hidden = false;
    el.textContent = message;
  }

  function showLogin() {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app-shell').hidden = true;
  }

  function showApp() {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-shell').hidden = false;
  }

  async function boot() {
    LoginScreen.init();

    var role = await Auth.refreshMe();

    var plants;
    try {
      plants = await Api.get('/plants');
    } catch (err) {
      showLoadError('Не удалось загрузить данные с сервера: ' + err.message);
      return;
    }

    await Plant.resolve(plants, role);
    // Без роли и без валидного токена (обычный заход на /v2/ без ссылки) —
    // экран логина, как раньше. С ролью ИЛИ с резолвнутым по токену заводом
    // (анонимный работник) — идём дальше в приложение.
    if (!role && !Plant.currentPlantId()) {
      showLogin();
      return;
    }
    if (!Plant.currentPlantId() && plants.length) {
      Plant.setCurrent(plants[0].id);
    }

    try {
      await State.loadAll();
    } catch (err) {
      showLoadError('Не удалось загрузить данные с сервера: ' + err.message);
      return;
    }

    showApp();
    Shell.init();
    Shell.render();
    Viewport.init();
    Router.init();

    State.onChange(function () {
      Shell.render();
      Router.rerender();
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
