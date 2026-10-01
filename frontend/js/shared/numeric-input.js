(function () {
  // Ведущий минус (для полей вроде корректировки остатка — «может быть
  // отрицательным») хранится отдельно от цифр, которые группируются по
  // разрядам как обычно.
  function formatDisplay(raw) {
    if (!raw) return '';
    var negative = raw.charAt(0) === '-';
    if (negative) raw = raw.slice(1);
    var parts = raw.split(/[.,]/);
    var intPart = parts[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var decPart = parts.length > 1 ? parts[1].replace(/\D/g, '').slice(0, 2) : null;
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var result = grouped;
    if (decPart !== null) result += ',' + decPart;
    if (negative) result = result ? '-' + result : '-';
    return result;
  }

  function toRawInputString(value) {
    var negative = /^\s*-/.test(value);
    var stripped = value.replace(/[^\d,.]/g, '');
    return negative ? '-' + stripped : stripped;
  }

  // Считаем не только цифры, но и сам разделитель дробной части как один
  // "юнит" — иначе позицию курсора сразу после только что введённой запятой
  // невозможно отличить от позиции прямо перед следующей цифрой (у обеих
  // одинаковое "число цифр до курсора"), и после переформатирования курсор
  // откатывался на один символ назад — запятая визуально оказывалась как
  // бы "после" курсора, а не там, где её напечатали. Баг был и в v1, и в
  // v2 (общий модуль).
  function countUnitsBefore(str, pos) {
    var count = 0;
    var seenSeparator = false;
    for (var i = 0; i < pos && i < str.length; i++) {
      var ch = str[i];
      if (/[0-9]/.test(ch)) count++;
      else if ((ch === ',' || ch === '.') && !seenSeparator) { count++; seenSeparator = true; }
    }
    return count;
  }

  function positionAfterNUnits(str, n) {
    if (n <= 0) return 0;
    var count = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (/[0-9]/.test(ch) || ch === ',') count++;
      if (count === n) return i + 1;
    }
    return str.length;
  }

  function parseNumber(value) {
    if (!value) return NaN;
    var cleaned = String(value).replace(/[\s ]/g, '').replace(',', '.');
    if (cleaned === '') return NaN;
    return parseFloat(cleaned);
  }

  function setFormattedValue(input, num) {
    if (num === '' || num === null || num === undefined || !isFinite(num)) {
      input.value = '';
      return;
    }
    input.value = formatDisplay(String(num).replace('.', ','));
  }

  function attach(input) {
    input.setAttribute('inputmode', 'decimal');
    // На телефоне (especially iOS Safari/Chrome с цифровой клавиатурой
    // inputmode="decimal") синхронная перезапись el.value + setSelectionRange
    // ПРЯМО ВНУТРИ обработчика 'input' конфликтует с внутренним состоянием
    // виртуальной клавиатуры — она не успевает закоммитить только что
    // введённый символ до того, как мы меняем value под ней, и следующие
    // нажатия начинают молча проглатываться (в поле остаётся только первая
    // введённая цифра, дальше как будто ничего не печатается). На
    // десктопе с физической клавиатурой это не проявляется — нашли на
    // телефоне (жалоба пользователя: "Цена за м³" на мобильном показывает
    // только "5" из введённого числа). Стандартное решение для этого класса
    // багов у маскированных полей — не трогать DOM синхронно в обработчике,
    // а отложить на ближайший кадр отрисовки (requestAnimationFrame), чтобы
    // клавиатура успела закоммитить свой символ первой. pending — схлопывает
    // несколько событий 'input' за один кадр в одну перезапись по
    // АКТУАЛЬНОМУ el.value на момент кадра, а не по значению на момент
    // события (иначе откатили бы более позднее нажатие).
    var pending = false;
    input.addEventListener('input', function (e) {
      if (pending) return;
      pending = true;
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () {
        pending = false;
        var el = e.target;
        var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
        var unitsBefore = countUnitsBefore(el.value, caret);
        var formatted = formatDisplay(toRawInputString(el.value));
        if (formatted === el.value) return;
        el.value = formatted;
        var newCaret = positionAfterNUnits(formatted, unitsBefore);
        el.setSelectionRange(newCaret, newCaret);
      });
    });
  }

  window.NumericInput = {
    attach: attach,
    parseNumber: parseNumber,
    setFormattedValue: setFormattedValue
  };
})();
