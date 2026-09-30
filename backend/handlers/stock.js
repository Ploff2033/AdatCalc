const telegram = require('../telegram');

// Единая точка изменения остатка материала — пишет и сам остаток
// (materials.stock_on_hand/stock_reserved), и запись в журнал
// (stock_movements), в одной операции, чтобы они не могли разъехаться.
// before/after считаются здесь и передаются в лог как есть — см. комментарий
// у stock_movements в schema.sql про то, зачем они хранятся явно.
async function adjustMaterial(client, materialId, opts) {
  const { rows } = await client.query(
    'SELECT stock_on_hand, stock_reserved, stock_threshold, stock_unlimited, plant_id, name FROM materials WHERE id = $1 FOR UPDATE',
    [materialId]
  );
  // Материал мог быть удалён после того, как заказ его использовал —
  // order_materials.material_id тогда уже NULL (ON DELETE SET NULL), но на
  // всякий случай проверяем и здесь: бронировать/списывать нечего, тихо
  // пропускаем эту позицию, а не роняем всю операцию.
  if (!rows.length) return null;

  const before = rows[0];

  // Материал без учёта остатка (вода, газ...) — числа физически не могут
  // измениться, поэтому просто ничего не пишем (ни в materials, ни в
  // stock_movements — журналу движений тут действительно нечего фиксировать)
  // и не шлём уведомлений о дефиците. Возвращаем не null (это для вызывающих
  // означало бы "материал не найден", см. materials.js::stockAdjustment), а
  // честный, просто неизменившийся срез.
  if (before.stock_unlimited) {
    const onHand = Number(before.stock_on_hand);
    const reserved = Number(before.stock_reserved);
    return { onHandBefore: onHand, onHandAfter: onHand, reservedBefore: reserved, reservedAfter: reserved };
  }

  const onHandBefore = Number(before.stock_on_hand);
  const reservedBefore = Number(before.stock_reserved);
  const onHandAfter = onHandBefore + (opts.onHandDelta || 0);
  const reservedAfter = reservedBefore + (opts.reservedDelta || 0);

  await client.query('UPDATE materials SET stock_on_hand = $2, stock_reserved = $3 WHERE id = $1', [materialId, onHandAfter, reservedAfter]);
  await client.query(
    `INSERT INTO stock_movements (material_id, order_id, receipt_id, kind, qty, on_hand_before, on_hand_after, reserved_before, reserved_after, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [materialId, opts.orderId || null, opts.receiptId || null, opts.kind, opts.onHandDelta || opts.reservedDelta || 0, onHandBefore, onHandAfter, reservedBefore, reservedAfter, opts.note || null]
  );

  const availableAfter = onHandAfter - reservedAfter;
  const availableBefore = onHandBefore - reservedBefore;
  // Уведомление только в момент пересечения порога сверху вниз — иначе на
  // каждое дальнейшее движение уже дефицитного материала летело бы новое
  // сообщение (например, каждый следующий рейс того же заказа).
  if (availableAfter < Number(before.stock_threshold) && availableBefore >= Number(before.stock_threshold)) {
    telegram.notifyStockDeficit({ id: materialId, name: before.name, plantId: before.plant_id }, availableAfter, Number(before.stock_threshold), opts.orderId, opts.receiptId);
  }
  return { onHandBefore, onHandAfter, reservedBefore, reservedAfter };
}

// Бронь под заказ — вызывается из orders.js::create() в той же транзакции,
// сразу после вставки order_materials. orderMaterials — уже вставленные
// строки снимка (name/unit/qty/materialId), qty уже = кол-во на рецепт ×
// объём заказа, доп. расчётов не нужно.
async function reserve(client, orderId, orderMaterials) {
  for (const m of orderMaterials) {
    if (!m.materialId || !(m.qty > 0)) continue;
    await adjustMaterial(client, m.materialId, { reservedDelta: m.qty, kind: 'reserve', orderId });
  }
}

// Списание при разнесении рейса (создание/изменение/удаление записи путевого
// листа, см. handlers/waybill-entries.js) — на долю объёма ЭТОЙ записи от
// общего числа рейсов заказа (равные доли на рейс, как и весь остальной
// расчёт путевых листов в этом проекте). fraction может быть отрицательным —
// тогда это отмена ранее сделанного списания (уменьшили рейсы или удалили
// запись), on_hand/reserved возвращаются обратно.
async function writeoff(client, orderId, orderMaterials, fraction, note) {
  if (!fraction) return;
  for (const m of orderMaterials) {
    if (!m.materialId || !(m.qty > 0)) continue;
    const delta = m.qty * fraction;
    await adjustMaterial(client, m.materialId, { onHandDelta: -delta, reservedDelta: -delta, kind: 'writeoff', orderId, note });
  }
}

// Полное снятие ещё не списанной брони — на отмену/удаление заказа.
// "Ещё не списано" считается из самого журнала (сумма reserved_after -
// reserved_before по этому order_id), а не как фиксированная исходная
// сумма — поэтому: (а) корректно работает для частично отгруженного заказа
// (снимет только то, что реально осталось в брони), и (б) идемпотентно —
// повторный вызов найдёт остаток 0 и ничего не сделает.
async function release(client, orderId, note) {
  const { rows } = await client.query(
    `SELECT material_id, SUM(reserved_after - reserved_before) AS outstanding
     FROM stock_movements WHERE order_id = $1 AND material_id IS NOT NULL
     GROUP BY material_id`,
    [orderId]
  );
  for (const row of rows) {
    const outstanding = Number(row.outstanding);
    if (Math.abs(outstanding) < 1e-9) continue;
    await adjustMaterial(client, row.material_id, { reservedDelta: -outstanding, kind: 'release', orderId, note });
  }
}

// Приход (инертовоз привёз материал) — только on_hand растёт, бронь не
// трогается. qty должно быть положительным (для убыли используется
// adjustment — приход это не место чинить ошибки ввода).
async function receipt(client, materialId, qty, note) {
  if (!(qty > 0)) throw new (require('../http-error'))(400, 'Приход должен быть положительным числом');
  return adjustMaterial(client, materialId, { onHandDelta: qty, kind: 'receipt', note });
}

// Приход по путевому листу поступления инертных (см.
// handlers/waybill-entries.js и handlers/material-receipts.js) — на долю
// объёма ЭТОЙ записи от общего числа рейсов поступления (равные доли на
// рейс, тот же принцип, что и у writeoff() выше для заказов на бетон).
// fraction может быть отрицательным — тогда это отмена ранее сделанного
// прихода (уменьшили рейсы записи или удалили её), on_hand возвращается
// обратно. В отличие от writeoff(), бронь (reserved) тут вообще не
// участвует — поступления не резервируются заранее, остаток на складе
// появляется по факту прихода, а не в момент оформления записи.
async function receiptFromWaybill(client, receiptId, materialId, qty, fraction, note) {
  if (!fraction || !materialId || !(qty > 0)) return;
  const delta = qty * fraction;
  await adjustMaterial(client, materialId, { onHandDelta: delta, kind: 'receipt', receiptId, note });
}

// Ручная корректировка (по итогам инвентаризации и т.п.) — qty подписанное,
// может быть и в плюс, и в минус.
async function adjustment(client, materialId, qty, note) {
  return adjustMaterial(client, materialId, { onHandDelta: qty, kind: 'adjustment', note });
}

module.exports = { reserve, writeoff, release, receipt, adjustment, receiptFromWaybill };
