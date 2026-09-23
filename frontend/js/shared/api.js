(function () {
  async function request(method, path, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch('/api' + path, opts);
    if (res.status === 204) return null;
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || ('Ошибка запроса (' + res.status + ')'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.Api = {
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body); },
    put: function (path, body) { return request('PUT', path, body); },
    del: function (path) { return request('DELETE', path); }
  };
})();
