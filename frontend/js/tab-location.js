(function () {
  var DEFAULT_CENTER = [55.7558, 37.6173];
  var map = null;
  var placemark = null;
  var saveTimer = null;
  var initStarted = false;

  function showUnavailable() {
    document.getElementById('plant-map').innerHTML =
      '<div class="map-placeholder">Карта недоступна: не задан API-ключ Яндекс.Карт.<br>Добавьте его в frontend/js/yandex-config.js.</div>';
  }

  function setPlacemarkAndText(lat, lng) {
    var coords = [lat, lng];
    if (placemark) {
      placemark.geometry.setCoordinates(coords);
    } else {
      placemark = new ymaps.Placemark(coords, {}, { draggable: true, preset: 'islands#blueFactoryIcon' });
      map.geoObjects.add(placemark);
      placemark.events.add('dragend', function () {
        var c = placemark.geometry.getCoordinates();
        setPlacemarkAndText(c[0], c[1]);
        scheduleSave(c[0], c[1]);
      });
    }
    document.getElementById('plant-coords-display').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
  }

  function scheduleSave(lat, lng) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      Api.put('/config', { plantLocation: { lat: lat, lng: lng } })
        .then(function () { return State.loadAll(); })
        .catch(function (err) { alert('Не удалось сохранить местоположение завода: ' + err.message); });
    }, 400);
  }

  function ensureMap() {
    if (initStarted) return;
    initStarted = true;
    YandexLoader.whenReady(function () {
      if (window.YandexMapsUnavailable) {
        showUnavailable();
        return;
      }
      var loc = State.data.config.plantLocation;
      var center = loc && loc.lat != null ? [loc.lat, loc.lng] : DEFAULT_CENTER;
      var zoom = loc && loc.lat != null ? 13 : 4;
      map = new ymaps.Map('plant-map', { center: center, zoom: zoom, controls: ['zoomControl'] });
      map.events.add('click', function (e) {
        var coords = e.get('coords');
        setPlacemarkAndText(coords[0], coords[1]);
        scheduleSave(coords[0], coords[1]);
      });
      if (loc && loc.lat != null) {
        setPlacemarkAndText(loc.lat, loc.lng);
      } else {
        document.getElementById('plant-coords-display').textContent = 'Не указано — кликните на карте';
      }
    });
  }

  function onShow() {
    ensureMap();
    if (map) {
      setTimeout(function () { map.container.fitToViewport(); }, 30);
    }
  }

  function render() {
    if (!map) return;
    var loc = State.data.config.plantLocation;
    if (loc && loc.lat != null) {
      setPlacemarkAndText(loc.lat, loc.lng);
    }
  }

  function init() {}

  window.LocationTab = { init: init, render: render, onShow: onShow };
})();
