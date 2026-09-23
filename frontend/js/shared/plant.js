(function () {
  var currentId = null;
  var currentToken = null;
  var isUniversalFlag = false;
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

  // Выбор стартового завода из полного списка: ?plant= в URL, если валиден,
  // иначе запомненный в этом браузере, иначе первый попавшийся. Общее для
  // admin/manager (у них это единственный путь) и для общего токена подмены
  // (у него тоже есть переключатель заводов — см. plant-switcher.js).
  function pickPlantId(plants) {
    var urlId = readUrlPlantId();
    var validUrlId = urlId && plants.some(function (p) { return p.id === urlId; }) ? urlId : null;
    var savedId = readSavedPlantId();
    var validSavedId = savedId && plants.some(function (p) { return p.id === savedId; }) ? savedId : null;
    var pick = validUrlId || validSavedId || (plants[0] && plants[0].id) || null;
    if (pick) savePlantId(pick);
    return pick;
  }

  // role: null (работник) | 'manager' | 'admin'. plants: полный список заводов.
  // Работник без роли приходит по ?token=<accessToken> — либо токен конкретного
  // завода (id завода в URL не участвует), либо общий токен подмены (даёт
  // доступ работника, но с переключателем завода, как у admin/manager — для
  // подмены оператора другого завода на время отпуска/больничного). Токен
  // резолвится на бэкенде (и там же логируется при каждом обращении, не
  // только на этой первой проверке), поэтому здесь запрос к серверу, а не
  // сверка локально со списком.
  async function resolve(plants, role) {
    if (role) {
      var pick = pickPlantId(plants);
      currentId = pick;
      lastError = pick ? null : 'Нет ни одного завода — создайте завод на вкладке «Дашборд».';
      return pick;
    }

    var token = readUrlToken() || readSavedToken();
    if (!token) {
      currentId = null;
      currentToken = null;
      isUniversalFlag = false;
      lastError = 'Эта ссылка не привязана к заводу. Обратитесь к администратору за правильной ссылкой.';
      return null;
    }

    try {
      var result = await Api.get('/plants/resolve-token?token=' + encodeURIComponent(token));
      currentToken = token;
      saveToken(token);
      if (result.universal) {
        isUniversalFlag = true;
        var picked = pickPlantId(plants);
        currentId = picked;
        lastError = picked ? null : 'Нет ни одного завода — создайте завод на вкладке «Дашборд».';
        return currentId;
      }
      isUniversalFlag = false;
      currentId = result.id;
      lastError = null;
      return currentId;
    } catch (err) {
      currentId = null;
      currentToken = null;
      isUniversalFlag = false;
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

  function isUniversal() {
    return isUniversalFlag;
  }

  window.Plant = {
    resolve: resolve,
    setCurrent: setCurrent,
    currentPlantId: currentPlantId,
    currentToken: getCurrentToken,
    isUniversal: isUniversal,
    error: error
  };
})();
