(function () {
  function formatDisplay(raw) {
    if (!raw) return '';
    var parts = raw.split(/[.,]/);
    var intPart = parts[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var decPart = parts.length > 1 ? parts[1].replace(/\D/g, '').slice(0, 2) : null;
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var result = grouped;
    if (decPart !== null) result += ',' + decPart;
    return result;
  }

  function toRawInputString(value) {
    return value.replace(/[^\d,.]/g, '');
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
    input.addEventListener('input', function (e) {
      var el = e.target;
      var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
      var digitsBefore = countDigitsBefore(el.value, caret);
      var formatted = formatDisplay(toRawInputString(el.value));
      el.value = formatted;
      var newCaret = positionAfterNDigits(formatted, digitsBefore);
      el.setSelectionRange(newCaret, newCaret);
    });
  }

  window.NumericInput = {
    attach: attach,
    parseNumber: parseNumber,
    setFormattedValue: setFormattedValue
  };
})();
