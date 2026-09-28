(function () {
  // Настоящий .xlsx руками, без библиотек — тот же принцип, что и в
  // zip-writer.js (проект принципиально без сборки/зависимостей). .xlsx —
  // это просто ZIP с несколькими XML-частями (Open Packaging Conventions),
  // поэтому внутри используется уже готовый ZipWriter.build().
  //
  // Причина появления этого файла: раньше экспорт ДДС собирал HTML-таблицу
  // и отдавал её с расширением .xls ("прикидывался" книгой Excel) — приём
  // рабочий, но ненадёжный: Excel не всегда корректно её открывает,
  // получается "наломанный" файл. Настоящий .xlsx открывается везде без
  // подвоха.
  function colLetter(n) {
    var s = '';
    n += 1;
    while (n > 0) {
      var rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  var RELS_ROOT =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  function workbookXml(sheetName) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';
  }

  // Небольшой фиксированный набор стилей — ровно то, что нужно ведомости
  // ДДС (см. screen-cash.js::exportToExcel): обычный текст, число с двумя
  // знаками (numFmtId 4 — встроенный формат "#,##0.00", отдельно объявлять
  // не нужно), три вида шапки (зелёная/розовая/без заливки — Приход/Расход/
  // остальное) и текст с переносом строк для длинного примечания.
  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFC6E0B4"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF8CBAD"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right>' +
        '<top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
      '<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  var STYLE = { DEFAULT: 0, TEXT: 1, NUM: 2, HEAD_INCOME: 3, HEAD_EXPENSE: 4, HEAD_PLAIN: 5, NOTE: 6 };

  function cellXml(ref, cell) {
    var s = (cell && cell.style != null) ? cell.style : STYLE.DEFAULT;
    if (!cell || cell.v === '' || cell.v == null) return '<c r="' + ref + '" s="' + s + '"/>';
    if (cell.num) return '<c r="' + ref + '" s="' + s + '"><v>' + Number(cell.v) + '</v></c>';
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(cell.v) + '</t></is></c>';
  }

  function sheetXml(rows, merges, colWidths) {
    var body = rows.map(function (row, rIdx) {
      var cells = row.map(function (cell, cIdx) { return cellXml(colLetter(cIdx) + (rIdx + 1), cell); }).join('');
      return '<row r="' + (rIdx + 1) + '">' + cells + '</row>';
    }).join('');
    var colsXml = (colWidths && colWidths.length)
      ? '<cols>' + colWidths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>'
      : '';
    var mergeXml = (merges && merges.length)
      ? '<mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>'
      : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      colsXml + '<sheetData>' + body + '</sheetData>' + mergeXml +
      '</worksheet>';
  }

  // opts.rows — двумерный массив ячеек ({v, num, style} или null/undefined
  // для пустой ячейки); opts.merges — ['A1:A2', ...]; opts.colWidths —
  // ширины колонок в Excel-единицах. Возвращает Blob (сам .xlsx).
  function build(opts) {
    var sheetName = (opts.sheetName || 'Sheet1').slice(0, 31);
    var enc = new TextEncoder();
    var files = [
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(RELS_ROOT) },
      { name: 'xl/workbook.xml', data: enc.encode(workbookXml(sheetName)) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(opts.rows, opts.merges || [], opts.colWidths)) }
    ];
    return ZipWriter.build(files);
  }

  window.XlsxWriter = { build: build, STYLE: STYLE };
})();
