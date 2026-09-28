// Маска гос. номера: Х 999 ХХ 999 (буква, 3 цифры, 2 буквы, 2-3 цифры
// региона). Буквы — только кириллические из ГОСТ Р 50577 (визуально
// совпадающие с латиницей), опечатки латиницей на раскладке автоматически
// переводятся в кириллицу.
(function () {
  var LATIN_TO_CYRILLIC = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  var VALID_LETTERS = 'АВЕКМНОРСТУХ';
  var ROLES = ['L', 'D', 'D', 'D', 'L', 'L', 'D', 'D', 'D'];

  function normalizeChar(ch) {
    var upper = ch.toUpperCase();
    return LATIN_TO_CYRILLIC[upper] || upper;
  }

  // Берёт из произвольной строки только символы, подходящие под маску по
  // порядку (буква/цифра на нужной позиции) — остальное молча отбрасывается,
  // как и в NumericInput.
  function extractRaw(str) {
    var result = '';
    for (var i = 0; i < str.length && result.length < ROLES.length; i++) {
      var ch = normalizeChar(str[i]);
      var role = ROLES[result.length];
      if (role === 'D' && /[0-9]/.test(ch)) result += ch;
      else if (role === 'L' && VALID_LETTERS.indexOf(ch) !== -1) result += ch;
    }
    return result;
  }

  function formatDisplay(raw) {
    var groups = [raw.slice(0, 1), raw.slice(1, 4), raw.slice(4, 6), raw.slice(6, 9)];
    return groups.filter(function (g) { return g.length > 0; }).join(' ');
  }

  function countMeaningfulBefore(str, pos) {
    var count = 0;
    for (var i = 0; i < pos && i < str.length; i++) {
      if (str[i] !== ' ') count++;
    }
    return count;
  }

  function positionAfterNMeaningful(str, n) {
    if (n <= 0) return 0;
    var count = 0;
    for (var i = 0; i < str.length; i++) {
      if (str[i] !== ' ') count++;
      if (count === n) return i + 1;
    }
    return str.length;
  }

  function setValue(input, raw) {
    input.value = formatDisplay(extractRaw(raw || ''));
  }

  function attach(input) {
    // Полный номер с 3-значным регионом ("А 123 ВС 777") — 12 символов
    // с пробелами-разделителями (1+3+2+3 значащих + 3 пробела). Было 11 —
    // ровно на один символ меньше, чем нужно для 3-значного региона:
    // maxlength — нативное ограничение браузера, оно обрезает ввод ДО
    // того, как наш JS вообще успевает его переформатировать, поэтому
    // третья цифра региона попросту не давала себя напечатать. С
    // 2-значным регионом ("А 123 ВС 77", 11 символов) баг был не виден —
    // отсюда и жалоба "могу ввести только 2 символа региона".
    input.setAttribute('maxlength', 12);
    input.addEventListener('input', function (e) {
      var el = e.target;
      var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
      var meaningfulBefore = countMeaningfulBefore(el.value, caret);
      var formatted = formatDisplay(extractRaw(el.value));
      el.value = formatted;
      var newCaret = positionAfterNMeaningful(formatted, meaningfulBefore);
      el.setSelectionRange(newCaret, newCaret);
    });
  }

  window.PlateInput = { attach: attach, setValue: setValue };
})();
