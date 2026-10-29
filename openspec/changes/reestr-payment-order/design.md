# Design: «Платёжка готова», равные права, адресные уведомления

## Context

Зачем это нужно — в proposal.md, требования — в `specs/payment-registry/{payment-order,access-equal,notify-routing}`. Текущее состояние:

- **Статус** вычисляется в `registry-calc.js::computeState` из `decision`, `approved_amount` и оплат.
  - Группы списка нумеруются `GROUP_OF_STATUS = { pending: 0, approved: 1, partial: 1, postponed: 2, paid: 3, rejected: 3 }`. Номера используются на фронте: `GROUP_LABELS[group]`, `totals.groups[0..3]`, проверки `group === 0 || group === 2` в пакетном выборе и `group === 3` («закрытые») в `compareForList`.
  - `addPayment` разрешён в статусах `approved` и `partial`.
- **Права:** `registry-routes.js` — у маршрутов `registryRoles: ADMIN` или `ADMIN_OWNER`.
- **Вход по ссылке:** `app.js::bootOwner` всегда открывает `MobileRegistryScreen`.
- **Уведомления:** `handlers/registry.js::notify(build, …)` → `telegram.notifyRegistry(text)`. Это один адресат (`telegram_registry_chat_id` / `_thread_id`), доставка через `deliverOrQueue`: прокси и очередь `telegram_outbox`.
- **Пакетное решение:** `decideMany` с `decision ∈ {approved, postponed}` и общим ядром `applyDecision`.

## Goals / Non-Goals

**Goals:**
- «Платёжка готова» — **отметка в данных** (`payment_order_at`), а статус по-прежнему вычисляется. Правила «оплата только из неё» и «снятие после оплаты» проверяются на сервере.
- Права и маршрутизация уведомлений меняются в одном месте каждое, без размазывания по обработчикам.

**Non-Goals:**
- Сроки, напоминания и «горит» (Out of Scope).
- Учёт суммы конкретной платёжки (платёжка на остаток).

## Decisions

### 1. Данные и статус

```sql
ALTER TABLE pay_requests ADD COLUMN IF NOT EXISTS payment_order_at TIMESTAMPTZ;   -- NULL = платёжки нет
ALTER TABLE pay_requests ADD COLUMN IF NOT EXISTS payment_order_cancel_note TEXT NOT NULL DEFAULT '';
```

- **`computeState`.** Если решение `approved`, «Не оплачено» > 0 и `payment_order_at` задан, статус **`ready`**.
- **Группы** перенумерованы по порядку показа:

  | Группа | Статусы |
  |---|---|
  | `0` | `ready` |
  | `1` | `pending` |
  | `2` | `approved` / `partial` |
  | `3` | `postponed` |
  | `4` | закрытые |

  `GROUP_LABELS`, `totals.groups` и все проверки групп на фронте обновляются вместе (задача 1.2). Альтернатива — дробный номер группы (`-1`). Отвергнута: проверки «закрытые = 3» разошлись бы с реальным порядком.
- **Сортировка группы 0:** раньше отмеченные — выше.
- **Итог «К оплате»** считает `approved`, `partial` и `ready`.

### 2. Правила на сервере (`handlers/registry.js`)

- **`markPaymentOrder(id)`:** допустимо при `approved` или `partial`. Ставит `payment_order_at = now()` и очищает `payment_order_cancel_note`. Иначе 409.
- **`cancelPaymentOrder(id, {note})`:** допустимо при `ready`. Ставит `payment_order_at = NULL`, сохраняет причину для уведомления.
- **`addPayment`:** допустимо **только** при `ready`, иначе 409 «Сначала отметьте, что платёжка готова». После вставки оплаты в той же транзакции `payment_order_at = NULL`.
- **`applyDecision`** (одиночное и пакетное): любое новое решение, кроме `approved` с тем же или большим «К оплате», сбрасывает `payment_order_at`. Если «К оплате» уменьшили так, что «Не оплачено» = 0, отметка тоже снимается.
- **`removePayment`:** отметку не ставит, статус вычисляется заново.
- **Пакет:** `decideMany` получает третье действие `payment_ready`, по ячейке состояния — `approved`/`partial`. Остальные статусы пропускаются с причиной («нет решения «одобрить»», «уже оплачена», «платёжка уже готова» считается применённой без изменений).

