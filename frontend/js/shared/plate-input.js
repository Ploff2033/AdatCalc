// Маски гос. номеров — два формата по ГОСТ Р 50577, разные у легковых/
// грузовых машин и у прицепов (найдено пользователем: прицепу подсунули
// автомобильную маску, из-за чего его реальный номер обрезался/искажался):
// - PlateInput (машины, в т.ч. миксеры/инертовозы): Х 999 ХХ 999
//   (буква, 3 цифры, 2 буквы, 2-3 цифры региона).
// - TrailerPlateInput (прицепы): ХХ 9999 999
//   (2 буквы, 4 цифры, 2-3 цифры региона) — другой порядок букв/цифр,
//   поэтому не вариант maxlength у той же маски, а отдельная.
// Буквы — только кириллические из ГОСТ (визуально совпадающие с латиницей),
// опечатки латиницей на раскладке автоматически переводятся в кириллицу.
(function () {
  var LATIN_TO_CYRILLIC = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  var VALID_LETTERS = 'АВЕКМНОРСТУХ';

  function normalizeChar(ch) {
    var upper = ch.toUpperCase();
    return LATIN_TO_CYRILLIC[upper] || upper;
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

  // Берёт из произвольной строки только символы, подходящие под маску по
  // порядку (буква/цифра на нужной позиции) — остальное молча отбрасывается,
  // как и в NumericInput. roles — массив 'L'/'D' по порядку значащих
  // символов.
  function extractRaw(str, roles) {
    var result = '';
    for (var i = 0; i < str.length && result.length < roles.length; i++) {
      var ch = normalizeChar(str[i]);
      var role = roles[result.length];
      if (role === 'D' && /[0-9]/.test(ch)) result += ch;
      else if (role === 'L' && VALID_LETTERS.indexOf(ch) !== -1) result += ch;
    }
    return result;
  }

  // groupSizes — размеры групп для отображения через пробел (сумма =
  // roles.length соответствующей маски).
  function formatDisplay(raw, groupSizes) {
    var groups = [];
    var pos = 0;
    groupSizes.forEach(function (size) { groups.push(raw.slice(pos, pos + size)); pos += size; });
    return groups.filter(function (g) { return g.length > 0; }).join(' ');
  }

  function makePlateMask(roles, groupSizes) {
    function setValue(input, raw) {
      input.value = formatDisplay(extractRaw(raw || '', roles), groupSizes);
    }

    function attach(input) {
      // Полный номер с 3-значным регионом — значащие символы + пробелы-
      // разделители между группами (groupSizes.length - 1 пробелов). Было
      // на один меньше нужного для 3-значного региона: maxlength — нативное
      // ограничение браузера, оно обрезает ввод ДО того, как наш JS вообще
      // успевает его переформатировать, поэтому третья цифра региона
      // попросту не давала себя напечатать. С 2-значным регионом баг был не
      // виден — отсюда и жалоба "могу ввести только 2 символа региона".
      input.setAttribute('maxlength', roles.length + groupSizes.length - 1);
      input.addEventListener('input', function (e) {
        var el = e.target;
        var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
        var meaningfulBefore = countMeaningfulBefore(el.value, caret);
        var formatted = formatDisplay(extractRaw(el.value, roles), groupSizes);
        el.value = formatted;
        var newCaret = positionAfterNMeaningful(formatted, meaningfulBefore);
        el.setSelectionRange(newCaret, newCaret);
      });
    }

    return { attach: attach, setValue: setValue, roles: roles, groupSizes: groupSizes };
  }

  window.PlateInput = makePlateMask(['L', 'D', 'D', 'D', 'L', 'L', 'D', 'D', 'D'], [1, 3, 2, 3]);
  window.TrailerPlateInput = makePlateMask(['L', 'L', 'D', 'D', 'D', 'D', 'D', 'D', 'D'], [2, 4, 3]);

  // Для полей, у которых формат может смениться на лету (например, Техника
  // в v2 — один и тот же <input> переиспользуется под миксер/инертовоз ИЛИ
  // прицеп в зависимости от выбранной вкладки, см. screen-fleet.js) — один
  // раз навешивает слушатель, а конкретную маску (PlateInput/TrailerPlateInput)
  // спрашивает заново при каждом нажатии клавиши через resolveMask(), а не
  // фиксирует её на момент attach(), как обычный attach() выше.
  window.PlateInputSwitchable = {
    attach: function (input, resolveMask) {
      input.addEventListener('input', function (e) {
        var mask = resolveMask();
        input.setAttribute('maxlength', mask.roles.length + mask.groupSizes.length - 1);
        var el = e.target;
        var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
        var meaningfulBefore = countMeaningfulBefore(el.value, caret);
        var formatted = formatDisplay(extractRaw(el.value, mask.roles), mask.groupSizes);
        el.value = formatted;
        var newCaret = positionAfterNMeaningful(formatted, meaningfulBefore);
        el.setSelectionRange(newCaret, newCaret);
      });
    },
    // setValue зовёт нужную маску явно (mask — PlateInput или
    // TrailerPlateInput) — её, в отличие от attach(), и так вызывают заново
    // при каждом открытии формы (см. openForCreate/openForEdit), так что
    // просто передаём актуальную маску на момент вызова.
    setValue: function (input, raw, mask) {
      input.value = formatDisplay(extractRaw(raw || '', mask.roles), mask.groupSizes);
    }
  };
})();
