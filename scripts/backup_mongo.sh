#!/usr/bin/env bash
# MongoDB backup script for Alyssa Driver Checkpoint v1.0
# Usage: ./scripts/backup_mongo.sh [BACKUP_ROOT]
# Default BACKUP_ROOT: /backups

set -euo pipefail

BACKUP_ROOT="${1:-/backups}"
TODAY="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="${BACKUP_ROOT}/${TODAY}"

# Load env
if [ -f "/app/backend/.env" ]; then
  set -a; . /app/backend/.env; set +a
fi

if [ -z "${MONGO_URL:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "ERROR: MONGO_URL and DB_NAME must be set (load from backend/.env)." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
echo "[backup] Dumping ${DB_NAME} → ${OUT_DIR}"
mongodump --uri="${MONGO_URL}" --db="${DB_NAME}" --out="${OUT_DIR}"

# Compress
echo "[backup] Compressing..."
tar -czf "${OUT_DIR}.tar.gz" -C "${BACKUP_ROOT}" "${TODAY}"
rm -rf "${OUT_DIR}"

# Retention: keep last 30 days
echo "[backup] Pruning backups older than 30 days..."
find "${BACKUP_ROOT}" -maxdepth 1 -name "*.tar.gz" -mtime +30 -delete

echo "[backup] Done. File: ${OUT_DIR}.tar.gz"
echo "[backup] Size: $(du -h ${OUT_DIR}.tar.gz | cut -f1)"
