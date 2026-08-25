(function () {
  var role = null; // null (незалогиненный работник) | 'manager' | 'admin'
  var RANK = { manager: 1, admin: 2 };

  function isAtLeast(minRole) {
    return (RANK[role] || 0) >= RANK[minRole];
  }

  function tabButton(name) {
    return document.querySelector('.tab-btn[data-tab="' + name + '"]');
  }

  function applyRoleVisibility() {
    tabButton('personnel').hidden = !isAtLeast('admin');
    tabButton('equipment').hidden = !isAtLeast('manager');
    tabButton('materials').hidden = !isAtLeast('manager');
    tabButton('dashboard').hidden = !isAtLeast('admin');

    var activeBtn = document.querySelector('.tab-btn[aria-selected="true"]');
    if (activeBtn && activeBtn.hidden && window.Tabs) {
      Tabs.activate('main');
    }
    updateAuthButton();
  }

  function updateAuthButton() {
    var btn = document.getElementById('auth-btn');
    if (role === 'admin') {
      btn.textContent = 'Админ · Выйти';
      btn.title = 'Выйти';
    } else if (role === 'manager') {
      btn.textContent = 'Менеджер · Выйти';
      btn.title = 'Выйти';
    } else {
      btn.textContent = '🔒 Войти';
      btn.title = 'Войти';
    }
  }

  async function refreshMe() {
    try {
      var res = await Api.get('/auth/me');
      role = res.role;
    } catch (err) {
      role = null;
    }
    applyRoleVisibility();
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

  function openLoginDialog() {
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-dialog-error').hidden = true;
    document.getElementById('auth-dialog').showModal();
  }

  async function handleAuthBtnClick() {
    if (role) {
      await logout();
    } else {
      openLoginDialog();
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('auth-dialog-error');
    errorEl.hidden = true;
    try {
      await login(document.getElementById('auth-password').value);
      document.getElementById('auth-dialog').close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  function init() {
    document.getElementById('auth-btn').addEventListener('click', handleAuthBtnClick);
    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
    Array.prototype.forEach.call(document.getElementById('auth-dialog').querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { document.getElementById('auth-dialog').close(); });
    });
  }

  function getRole() {
    return role;
  }

  window.Auth = { init: init, refreshMe: refreshMe, isAtLeast: isAtLeast, getRole: getRole };
})();