### 3. Права

- В `registry-routes.js` все маршруты реестра получают `ADMIN_OWNER`, **кроме** настроечных: `POST/PUT/DELETE /categories|/units`, `owner/reissue`, `settings` (GET и PUT), `telegram-test`. Они остаются `ADMIN`. `GET /categories|/units` и `lookup` — `ADMIN_OWNER`.
- Тест доступа строится по списку маршрутов: каждый маршрут проверяется для admin, owner и manager. Новый маршрут без явного решения ловится тестом.

### 4. Вход по ссылке на ПК

`app.js::bootOwner`:
- если `Viewport.isMobile()`, как сейчас, `MobileRegistryScreen`;
- иначе `RegistryScreen.show()` в оболочке без сайдбара (класс `owner-mode` уже скрывает сайдбар, на ПК дополнительно разворачивается `main-area` на всю ширину).

В `screen-registry.js` убираются проверки «только admin»: всё, что видит admin в реестре, видит и учредитель. Ссылки на Настройки по ссылке не показываются. При переходе через ширину 860 px экран переключается, как у admin.

### 5. Маршрутизация уведомлений

```sql
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_owner_username TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_buh_chat_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_buh_thread_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_buh_username TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_events TEXT;  -- JSON {event: bool}, NULL = по умолчанию
```

- **Адресат «Учредитель»** — существующие `telegram_registry_chat_id` / `_thread_id`. Миграция не нужна.
- **`registry-notify.js`** (новый модуль) — `EVENTS` с адресатом и включением по умолчанию, по таблице спеки. Функция `send(event, text)` читает настройки, проверяет включение, добавляет `@username` и вызывает `telegram.notifyRegistryTo({ chatId, threadId }, text)`. Последняя — та же `deliverOrQueue`, только с явным адресатом.
- **Тексты** собираются в `handlers/registry.js`: `messageNew`, `messageApproved`, `messageReady`, `messageCancel`, `messageDecision`, `messagePaid`, сводные `messageBulk*`. Получатель — отдельной строкой.
- **Настройки** (`screen-settings.js`, admin): два блока адресатов (чат, тема, @username, «Отправить тестовое» каждому) и список событий с переключателями.

### 6. Интерфейс

- **`registry-common.js`:**
  - `STATUS_CHIP.ready = 'purple'`, `.chip.purple` в CSS;
  - подпись «Платёжка готова»;
  - функция `waitLabel(paymentOrderAt)`: «готова сегодня 10:40» / «готова вчера» / «готова N дн.»;
  - группы `0..4` и их подписи.
- **Карточка** (ПК и телефон), блок «Оплаты»:
  - статус `approved` / `partial` → кнопка «Платёжка готова»;
  - `ready` → форма «+ Оплата» и ссылка «Отменить платёжку» (подтверждение с полем причины).
- **Пакетный выбор:** `selectable` — `pending`, `postponed`, а также `approved` и `partial`. Для группы 2 на панели вместо «Отложить / Одобрить» одна кнопка «Платёжка готова». Выбрать заявки сразу из разных групп нельзя: выбор из другой группы сбрасывает текущий, на панели действия той группы, из которой выбраны заявки.

## Risks / Trade-offs

- [Заявки, одобренные до выкатки, требуют «Платёжка готова» перед оплатой] → это и есть новый порядок, в подсказке у формы написано, что нажать. Миграция данных не нужна.
- [Перенумерация групп ломает фронт в незаметных местах] → задача 1.2 меняет все места разом, сквозные сценарии реестра и пакетного решения прогоняются целиком.
- [Ссылка учредителя теперь может удалять заявки и оплаты] → это решение пользователя. Перевыпуск ссылки остаётся у admin, утечка закрывается одним нажатием.
- [Упоминание @username в группе, где адресата нет] → Telegram просто покажет текст. Ошибки нет.

## Migration Plan

Миграции добавляют колонки, существующие настройки чата становятся адресатом «Учредитель». Деплой обычный. Откат — предыдущий образ, новые колонки игнорируются.

## Open Questions

—
