#!/usr/bin/env bash
# Экспорт materials/recipes/recipe_items из указанной БД (по умолчанию —
# локальная тестовая calc_test) в файл с INSERT-командами — для переноса
# на другую БД (например, при первом деплое на прод, когда тестовые
# материалы/рецепты актуальнее того, что было в старом data/db.json).
#
# Использование:
#   ./scripts/export-materials-recipes.sh materials-recipes.sql
#   DATABASE_URL=postgres://user:pass@host:5432/dbname ./scripts/export-materials-recipes.sh out.sql
set -euo pipefail

OUT_FILE="${1:?Укажите путь к выходному файлу: ./scripts/export-materials-recipes.sh materials-recipes.sql}"
DB_URL="${DATABASE_URL:-postgres://localhost:5432/calc_test}"

pg_dump "$DB_URL" \
  --data-only \
  --column-inserts \
  --table=materials \
  --table=recipes \
  --table=recipe_items \
  > "$OUT_FILE"

# recipe_items.id — serial; pg_dump сам дописывает в конец файла корректный
# SELECT setval('public.recipe_items_id_seq', ...) для восстановления
# sequence — отдельно ничего досогласовывать не нужно.

echo "Экспортировано в $OUT_FILE"
