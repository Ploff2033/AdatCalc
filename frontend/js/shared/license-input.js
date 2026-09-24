// Маска номера водительского удостоверения: XX XX XXXXXX (10 цифр,
// группами 2-2-6) — тот же приём позиционирования курсора, что и в
// NumericInput/PlateInput, только группы фиксированной длины из одних цифр.
(function () {
  var GROUPS = [2, 2, 6];

  function extractDigits(str) {
    return (str || '').replace(/\D/g, '').slice(0, 10);
  }

  function formatDisplay(digits) {
    var out = [];
    var pos = 0;
    GROUPS.forEach(function (len) {
      var chunk = digits.slice(pos, pos + len);
      if (chunk) out.push(chunk);
      pos += len;
    });
    return out.join(' ');
  }

  function countDigitsBefore(str, pos) {
    var count = 0;
    for (var i = 0; i < pos && i < str.length; i++) {
      if (/[0-9]/.test(str[i])) count++;
    }
    return count;
  }

  function positionAfterNDigits(str, n) {
    if (n <= 0) return 0;
    var count = 0;
    for (var i = 0; i < str.length; i++) {
      if (/[0-9]/.test(str[i])) count++;
      if (count === n) return i + 1;
    }
    return str.length;
  }

  function setValue(input, raw) {
    input.value = formatDisplay(extractDigits(raw || ''));
  }

  function attach(input) {
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', 13); // 10 цифр + 2 пробела
    input.addEventListener('input', function (e) {
      var el = e.target;
      var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
      var digitsBefore = countDigitsBefore(el.value, caret);
      var formatted = formatDisplay(extractDigits(el.value));
      el.value = formatted;
      var newCaret = positionAfterNDigits(formatted, digitsBefore);
      el.setSelectionRange(newCaret, newCaret);
    });
  }

  window.LicenseInput = { attach: attach, setValue: setValue };
})();
