# Design

## Context

- `backend/telegram.js` отправляет всё через `transport.post(botToken, chatId, text, proxyUrl, threadId)`:
  - один прокси;
  - 3 попытки по 5 с с паузой 0,7 с;
  - при неудаче — `reject` и строка в логе.

  Вызывающие функции (`notifyOrderCreated`, `notifyOrderEdited`, `notifyStockDeficit`, `notifyRegistry`) не ждут результата. Тестовые кнопки (`sendTest`, `sendRegistryTest`) ждут.
- Прокси сейчас определяется так: `config.telegram_proxy_url`, затем `TELEGRAM_PROXY_URL`, по умолчанию `socks5://xray:10808`.
- Контейнер `teddysun/xray` с ручным `xray-config.json`: один SOCKS-inbound на `10808` и один outbound VLESS/Reality (`flow: xtls-rprx-vision`, `fingerprint`, `publicKey`, `shortId`, `serverName`).
- Тесты подменяют `telegram.transport.post` и работают без сети. Docker локально не установлен: образ `xray` локально не собирается, проверяются только чистые функции разбора и генерации.
- Прод-образ `calc` — `node:20-alpine`.

## Goals / Non-Goals

**Goals:**
- Сообщение уходит, пока жив хотя бы один сервер подписки, без участия человека.
- Список серверов обновляется сам и следует за ротацией у провайдера.
- При полном сбое сообщения не теряются в течение 24 часов.
- Тесты и dev без Xray работают как раньше.

**Non-Goals:** см. Out of Scope в proposal: другие протоколы, фоновая проверка серверов, ручное переключение, персистентный текущий сервер.

## Decisions

### 1. Переключение — в приложении, порт на сервер — в Xray
Xray умеет балансировать сам (`observatory` + `balancer`). Но он не знает, что конкретное сообщение не ушло, и проверял бы серверы по таймеру, а не по факту отправки. Поэтому Xray отвечает только за туннели: один SOCKS-inbound `10800+i` на сервер `i` и правило маршрутизации `inboundTag → outboundTag`. Выбор сервера делает `telegram.js`, у которого уже есть кэш агентов по URL (`proxyAgentFor`): каждый порт — это просто `socks5://xray:1080i`.

Отвергнуто: Xray API `OverrideBalancerTarget`. Зависит от версии Xray и gRPC-клиента, а это npm-зависимость.

### 2. Свой образ `xray/` с супервизором на Node
`xray/Dockerfile`:

```
FROM teddysun/xray:<закреплённая версия> AS xray
FROM node:20-alpine
COPY --from=xray /usr/bin/xray /usr/bin/xray
COPY xray/*.js /app/
CMD ["node", "/app/supervisor.js"]
```

Супервизор запускает `xray run -c /state/config.json` дочерним процессом. При изменении списка он делает `SIGTERM` и запускает процесс заново. Если Xray упал сам, супервизор перезапускает его через 5 с.

Отвергнуто: сайдкар с `docker.sock` — даёт полный доступ к Docker хоста.

Модули без npm-зависимостей:
- `xray/subscription.js` — чистые функции:
  - `decodeSubscription(body)`: base64 или открытый текст → строки;
  - `parseVless(uri)`: `vless://uuid@host:port?security=reality&pbk=…&sid=…&sni=…&fp=…&flow=…&type=tcp#name` → объект или `null`;
  - `buildConfig(servers)`: JSON конфига Xray;
  - `buildManifest(servers, now)`.
- `xray/supervisor.js` — скачивание, расписание, запись файлов, процесс Xray.

`parseVless` поддерживает транспорт `tcp` и безопасность `reality`/`tls`, как в нынешнем ручном конфиге. Ссылки с другим `type` (ws, grpc) переводятся в соответствующие `streamSettings`, если параметры есть. Если параметров не хватает, ссылка пропускается с записью в лог.

Тесты лежат в `backend/test/xray-subscription.test.js`, `require('../../xray/subscription')`, потому что `npm test` смотрит только в `backend/test/**`.

