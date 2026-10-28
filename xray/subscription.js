// Разбор VPN-подписки и сборка конфига Xray (change telegram-proxy-failover).
// Чистые функции без сети и файлов — их проверяет backend/test/
// xray-subscription.test.js, а supervisor.js только склеивает их с
// расписанием, диском и процессом Xray. Без npm-зависимостей: образ xray
// собирается из одного node:20-alpine + бинаря Xray.
const crypto = require('crypto');

// Первый порт пула: сервер i (с нуля) слушает BASE_PORT + 1 + i, то есть
// 10801, 10802, … — так в спеке. 10800 — служебный HTTP-вход только внутри
// контейнера, через него супервизор качает подписку, если напрямую не вышло.
const BASE_PORT = 10800;

// Подписка — либо base64 (обычный формат v2rayN), либо уже открытый текст:
// список ссылок или JSON-массив готовых конфигов Xray (так отвечает Krepost —
// выяснилось при раскатке). base64 бывает с переносами строк, без паддинга и
// в URL-safe-алфавите — нормализуем всё это перед декодированием.
function decodeText(body) {
  const raw = String(body || '').trim();
  if (/:\/\//.test(raw) || /^[[{]/.test(raw)) return raw;
  const b64 = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8').trim();
}

function decodeSubscription(body) {
  return decodeText(body).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function serverId(uuid, address, port) {
  return crypto.createHash('sha1').update(uuid + '@' + address + ':' + port).digest('hex').slice(0, 12);
}

// vless://uuid@host:port?security=reality&pbk=…&sid=…&sni=…&fp=…&flow=…&type=tcp#Имя
// → объект сервера или null (не vless, битая ссылка, неподдерживаемый
// транспорт). Поддерживаем то, что реально отдаёт подписка: tcp, плюс ws и
// grpc на случай, если провайдер их добавит; безопасность reality/tls/none.
function parseVless(uri) {
  if (!/^vless:\/\//i.test(uri)) return null;
  let u;
  try { u = new URL(uri); } catch (e) { return null; }
  const uuid = decodeURIComponent(u.username || '');
  const address = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port || 443);
  if (!uuid || !address || !Number.isInteger(port) || port <= 0) return null;
  const q = u.searchParams;
  const type = (q.get('type') || 'tcp').toLowerCase();
  if (!['tcp', 'ws', 'grpc'].includes(type)) return null;
  const security = (q.get('security') || 'none').toLowerCase();
  if (!['reality', 'tls', 'none'].includes(security)) return null;
  if (security === 'reality' && !q.get('pbk')) return null;
  let name = '';
  try { name = decodeURIComponent(u.hash.replace(/^#/, '')).trim(); } catch (e) { name = u.hash.replace(/^#/, ''); }
  return {
    id: serverId(uuid, address, port),
    name: name || address,
    address,
    port,
    uuid,
    flow: q.get('flow') || '',
    security,
    sni: q.get('sni') || q.get('serverName') || '',
    fp: q.get('fp') || '',
    pbk: q.get('pbk') || '',
    sid: q.get('sid') || '',
    spx: q.get('spx') || '',
    alpn: q.get('alpn') || '',
    type,
    path: q.get('path') || '',
    host: q.get('host') || '',
    serviceName: q.get('serviceName') || ''
  };
}

// Сервер из VLESS-outbound готового конфига Xray. Обе формы settings:
// классическая vnext[0].users[0] и плоская (address/port/id, новые Xray).
// settings/streamSettings берём как есть — провайдер знает свои параметры
// лучше нашего разбора; убираем только sockopt.dialerProxy (ссылка на
// соседний outbound вроде "fragment", которого в нашем конфиге нет).
function serverFromOutbound(ob, remarks) {
  if (!ob || String(ob.protocol).toLowerCase() !== 'vless' || !ob.settings) return null;
  const st = ob.settings;
  const vn = Array.isArray(st.vnext) && st.vnext[0];
  const user = vn && Array.isArray(vn.users) ? vn.users[0] : null;
  const address = vn ? vn.address : st.address;
  const port = Number(vn ? vn.port : st.port);
  const uuid = user ? user.id : st.id;
  if (!address || !uuid || !Number.isInteger(port) || port <= 0) return null;
  const streamSettings = JSON.parse(JSON.stringify(ob.streamSettings || {}));
  if (streamSettings.sockopt) {
    delete streamSettings.sockopt.dialerProxy;
    if (!Object.keys(streamSettings.sockopt).length) delete streamSettings.sockopt;
  }
  return {
    id: serverId(uuid, address, port),
    name: String(remarks || '').trim() || address,
    address,
    port,
    uuid,
    raw: { settings: st, streamSettings }
  };
}

function parseJsonSubscription(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  const configs = Array.isArray(data) ? data : [data];
  const servers = [];
  const skipped = [];
  configs.forEach((cfg, i) => {
    const obs = (cfg && Array.isArray(cfg.outbounds)) ? cfg.outbounds : [];
    const vless = obs.map((ob) => serverFromOutbound(ob, cfg.remarks)).filter(Boolean);
    if (!vless.length) skipped.push('конфиг #' + (i + 1) + ' (' + (obs.map((o) => o && o.protocol).filter(Boolean).join(', ') || 'без outbounds') + ')');
    // В конфиге v2rayN один прокси-outbound (остальные — direct/block);
    // если их несколько, берём все — у каждого свой порт.
    vless.forEach((s) => servers.push(s));
  });
  return { servers, skipped };
}

// Подписка → { servers, skipped }. skipped — для лога: что именно не
// взяли (схема ссылки или номер конфига, без самих ключей).
function parseSubscription(body) {
  const text = decodeText(body);
  const parsed = /^[[{]/.test(text) ? parseJsonSubscription(text) : null;
  let servers;
  let skipped;
  if (parsed) {
    ({ servers, skipped } = parsed);
  } else {
    servers = [];
    skipped = [];
    for (const line of text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      const s = parseVless(line);
      if (!s) { skipped.push(line.split('://')[0].slice(0, 20) + '://…'); continue; }
      servers.push(s);
    }
  }
  const seen = new Set();
  servers = servers.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  return { servers, skipped };
}

function streamSettings(s) {
  const out = { network: s.type, security: s.security };
  if (s.security === 'reality') {
    out.realitySettings = { serverName: s.sni || s.address, fingerprint: s.fp || 'chrome', publicKey: s.pbk, shortId: s.sid };
    if (s.spx) out.realitySettings.spiderX = s.spx;
  } else if (s.security === 'tls') {
    out.tlsSettings = { serverName: s.sni || s.address };
    if (s.fp) out.tlsSettings.fingerprint = s.fp;
    if (s.alpn) out.tlsSettings.alpn = s.alpn.split(',');
  }
  if (s.type === 'ws') out.wsSettings = { path: s.path || '/', headers: s.host ? { Host: s.host } : {} };
  if (s.type === 'grpc') out.grpcSettings = { serviceName: s.serviceName };
  return out;
}

// Конфиг Xray: на каждый сервер свой SOCKS-вход и свой выход, связанные
// правилом маршрутизации, — приложение выбирает сервер портом, а не Xray
// (см. design.md, решение 1).
function buildConfig(servers) {
  const inbounds = [
    { tag: 'in-sub', listen: '127.0.0.1', port: BASE_PORT, protocol: 'http' }
  ];
  const outbounds = [];
  const rules = [{ type: 'field', inboundTag: ['in-sub'], outboundTag: 'out-0' }];
  servers.forEach((s, i) => {
    inbounds.push({ tag: 'in-' + i, listen: '0.0.0.0', port: BASE_PORT + 1 + i, protocol: 'socks', settings: { udp: true } });
    if (s.raw) {
      outbounds.push({ tag: 'out-' + i, protocol: 'vless', settings: s.raw.settings, streamSettings: s.raw.streamSettings });
    } else {
      const user = { id: s.uuid, encryption: 'none' };
      if (s.flow) user.flow = s.flow;
      outbounds.push({
        tag: 'out-' + i,
        protocol: 'vless',
        settings: { vnext: [{ address: s.address, port: s.port, users: [user] }] },
        streamSettings: streamSettings(s)
      });
    }
    rules.push({ type: 'field', inboundTag: ['in-' + i], outboundTag: 'out-' + i });
  });
  return { log: { loglevel: 'warning' }, inbounds, outbounds, routing: { rules } };
}

// Манифест для calc — без uuid и ключей: только то, что нужно выбрать порт
// и показать admin «Сервер N из M · имя».
function buildManifest(servers, now, proxyHost) {
  return {
    refreshedAt: new Date(now).toISOString(),
    servers: servers.map((s, i) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      proxyUrl: 'socks5://' + (proxyHost || 'xray') + ':' + (BASE_PORT + 1 + i)
    }))
  };
}

// Нужна ли пересборка конфига: сравниваем упорядоченные id — порт зависит от
// позиции в списке, поэтому перестановка тоже считается изменением.
function planRefresh(prevManifest, servers) {
  const prev = prevManifest && Array.isArray(prevManifest.servers) ? prevManifest.servers.map((s) => s.id).join(',') : null;
  const next = servers.map((s) => s.id).join(',');
  return prev === next ? 'unchanged' : 'changed';
}

module.exports = { BASE_PORT, decodeSubscription, parseVless, parseSubscription, buildConfig, buildManifest, planRefresh };
