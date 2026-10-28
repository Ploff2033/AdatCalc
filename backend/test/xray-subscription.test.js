// Сценарии спеки notifications/telegram-delivery: «Список серверов из
// подписки» — разбор подписки и сборка конфига Xray (xray/subscription.js,
// чистые функции; сам образ xray локально не собирается — Docker только на проде).
// Ключи и uuid ниже вымышленные.
const test = require('node:test');
const assert = require('node:assert');
const sub = require('../../xray/subscription');

function vless(i, extra) {
  return 'vless://00000000-0000-4000-8000-00000000000' + (i % 10) + '@srv' + i + '.example.net:443'
    + '?encryption=none&flow=xtls-rprx-vision&security=reality&sni=srv' + i + '.example.net&fp=firefox'
    + '&pbk=TESTpublicKey' + i + '&sid=ab' + i + '&type=tcp' + (extra || '') + '#' + encodeURIComponent('Сервер ' + i);
}

const tenAndTwo = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => vless(i))
  .concat(['vmess://eyJhZGQiOiJ4In0=', 'vmess://eyJhZGQiOiJ5In0=']);

test('Подписка из 10 серверов: base64 → 10 серверов на портах 10801…10810, vmess пропущены', () => {
  const body = Buffer.from(tenAndTwo.join('\n')).toString('base64');
  const { servers, skipped } = sub.parseSubscription(body);
  assert.strictEqual(servers.length, 10);
  assert.deepStrictEqual(skipped, ['vmess://…', 'vmess://…']);
  const m = sub.buildManifest(servers, Date.parse('2026-10-28T09:00:00Z'), 'xray');
  assert.strictEqual(m.refreshedAt, '2026-10-28T09:00:00.000Z');
  assert.deepStrictEqual(m.servers.map((s) => s.proxyUrl), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => 'socks5://xray:' + (10800 + i)));
  assert.strictEqual(m.servers[0].name, 'Сервер 1');
  // В манифесте (его читает calc и кусками видит admin) нет uuid и ключей.
  const raw = JSON.stringify(m);
  assert.ok(!raw.includes('00000000-0000-4000'));
  assert.ok(!raw.includes('TESTpublicKey'));
  assert.deepStrictEqual(Object.keys(m.servers[0]).sort(), ['address', 'id', 'name', 'proxyUrl']);
});

test('Подписка открытым текстом, base64 без паддинга и с переносами', () => {
  assert.strictEqual(sub.parseSubscription(tenAndTwo.join('\r\n')).servers.length, 10);
  const b64 = Buffer.from(vless(1) + '\n' + vless(2)).toString('base64').replace(/=+$/, '');
  const wrapped = b64.replace(/(.{60})/g, '$1\n');
  assert.strictEqual(sub.parseSubscription(wrapped).servers.length, 2);
});

test('Имя сервера: из #подписи, без неё — адрес', () => {
  assert.strictEqual(sub.parseVless(vless(3)).name, 'Сервер 3');
  assert.strictEqual(sub.parseVless(vless(3).replace(/#.*$/, '')).name, 'srv3.example.net');
});

test('Битые и неподдерживаемые ссылки пропускаются', () => {
  assert.strictEqual(sub.parseVless('vless://broken'), null);
  assert.strictEqual(sub.parseVless(vless(1).replace('&pbk=TESTpublicKey1', '')), null, 'reality без publicKey');
  assert.strictEqual(sub.parseVless(vless(1).replace('type=tcp', 'type=kcp')), null);
  assert.strictEqual(sub.parseVless('trojan://x@h:443'), null);
  const { servers } = sub.parseSubscription(vless(1) + '\n' + vless(1));
  assert.strictEqual(servers.length, 1, 'дубликаты схлопываются');
});

test('buildConfig: outbound совпадает с прежним ручным конфигом', () => {
  const s = sub.parseVless('vless://11111111-2222-4333-8444-555555555555@eekrep.example.me:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=eekrep.example.me&fp=firefox&pbk=PUBKEY&sid=fe89&type=tcp#X');
  const cfg = sub.buildConfig([s]);
  assert.deepStrictEqual(cfg.outbounds[0], {
    tag: 'out-0',
    protocol: 'vless',
    settings: { vnext: [{ address: 'eekrep.example.me', port: 443, users: [{ id: '11111111-2222-4333-8444-555555555555', encryption: 'none', flow: 'xtls-rprx-vision' }] }] },
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      realitySettings: { serverName: 'eekrep.example.me', fingerprint: 'firefox', publicKey: 'PUBKEY', shortId: 'fe89' }
    }
  });
  const socks = cfg.inbounds.find((i) => i.tag === 'in-0');
  assert.deepStrictEqual(socks, { tag: 'in-0', listen: '0.0.0.0', port: 10801, protocol: 'socks', settings: { udp: true } });
  // Служебный вход для скачивания подписки — только внутри контейнера.
  assert.deepStrictEqual(cfg.inbounds[0], { tag: 'in-sub', listen: '127.0.0.1', port: 10800, protocol: 'http' });
  assert.deepStrictEqual(cfg.routing.rules.find((r) => r.inboundTag[0] === 'in-0'), { type: 'field', inboundTag: ['in-0'], outboundTag: 'out-0' });
});

test('Подписка не изменилась / провайдер сменил серверы', () => {
  const ten = sub.parseSubscription(tenAndTwo.join('\n')).servers;
  const prev = sub.buildManifest(ten, Date.parse('2026-10-28T03:00:00Z'));
  assert.strictEqual(sub.planRefresh(prev, sub.parseSubscription(tenAndTwo.join('\n')).servers), 'unchanged');
  // 9 серверов, другой состав.
  const nine = [2, 3, 4, 5, 6, 7, 8, 9, 11].map((i) => vless(i)).join('\n');
  const next = sub.parseSubscription(nine).servers;
  assert.strictEqual(sub.planRefresh(prev, next), 'changed');
  assert.deepStrictEqual(sub.buildManifest(next, Date.now()).servers.map((s) => s.proxyUrl.split(':')[2]), ['10801', '10802', '10803', '10804', '10805', '10806', '10807', '10808', '10809']);
  // Перестановка — тоже изменение: порт привязан к позиции.
  assert.strictEqual(sub.planRefresh(prev, ten.slice().reverse()), 'changed');
  assert.strictEqual(sub.planRefresh(null, ten), 'changed', 'первый запуск');
});
