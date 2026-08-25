#!/usr/bin/env bash
# Восстановление базы calc из бэкапа, сделанного scripts/backup.sh.
# ВНИМАНИЕ: перезаписывает текущие данные в БД (DROP+CREATE через pg_restore/psql).
# Использование: ./scripts/restore.sh backups/calc-20260824-030000.sql.gz
set -euo pipefail

FILE="${1:?Укажите путь к файлу бэкапа: ./scripts/restore.sh backups/calc-....sql.gz}"
CONTAINER="${CONTAINER:-adat-calc-db}"
DB_NAME="${POSTGRES_DB:-calc}"
DB_USER="${POSTGRES_USER:-calc}"

if [ ! -f "$FILE" ]; then
  echo "Файл не найден: $FILE" >&2
  exit 1
fi

read -r -p "Это ПЕРЕЗАПИШЕТ текущую базу '$DB_NAME' в контейнере '$CONTAINER'. Продолжить? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Отменено."
  exit 1
fi

echo "Восстановление $DB_NAME из $FILE..."
gunzip -c "$FILE" | docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" "$DB_NAME"
echo "Готово."
