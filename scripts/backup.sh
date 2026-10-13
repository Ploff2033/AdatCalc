#!/usr/bin/env bash
# Бэкап Postgres-базы calc из контейнера adat-calc-db в сжатый .sql.gz на хосте
# + архив загруженных файлов (uploads/: счета реестра оплат, фото чеков ДДС) с той
# же меткой времени — после переезда счетов из облака они хранятся только на сервере.
# Рассчитан на запуск по cron НА ХОСТЕ (не внутри контейнера), рядом с docker-compose.yml.
#
# Пример cron-строки (каждую ночь в 03:00, хранить 14 дней):
#   0 3 * * * cd /opt/adat-calc && BACKUP_DIR=/opt/adat-calc/backups RETENTION_DAYS=14 ./scripts/backup.sh >> /var/log/adat-calc-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Каталог, примонтированный в контейнер как backend/uploads (см. docker-compose.yml).
UPLOADS_DIR="${UPLOADS_DIR:-$(dirname "$0")/../uploads}"
CONTAINER="${CONTAINER:-adat-calc-db}"
DB_NAME="${POSTGRES_DB:-calc}"
DB_USER="${POSTGRES_USER:-calc}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/calc-$STAMP.sql.gz"
TMP_FILE="$FILE.tmp"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$TMP_FILE"
mv "$TMP_FILE" "$FILE"

echo "Бэкап сохранён: $FILE ($(du -h "$FILE" | cut -f1))"

# Файлы: нет каталога (ещё ничего не загружали) — не ошибка, просто пропускаем.
if [ -d "$UPLOADS_DIR" ]; then
  UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
  tar -czf "$UPLOADS_FILE.tmp" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  mv "$UPLOADS_FILE.tmp" "$UPLOADS_FILE"
  echo "Файлы сохранены: $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1); каталог uploads: $(du -sh "$UPLOADS_DIR" | cut -f1))"
else
  echo "Каталог файлов $UPLOADS_DIR не найден — архив файлов пропущен"
fi

find "$BACKUP_DIR" -name 'calc-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
