(function () {
  function fmt(n, decimals) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 }) + ' ₽';
  }
  function fmtNum(n, decimals, unit) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 }) + (unit ? ' ' + unit : '');
  }
  window.Format = { fmt: fmt, fmtNum: fmtNum };
})();
