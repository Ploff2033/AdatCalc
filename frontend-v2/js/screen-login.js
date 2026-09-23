(function () {
  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('login-error');
    errorEl.hidden = true;
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await Auth.login(document.getElementById('login-password').value);
      // Auth.login перезагружает страницу сама при успехе (см. shared/auth.js).
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.disabled = false;
    }
  }

  function init() {
    document.getElementById('login-form').addEventListener('submit', handleSubmit);
  }

  window.LoginScreen = { init: init };
})();
