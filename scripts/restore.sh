#!/usr/bin/env bash
# Восстановление базы calc из бэкапа, сделанного scripts/backup.sh.
# ВНИМАНИЕ: перезаписывает текущие данные в БД (DROP+CREATE через pg_restore/psql).
# Использование: ./scripts/restore.sh backups/calc-20260824-030000.sql.gz [backups/uploads-20260824-030000.tar.gz]
# Архив файлов (второй аргумент) необязателен: если не указан, ищется
# uploads-<та же метка>.tar.gz рядом с дампом; нет такого (бэкап старше
# реестра оплат) — восстанавливается только база, как раньше.
set -euo pipefail

FILE="${1:?Укажите путь к файлу бэкапа: ./scripts/restore.sh backups/calc-....sql.gz}"
CONTAINER="${CONTAINER:-adat-calc-db}"
DB_NAME="${POSTGRES_DB:-calc}"
DB_USER="${POSTGRES_USER:-calc}"
UPLOADS_DIR="${UPLOADS_DIR:-$(dirname "$0")/../uploads}"
UPLOADS_ARCHIVE="${2:-}"
if [ -z "$UPLOADS_ARCHIVE" ]; then
  STAMP=$(basename "$FILE" | sed -n 's/^calc-\(.*\)\.sql\.gz$/\1/p')
  if [ -n "$STAMP" ] && [ -f "$(dirname "$FILE")/uploads-$STAMP.tar.gz" ]; then
    UPLOADS_ARCHIVE="$(dirname "$FILE")/uploads-$STAMP.tar.gz"
  fi
fi

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

# Файлы разворачиваются поверх текущего каталога: существующие файлы с теми
# же именами перезаписываются, лишние не удаляются (имена случайные, конфликтов нет).
if [ -n "$UPLOADS_ARCHIVE" ]; then
  if [ ! -f "$UPLOADS_ARCHIVE" ]; then
    echo "Архив файлов не найден: $UPLOADS_ARCHIVE" >&2
    exit 1
  fi
  echo "Восстановление файлов из $UPLOADS_ARCHIVE в $UPLOADS_DIR..."
  mkdir -p "$UPLOADS_DIR"
  tar -xzf "$UPLOADS_ARCHIVE" -C "$UPLOADS_DIR" --strip-components=1
else
  echo "Архив файлов не найден рядом с дампом — восстановлена только база."
fi
echo "Готово."
