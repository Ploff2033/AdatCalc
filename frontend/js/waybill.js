(function () {
  // Заполняется настоящий .xlsx-бланк формы №4-П на сервере (см.
  // backend/waybill-xlsx.js) — здесь только запрос файла и его скачивание.
  // Один заказ — .xlsx, несколько — zip с файлом на каждый.
  async function download(orders) {
    var ids = orders.map(function (o) { return o.id; });
    var res = await fetch('/api/orders/waybills.xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    });
    if (!res.ok) {
      var data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      throw new Error((data && data.error) || 'Не удалось сформировать путевой лист');
    }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = orders.length === 1 ? 'putevoy-list-' + orders[0].id + '.xlsx' : 'putevye-listy.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.Waybill = { download: download };
})();
