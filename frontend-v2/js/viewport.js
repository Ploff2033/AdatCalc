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

  // .bottom-nav вешается/скрывается через CSS-медиазапрос с тем же условием
  // (max-width:860px) — но это две НЕЗАВИСИМЫЕ проверки браузера (CSS и JS
  // matchMedia), которые в норме совпадают. Если в конкретном браузере/
  // вебвью они почему-то расходятся, страница экрана (десктоп или мобильный
  // шаблон) уже решается через isMobile(), а .bottom-nav — через отдельный
  // @media — рассинхрон именно так и проявлялся ("дублирует меню").
  // applyBottomNavVisibility() убирает саму возможность разъехаться: видимость
  // берётся из ТОГО ЖЕ isMobile(), что и выбор экрана, через [hidden]
  // (которому в styles.css назначен display:none!important).
  function applyBottomNavVisibility() {
    var bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) bottomNav.hidden = !isMobile();
  }

  function init() {
    applyBottomNavVisibility();
    var handler = function () {
      applyBottomNavVisibility();
      if (window.Router) Router.rerender();
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler); // старые Safari
  }

  window.Viewport = { isMobile: isMobile, init: init, applyBottomNavVisibility: applyBottomNavVisibility };
})();
