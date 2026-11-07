#!/bin/sh
# Restores a backup produced by backup.sh into the target database.
#   ./restore.sh backups/monetra-monetra-20260101T000000Z.dump[.enc]
# WARNING: existing objects in the target database are dropped and recreated.
set -eu
FILE="${1:?usage: restore.sh <backup file>}"
DB="${PGDATABASE:-monetra}"

if [ -f "$FILE.sha256" ]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256")
fi

TMP=""
case "$FILE" in
  *.enc)
    : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required for encrypted backups}"
    TMP="$(mktemp)"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$TMP" -pass env:BACKUP_PASSPHRASE
    FILE="$TMP"
    ;;
esac

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DB" "$FILE"
[ -n "$TMP" ] && rm -f "$TMP"
echo "restore complete into $DB"