### 3. Скачивание подписки
- `https.get` напрямую, таймаут 15 с.
- Если не удалось, вторая попытка идёт через первый порт текущего пула (`socks5://127.0.0.1:10801`): сам адрес подписки тоже может оказаться недоступен напрямую.

  SOCKS-агент — это npm-зависимость. Чтобы её не тянуть, супервизор делает CONNECT через Xray, добавив в конфиг HTTP-inbound `127.0.0.1:10800` на первый сервер (только внутри контейнера). Тогда хватает встроенного `http` с методом CONNECT.
- Ответ сравнивается с текущим списком по набору id. Id сервера — `sha1(uuid@host:port)` в hex, первые 12 символов.
- Если адрес подписки отсутствует, он не попадает в логи даже частично: в лог пишется только хост.

### 4. Манифест и владение общими файлами
Общий том `./xray-state` на хосте. В контейнере `xray` он `/state` (rw), в `calc` — `/app/xray-state` (ro).

| Файл | Пишет | Читает |
|---|---|---|
| `config.json` | супервизор `xray` | только Xray |
| `manifest.json` | супервизор `xray` | `calc` (`telegram.js`) |

`manifest.json`:

```json
{
  "refreshedAt": "2026-10-28T09:00:00Z",
  "servers": [
    { "id": "a1b2c3d4e5f6", "name": "🇳🇱 Нидерланды", "address": "eekrep.tgflow.me", "proxyUrl": "socks5://xray:10801" }
  ]
}
```

- В манифесте нет UUID и ключей. Хост для `proxyUrl` задаётся env `XRAY_PROXY_HOST`, по умолчанию `xray`.
- Запись атомарная: временный файл и `rename`.
- `refreshedAt` обновляется при каждой удачной выгрузке, даже если список не изменился. Конфиг и перезапуск Xray — только при изменении набора id.
- Порядок записи: сначала `config.json` и перезапуск Xray, затем `manifest.json`. Так `calc` не увидит порт, которого Xray ещё не слушает.

`calc` читает манифест по пути `TELEGRAM_PROXY_MANIFEST` (по умолчанию `/app/xray-state/manifest.json`):
- перед каждой отправкой, с кэшем по `mtime` (`fs.stat`), чтобы не парсить файл каждый раз;
- если файла нет, он не читается или в нём пустой `servers`, — пула нет, работает ручной режим.

### 5. Доставка в `telegram.js`
`transport.post` остаётся единственной точкой сети, и тесты подменяют именно её. Сигнатура прежняя. Ошибка от ответа Telegram помечается `err.telegramStatus = res.statusCode`, сетевая — без этого поля.

Новый слой — `deliver({ botToken, chatId, threadId, text })`:

- **Пул есть:**
  1. Берётся `state.currentId`. Если его нет в манифесте, берётся `servers[0]`.
  2. Попытка через текущий: `transport.post(..., server.proxyUrl, ...)` с `attempts: 1` (новый необязательный параметр, по умолчанию 3 — для ручного режима).
  3. Если ошибка с `telegramStatus`, она пробрасывается (это ошибка Telegram, а не прокси).
  4. Если ошибка сетевая, запускается `findServer(send)` под общим промисом-мьютексом `state.searching`:
     - перебор `servers[(i+1)%n] … servers[(i+n-1)%n]`;
     - первый успешный записывает `state.currentId`, `state.since` и `state.lastSwitch = { at, fromName, reason }`.

     Сообщение, пришедшее во время поиска, ждёт `state.searching`, затем пробует через найденный сервер. Если и после этого сбой, запускает новый поиск.
  5. Если все серверы не ответили, выбрасывается `AllProxiesFailed` с последней ошибкой.
- **Пула нет:** как сейчас — `proxyUrl` из `getCredentials()`, 3 попытки.

`send()` и `notifyRegistry` переходят на `deliver`. Fire-and-forget-обёртка `notify(...)`:
- при `AllProxiesFailed`, а в ручном режиме при любой сетевой ошибке, кладёт сообщение в `telegram_outbox`;
- при `telegramStatus` пишет в лог.

`sendTest`/`sendRegistryTest` вызывают `deliver` напрямую и в очередь не кладут.

Текущий сервер и последнее переключение хранятся в памяти процесса. Персистентность не нужна: после перезапуска первый сбой просто найдёт рабочий сервер.

