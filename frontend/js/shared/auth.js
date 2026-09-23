(function () {
  // Общее для v1 и v2 ядро авторизации — состояние роли и запросы к
  // /api/auth/*. Никакой работы с DOM здесь нет: конкретная разметка логина
  // и обновление интерфейса под роль — в каждом фронтенде свои (см.
  // frontend/js/auth-ui.js для v1).
  var role = null; // null (незалогиненный работник) | 'manager' | 'admin'
  var RANK = { manager: 1, admin: 2 };

  function isAtLeast(minRole) {
    return (RANK[role] || 0) >= RANK[minRole];
  }

  async function refreshMe() {
    try {
      var res = await Api.get('/auth/me');
      role = res.role;
    } catch (err) {
      role = null;
    }
    return role;
  }

  // После входа/выхода просто перезагружаем страницу — иначе если самая первая
  // загрузка (ещё до входа) не смогла определить завод, boot() уже завершился
  // досрочно и остаток приложения (вкладки, переключатель завода и т.д.)
  // никогда не инициализируется, даже после успешного логина. Перезагрузка
  // гарантированно прогоняет boot() заново уже с валидной сессией.
  async function login(password) {
    await Api.post('/auth/login', { password: password });
    location.reload();
  }

  async function logout() {
    try {
      await Api.post('/auth/logout', {});
    } catch (err) { /* cookie may already be gone — ignore */ }
    location.reload();
  }

  function getRole() {
    return role;
  }

  window.Auth = { refreshMe: refreshMe, isAtLeast: isAtLeast, getRole: getRole, login: login, logout: logout };
})();
