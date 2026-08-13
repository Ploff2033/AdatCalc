(function () {
  function haversineKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return 0;
    var R = 6371;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return R * c;
  }

  function geocode(query) {
    return ymaps.geocode(query, { results: 1 }).then(function (res) {
      var obj = res.geoObjects.get(0);
      if (!obj) return null;
      var coords = obj.geometry.getCoordinates();
      return { lat: coords[0], lng: coords[1], name: obj.getAddressLine() };
    });
  }

  window.MapUtil = {
    haversineKm: haversineKm,
    geocode: geocode,
    DEFAULT_CENTER: [43.9053, 42.7183] // Кисловодск
  };
})();
