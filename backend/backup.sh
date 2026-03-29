#!/bin/bash
set -e

BACKUP_DIR="/root/BotPrimeX/backend/backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="botprimex_${DATE}.sql.gz"
KEEP_DAYS=30

# Run pg_dump inside the container and compress
docker exec botprimex-postgres pg_dump -U postgres botprimex | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "[$(date)] Backup created: ${FILENAME}"

# Delete backups older than KEEP_DAYS days
find "${BACKUP_DIR}" -name "botprimex_*.sql.gz" -mtime +${KEEP_DAYS} -delete

echo "[$(date)] Old backups cleaned up (kept last ${KEEP_DAYS} days)"
