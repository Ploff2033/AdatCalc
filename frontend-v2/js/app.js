(function () {
  // v2 — только для авторизованных ролей (менеджер/админ), см. план
  // v2/redesign: "мобильные экраны ... это для залогиненных ролей, НЕ
  // замена текущей анонимной ссылки работника по ?token=" — та ссылка
  // продолжает вести на v1 "/". Поэтому здесь, в отличие от v1, нет
  // Plant.resolve() по токену: без роли — сразу экран логина.
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
    if (!role) {
      showLogin();
      return;
    }

    var plants;
    try {
      plants = await Api.get('/plants');
    } catch (err) {
      showLoadError('Не удалось загрузить данные с сервера: ' + err.message);
      return;
    }
    await Plant.resolve(plants, role);
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
