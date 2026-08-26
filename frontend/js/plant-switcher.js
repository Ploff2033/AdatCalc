(function () {
  function handleChange() {
    var select = document.getElementById('plant-switcher');
    Plant.setCurrent(select.value);
    State.loadAll();
  }

  function init() {
    document.getElementById('plant-switcher').addEventListener('change', handleChange);
  }

  function render() {
    var select = document.getElementById('plant-switcher');
    var visible = ((window.Auth && Auth.isAtLeast('manager')) || Plant.isUniversal()) && State.data.plants.length > 0;
    select.hidden = !visible;
    if (!visible) return;

    var current = Plant.currentPlantId();
    select.innerHTML = '';
    State.data.plants.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    select.value = current;
  }

  window.PlantSwitcher = { init: init, render: render };
})();
