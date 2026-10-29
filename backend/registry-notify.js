const db = require('./db');
const telegram = require('./telegram');

// Адресные уведомления реестра оплат (change reestr-payment-order, спека
// payment-registry/notify-routing): два адресата — «Учредитель» (прежние
// telegram_registry_chat_id / _thread_id) и «Бухгалтер»; у каждого события
// свой адресат и переключатель вкл/выкл в Настройках. Тексты собирает
// handlers/registry.js, здесь — только «кому и включено ли».
const AUDIENCES = { owner: 'Учредитель', buh: 'Бухгалтер' };

const EVENTS = {
  new_request: { to: 'owner', on: true, label: 'Новая заявка' },
  approved: { to: 'buh', on: true, label: 'Одобрено — можно делать платёжку' },
  payment_ready: { to: 'owner', on: true, label: 'Платёжка готова — проведите оплату' },
  payment_cancel: { to: 'buh', on: true, label: 'Платёжка отменена' },
  rejected_postponed: { to: 'buh', on: false, label: 'Отклонено / отложено' },
  paid: { to: 'buh', on: false, label: 'Оплачено' }
};

function cleanUsername(v) {
  return String(v || '').trim().replace(/^@+/, '');
}

async function settings() {
  const { rows } = await db.pool.query(
    `SELECT telegram_registry_chat_id, telegram_registry_thread_id, telegram_registry_owner_username,
            telegram_registry_buh_chat_id, telegram_registry_buh_thread_id, telegram_registry_buh_username,
            telegram_registry_events
     FROM config WHERE id = 1`
  );
  const r = rows[0] || {};
  let saved = {};
  try { saved = r.telegram_registry_events ? JSON.parse(r.telegram_registry_events) : {}; } catch (err) { saved = {}; }
  const events = {};
  Object.keys(EVENTS).forEach((k) => { events[k] = typeof saved[k] === 'boolean' ? saved[k] : EVENTS[k].on; });
  return {
    owner: { chatId: r.telegram_registry_chat_id || '', threadId: r.telegram_registry_thread_id || '', username: cleanUsername(r.telegram_registry_owner_username) },
    buh: { chatId: r.telegram_registry_buh_chat_id || '', threadId: r.telegram_registry_buh_thread_id || '', username: cleanUsername(r.telegram_registry_buh_username) },
    events
  };
}

// Без await у вызывающего; ошибки — в лог, операцию в реестре не отменяют.
// text — готовый HTML; @username адресата ставится первой строкой (Telegram
// пришлёт пуш, даже если чат общий).
async function send(event, text) {
  const ev = EVENTS[event];
  if (!ev) throw new Error('Неизвестное событие уведомления: ' + event);
  const st = await settings();
  if (!st.events[event]) return;
  const to = st[ev.to];
  if (!to.chatId) return;
  const head = to.username ? '@' + to.username + '\n' : '';
  const messageId = await telegram.notifyRegistryTo({ chatId: to.chatId, threadId: to.threadId }, head + text);
  return messageId ? { chatId: to.chatId, messageId } : null;
}

// requestIds — заявки сообщения: для событий с реакцией (REACT_DONE) их
// сообщение запоминается, и реакция сразу сверяется (платёжку могли успеть
// отметить, пока сообщение уходило).
function fire(event, buildText, requestIds) {
  Promise.resolve()
    .then(buildText)
    .then((text) => text && send(event, text))
    .then(async (sent) => {
      if (!sent || !REACT_DONE[event] || !requestIds || !requestIds.length) return;
      await db.pool.query(
        'INSERT INTO pay_notify_messages (event, chat_id, message_id, request_ids) VALUES ($1, $2, $3, $4)',
        [event, String(sent.chatId), sent.messageId, requestIds]
      );
      await syncReactions(requestIds);
    })
    .catch((err) => console.error('Реестр оплат: уведомление «' + event + '» не отправлено: ' + err.message));
}

// ---------- реакции ✍ «сделано» ----------
// Реакция бота (стандартный набор Telegram; ✅ в нём нет).
const REACTION = '✍';
// Когда заявка сообщения «сделана» — SQL-условие над r (pay_requests) и m
// (pay_notify_messages): «Можно делать платёжку» — платёжка отмечена или
// после сообщения уже была оплата; «Платёжка готова» — после сообщения
// внесена оплата.
const PAID_AFTER = 'EXISTS (SELECT 1 FROM pay_payments p WHERE p.request_id = r.id AND p.created_at >= m.created_at)';
const REACT_DONE = {
  approved: '(r.payment_order_at IS NOT NULL OR ' + PAID_AFTER + ')',
  payment_ready: PAID_AFTER
};

// Сверить реакции на всех сообщениях, где есть эти заявки: все заявки
// сообщения сделаны — поставить ✍, иначе (отмена платёжки, удаление оплаты)
// — снять. Ждёт Telegram; вызывающие — через syncReactionsLater. Сверки
// идут по очереди: две одновременные (отметка платёжки и запись её же
// сообщения) иначе обе увидели бы «реакции нет» и поставили её дважды.
let reactionQueue = Promise.resolve();
function syncReactions(requestIds) {
  const run = reactionQueue.then(() => syncReactionsNow(requestIds));
  reactionQueue = run.catch(() => {});
  return run;
}

async function syncReactionsNow(requestIds) {
  const { rows } = await db.pool.query(
    `SELECT m.id, m.chat_id, m.message_id, m.reacted,
            bool_and(CASE m.event ${Object.keys(REACT_DONE).map((e) => "WHEN '" + e + "' THEN " + REACT_DONE[e]).join(' ')} ELSE false END) AS done
     FROM pay_notify_messages m JOIN pay_requests r ON r.id = ANY(m.request_ids)
     WHERE m.request_ids && $1::text[]
     GROUP BY m.id`,
    [requestIds]
  );
  for (const m of rows) {
    if (m.done === m.reacted) continue;
    try {
      if (await telegram.setRegistryReaction(m.chat_id, m.message_id, m.done ? REACTION : null)) {
        await db.pool.query('UPDATE pay_notify_messages SET reacted = $2 WHERE id = $1', [m.id, m.done]);
      }
    } catch (err) {
      console.error('Реестр оплат: реакция на сообщение ' + m.message_id + ' не поставлена: ' + err.message);
    }
  }
}

function syncReactionsLater(requestIds) {
  syncReactions(requestIds).catch((err) => console.error('Реестр оплат: реакции не сверены: ' + err.message));
}

module.exports = { AUDIENCES, EVENTS, REACTION, settings, send, fire, syncReactions, syncReactionsLater, cleanUsername };
