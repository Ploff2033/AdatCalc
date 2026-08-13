(function () {
  var readyCallbacks = [];
  var loaded = false;
  var loading = false;

  function isKeyConfigured() {
    var key = window.YANDEX_MAPS_API_KEY;
    return !!key && key.trim() !== '' && key.indexOf('ВСТАВЬТЕ') !== 0;
  }

  function notifyAll() {
    var callbacks = readyCallbacks;
    readyCallbacks = [];
    callbacks.forEach(function (cb) { cb(); });
  }

  function load() {
    if (loading || loaded) return;

    if (!isKeyConfigured()) {
      window.YandexMapsUnavailable = true;
      notifyAll();
      return;
    }

    loading = true;
    var script = document.createElement('script');
    script.src = 'https://api-maps.yandex.ru/2.1/?apikey=' + encodeURIComponent(window.YANDEX_MAPS_API_KEY) + '&lang=ru_RU&load=package.full';
    script.onload = function () {
      ymaps.ready(function () {
        loaded = true;
        notifyAll();
      });
    };
    script.onerror = function () {
      window.YandexMapsUnavailable = true;
      notifyAll();
    };
    document.head.appendChild(script);
  }

  function whenReady(cb) {
    if (loaded || window.YandexMapsUnavailable) {
      cb();
      return;
    }
    readyCallbacks.push(cb);
    load();
  }

  window.YandexLoader = { whenReady: whenReady };
})();
