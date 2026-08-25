(function () {
  var currentId = null;
  var currentToken = null;
  var lastError = null;

  function readUrlPlantId() {
    var params = new URLSearchParams(location.search);
    return params.get('plant') || null;
  }

  function readUrlToken() {
    var params = new URLSearchParams(location.search);
    return params.get('token') || null;
  }

  function readSavedPlantId() {
    try { return localStorage.getItem('current-plant-id'); } catch (e) { return null; }
  }

  function savePlantId(id) {
    try { localStorage.setItem('current-plant-id', id); } catch (e) { /* ignore */ }
  }

  function readSavedToken() {
    try { return localStorage.getItem('current-plant-token'); } catch (e) { return null; }
  }

  function saveToken(token) {
    try { localStorage.setItem('current-plant-token', token); } catch (e) { /* ignore */ }
  }

  // role: null (работник) | 'manager' | 'admin'. plants: полный список заводов
  // (доступен только admin/manager, у них выбор по id как раньше — ссылка
  // ?plant= или запомненный выбор в этом браузере, иначе первый завод).
  // Работник без роли теперь приходит по ?token=<accessToken> — id завода в
  // URL больше не участвует. Токен резолвится на бэкенде (и там же логируется
  // при каждом обращении — не только на этой первой проверке), поэтому здесь
  // делаем запрос к серверу, а не сверяем локально со списком.
  async function resolve(plants, role) {
    if (role) {
      var urlId = readUrlPlantId();
      var validUrlId = urlId && plants.some(function (p) { return p.id === urlId; }) ? urlId : null;
      var savedId = readSavedPlantId();
      var validSavedId = savedId && plants.some(function (p) { return p.id === savedId; }) ? savedId : null;

      var pick = validUrlId || validSavedId;
      if (pick) {
        currentId = pick;
        lastError = null;
        savePlantId(pick);
        return pick;
      }

      pick = (plants[0] && plants[0].id) || null;
      currentId = pick;
      lastError = pick ? null : 'Нет ни одного завода — создайте завод на вкладке «Дашборд».';
      if (pick) savePlantId(pick);
      return pick;
    }

    var token = readUrlToken() || readSavedToken();
    if (!token) {
      currentId = null;
      currentToken = null;
      lastError = 'Эта ссылка не привязана к заводу. Обратитесь к администратору за правильной ссылкой.';
      return null;
    }

    try {
      var plant = await Api.get('/plants/resolve-token?token=' + encodeURIComponent(token));
      currentId = plant.id;
      currentToken = token;
      lastError = null;
      saveToken(token);
      return currentId;
    } catch (err) {
      currentId = null;
      currentToken = null;
      lastError = err.message;
      return null;
    }
  }

  function setCurrent(id) {
    currentId = id;
    savePlantId(id);
  }

  function currentPlantId() {
    return currentId;
  }

  function getCurrentToken() {
    return currentToken;
  }

  function error() {
    return lastError;
  }

  window.Plant = {
    resolve: resolve,
    setCurrent: setCurrent,
    currentPlantId: currentPlantId,
    currentToken: getCurrentToken,
    error: error
  };
})();
