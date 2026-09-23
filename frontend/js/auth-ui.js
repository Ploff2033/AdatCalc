(function () {
  // DOM-часть авторизации для v1 (диалог входа, кнопка в шапке, видимость
  // вкладок по роли) — сама роль и запросы к /api/auth/* теперь в
  // frontend/js/shared/auth.js (общее ядро для v1 и v2).
  function tabButton(name) {
    return document.querySelector('.tab-btn[data-tab="' + name + '"]');
  }

  function applyRoleVisibility() {
    tabButton('personnel').hidden = !Auth.isAtLeast('admin');
    tabButton('equipment').hidden = !Auth.isAtLeast('manager');
    tabButton('materials').hidden = !Auth.isAtLeast('manager');
    tabButton('dashboard').hidden = !Auth.isAtLeast('admin');
    tabButton('waybills').hidden = !Auth.isAtLeast('manager');

    var activeBtn = document.querySelector('.tab-btn[aria-selected="true"]');
    if (activeBtn && activeBtn.hidden && window.Tabs) {
      Tabs.activate('main');
    }
    updateAuthButton();
  }

  function updateAuthButton() {
    var btn = document.getElementById('auth-btn');
    var role = Auth.getRole();
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
    await Auth.refreshMe();
    applyRoleVisibility();
  }

  function openLoginDialog() {
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-dialog-error').hidden = true;
    document.getElementById('auth-dialog').showModal();
  }

  async function handleAuthBtnClick() {
    if (Auth.getRole()) {
      await Auth.logout();
    } else {
      openLoginDialog();
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('auth-dialog-error');
    errorEl.hidden = true;
    try {
      await Auth.login(document.getElementById('auth-password').value);
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

  window.AuthUI = { init: init, refreshMe: refreshMe };
})();
