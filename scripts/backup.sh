#!/usr/bin/env bash
# Бэкап Postgres-базы calc из контейнера adat-calc-db в сжатый .sql.gz на хосте.
# Рассчитан на запуск по cron НА ХОСТЕ (не внутри контейнера), рядом с docker-compose.yml.
#
# Пример cron-строки (каждую ночь в 03:00, хранить 14 дней):
#   0 3 * * * cd /opt/adat-calc && BACKUP_DIR=/opt/adat-calc/backups RETENTION_DAYS=14 ./scripts/backup.sh >> /var/log/adat-calc-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER="${CONTAINER:-adat-calc-db}"
DB_NAME="${POSTGRES_DB:-calc}"
DB_USER="${POSTGRES_USER:-calc}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/calc-$STAMP.sql.gz"
TMP_FILE="$FILE.tmp"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$TMP_FILE"
mv "$TMP_FILE" "$FILE"

find "$BACKUP_DIR" -name 'calc-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Бэкап сохранён: $FILE ($(du -h "$FILE" | cut -f1))"
