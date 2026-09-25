const db = require('../db');

// Лента движений для экрана «Остатки» — join на materials ради читаемого
// имени/ед. изм. (в самой stock_movements только material_id). Фильтр по
// plantId идёт через materials.plant_id — своей колонки завода в
// stock_movements нет, у материала он и так один.
async function list(query) {
  const conditions = [];
  const params = [];
  if (query && query.materialId) {
    params.push(query.materialId);
    conditions.push(`sm.material_id = $${params.length}`);
  }
  if (query && query.plantId) {
    params.push(query.plantId);
    conditions.push(`m.plant_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.pool.query(
    `SELECT sm.*, m.name AS material_name, m.unit AS material_unit
     FROM stock_movements sm
     JOIN materials m ON m.id = sm.material_id
     ${where}
     ORDER BY sm.created_at DESC
     LIMIT 200`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    materialId: r.material_id,
    materialName: r.material_name,
    unit: r.material_unit,
    orderId: r.order_id,
    kind: r.kind,
    qty: Number(r.qty),
    onHandBefore: Number(r.on_hand_before),
    onHandAfter: Number(r.on_hand_after),
    reservedBefore: Number(r.reserved_before),
    reservedAfter: Number(r.reserved_after),
    note: r.note,
    createdAt: new Date(r.created_at).toISOString()
  }));
}

// Дневной срез остатка одного материала за последние N дней — для графика
// динамики на дашборде (см. план v2/redesign: "график динамики движения
// ресурсов" — GET /api/stock-movements обычной лентой для этого не годится,
// она с LIMIT 200 и не сгруппирована по дням). Берём последнее движение
// каждого дня (его on_hand_after/reserved_after — это и есть остаток на
// конец дня), дни без движений допериод-заполняем предыдущим известным
// значением, а до самого первого движения в окне — текущим on_hand/reserved
// материала (наименее ошибочное предположение: остаток тогда либо был
// таким же, либо мы просто не знаем и не хотим рисовать провал в ноль).
async function dailySnapshot(query) {
  const materialId = query && query.materialId;
  if (!materialId) return { days: [], materialName: '', unit: '' };
  const days = Math.max(1, Math.min(90, Number(query.days) || 30));

  const { rows: matRows } = await db.pool.query(
    'SELECT name, unit, stock_on_hand, stock_reserved FROM materials WHERE id = $1',
    [materialId]
  );
  if (!matRows.length) return { days: [], materialName: '', unit: '' };
  const material = matRows[0];

  const { rows } = await db.pool.query(
    `SELECT
       to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
       (array_agg(on_hand_after ORDER BY created_at DESC))[1] AS on_hand_end,
       (array_agg(reserved_after ORDER BY created_at DESC))[1] AS reserved_end,
       COUNT(*)::int AS movements,
       COALESCE(SUM(CASE WHEN kind = 'receipt' THEN qty ELSE 0 END), 0) AS received,
       COALESCE(SUM(CASE WHEN kind = 'writeoff' THEN -qty ELSE 0 END), 0) AS consumed
     FROM stock_movements
     WHERE material_id = $1 AND created_at >= now() - ($2 || ' days')::interval
     GROUP BY day
     ORDER BY day`,
    [materialId, days]
  );
  const byDay = {};
  rows.forEach((r) => { byDay[r.day] = r; });

  const result = [];
  let lastOnHand = Number(material.stock_on_hand);
  let lastReserved = Number(material.stock_reserved);
  // Идём от старого дня к today: пока не встретили первую реальную запись,
  // текущий остаток материала — единственная опорная точка, что есть.
  // Как только встретили запись — от неё дальше и отталкиваемся вперёд.
  const today = new Date();
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push(key);
  }
  // Если в окне вообще есть движения — базовая точка "до окна" берётся из
  // on_hand_before самого первого движения этого материала (а не из
  // текущего on_hand, которое отражает уже сегодняшнее состояние).
  const { rows: firstRow } = await db.pool.query(
    `SELECT on_hand_before, reserved_before FROM stock_movements
     WHERE material_id = $1 AND created_at >= now() - ($2 || ' days')::interval
     ORDER BY created_at ASC LIMIT 1`,
    [materialId, days]
  );
  if (firstRow.length) {
    lastOnHand = Number(firstRow[0].on_hand_before);
    lastReserved = Number(firstRow[0].reserved_before);
  }
  series.forEach((day) => {
    const row = byDay[day];
    if (row) {
      lastOnHand = Number(row.on_hand_end);
      lastReserved = Number(row.reserved_end);
      result.push({
        date: day, onHand: lastOnHand, reserved: lastReserved,
        movements: row.movements, received: Number(row.received), consumed: Number(row.consumed)
      });
    } else {
      result.push({ date: day, onHand: lastOnHand, reserved: lastReserved, movements: 0, received: 0, consumed: 0 });
    }
  });

  return { days: result, materialName: material.name, unit: material.unit };
}

module.exports = { list, dailySnapshot };
