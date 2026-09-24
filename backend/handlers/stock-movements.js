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

module.exports = { list };
