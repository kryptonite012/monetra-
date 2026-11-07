#!/bin/sh
# Used by the docker-compose "backup" service: runs backup.sh on an interval.
set -eu
if [ -n "${BACKUP_PASSPHRASE:-}" ] && ! command -v openssl >/dev/null 2>&1; then
  apk add --no-cache openssl >/dev/null
fi
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  sh /scripts/backup.sh || echo "backup failed at $(date -u)" >&2
  sleep "$INTERVAL"
done
