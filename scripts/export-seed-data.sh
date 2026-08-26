#!/usr/bin/env bash
# Полный экспорт "справочных" данных (без истории заказов и сессий) из
# указанной БД (по умолчанию — локальная тестовая calc_test) в файл с
# INSERT-командами. Используется для первоначального заполнения боевой
# базы данными из теста, когда прод стартует "с нуля" (пустая история
# заказов, но актуальные заводы/сотрудники/техника/материалы/рецепты).
#
# Использование:
#   ./scripts/export-seed-data.sh seed-data.sql
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/export-seed-data.sh out.sql
set -euo pipefail

OUT_FILE="${1:?Укажите путь к выходному файлу: ./scripts/export-seed-data.sh seed-data.sql}"
DB_URL="${DATABASE_URL:-postgres://localhost:5432/calc_test}"

pg_dump "$DB_URL" \
  --data-only \
  --column-inserts \
  --disable-triggers \
  --table=plants \
  --table=employees \
  --table=mixers \
  --table=aggregate_trucks \
  --table=materials \
  --table=recipes \
  --table=recipe_items \
  --table=config \
  > "$OUT_FILE"

echo "Экспортировано в $OUT_FILE"
