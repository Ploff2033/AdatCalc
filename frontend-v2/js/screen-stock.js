(function () {
  // Заглушка Фазы 1 (см. план v2/redesign, Фаза 2) — таблица остатков,
  // движение и приход/корректировка появятся вместе со схемой
  // stock_on_hand/stock_reserved/stock_movements.
  var HTML =
    '<div class="page-head">' +
      '<div class="page-title-group"><span class="cap">Склад завода</span><h1>Остатки материалов</h1></div>' +
    '</div>' +
    '<section class="card empty-state">' +
      '<p><b>Модуль в разработке.</b></p>' +
      '<p>Учёт остатков, брони под заказы и списания появятся здесь во второй фазе — вместе со схемой ' +
      '<code>stock_on_hand</code>/<code>stock_reserved</code>/<code>stock_movements</code>. ' +
      'Сейчас материалы и рецепты редактируются в <a href="/" target="_blank" rel="noopener">прежнем интерфейсе</a>.</p>' +
    '</section>';

  var initialized = false;
  function init() {
    document.getElementById('page-stock').innerHTML = HTML;
    initialized = true;
  }
  function show() { if (!initialized) init(); }

  window.StockScreen = { show: show };
})();