### 6. Очередь `telegram_outbox`

```sql
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);
```

- Хранятся чат и тема на момент создания: смена настроек позже не перенаправляет старые сообщения. Токен берётся текущий: без токена отправить нельзя, и такое сообщение остаётся в очереди до истечения 24 часов.
- `drainOutbox()`:
  1. `DELETE … WHERE created_at < now() - interval '24 hours' RETURNING id` с записью в лог.
  2. Затем по одному `ORDER BY id`: `deliver` с текстом + `\n⏱ Задержано: создано …` (московское время; формат `ЧЧ:ММ`, если дата совпадает с сегодняшней московской, иначе `ДД.ММ ЧЧ:ММ`).
  3. Если отправлено, `DELETE`. Если `telegramStatus`, `DELETE` и лог. Если сетевая ошибка, `attempts+1`, `last_error`, стоп.
- Защита от наложения прогонов — флаг `draining` в памяти: процесс `calc` один.
- `server.js` после `db.load()` запускает `setInterval(drainOutbox, 5 * 60 * 1000)`. Тесты вызывают `drainOutbox()` напрямую.

### 7. Статус для admin
`GET /api/config/telegram-status`, роль admin, функция `telegram.status()`:

```json
{
  "mode": "auto",
  "current": { "index": 4, "total": 10, "name": "…", "since": "…" },
  "lastSwitch": { "at": "…", "fromName": "…", "reason": "ETIMEDOUT" },
  "subscription": { "refreshedAt": "…", "count": 10, "stale": false },
  "queue": { "count": 2, "oldestAt": "…" }
}
```

- `stale` — `now - refreshedAt > 24 ч`.
- В ручном режиме `current`, `lastSwitch` и `subscription` равны `null`.
- `screen-settings.js` рисует блок под полями раздела «Уведомления в Telegram». Поле «Прокси» в автоматическом режиме неактивно, с подсказкой «Используется пул серверов из подписки».

### 8. Деплой
`docker-compose.yml`:
- `xray`: `build: ./xray`, `restart: unless-stopped`, `environment: XRAY_SUBSCRIPTION_URL=${XRAY_SUBSCRIPTION_URL:-}`, `volumes: ./xray-state:/state`;
- `calc`: том `./xray-state:/app/xray-state:ro`, `TELEGRAM_PROXY_URL=${TELEGRAM_PROXY_URL:-}`.

`.gitignore`: `xray-state/`.

## Risks / Trade-offs

- **Мёртвый текущий сервер задерживает каждое первое сообщение после его смерти на 5 с.** Это приемлемо: отправка идёт в фоне.
- **Нет фоновой проверки.** Если сообщений долго нет, мёртвый сервер обнаружится только при следующем сообщении. Это осознанный выбор из интервью.
- **Порядок в чате.** Досланное сообщение может прийти позже свежих. Смягчается строкой «Задержано».
- **Формат подписки.** Krepost может отдавать другой формат в зависимости от User-Agent. Супервизор шлёт обычный UA клиента (`v2rayN/6.0`), а если в ответе нет ни одной `vless://`, логирует первые 80 символов ответа без ссылки.
- **Публикация ключей.** Конфиг Xray с UUID лежит в `./xray-state` на хосте, как раньше лежал `xray-config.json`. Каталог в `.gitignore`.
- **Только один процесс `calc`.** Мьютекс поиска и флаг очереди живут в памяти. При горизонтальном масштабировании понадобится блокировка в БД, сейчас этого не требуется.

## Migration Plan

1. Задеплоить код (`git pull`).
2. На сервере добавить в `.env` строку `XRAY_SUBSCRIPTION_URL=<ссылка>`.
3. `docker compose up -d --build`. Проверить `docker compose logs xray`: должна появиться строка «подписка: 10 серверов» и создаться `./xray-state/manifest.json`.
4. В Настройках убедиться, что режим «Автоматически», и нажать «Отправить тестовое».
5. Старый `xray-config.json` удалить с сервера после проверки.

Откат: вернуть прежний `docker-compose.yml`. В Настройках остаётся сохранённый `socks5://xray:10808`, но со старым образом нужен и старый `xray-config.json`, поэтому удалять его только после шага 4.
