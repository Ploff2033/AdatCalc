(function () {
  // Единая точка правды "мобильный экран или нет" — тот же брейкпоинт, что и
  // в styles.css (@media max-width:860px), чтобы JS-переключение
  // desktop/mobile-разметки никогда не разъезжалось с CSS. Экраны main/
  // orders/waybills (см. screen-*.js) на каждый show() решают, чей шаблон
  // (свой десктопный или Mobile*Screen) рисовать в тот же контейнер —
  // поэтому при пересечении брейкпоинта нужно принудительно перерисовать
  // активный экран, а не просто оставить старую разметку висеть.
  var mq = window.matchMedia('(max-width: 860px)');

  function isMobile() { return mq.matches; }

  function init() {
    var handler = function () { if (window.Router) Router.rerender(); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler); // старые Safari
  }

  window.Viewport = { isMobile: isMobile, init: init };
})();
