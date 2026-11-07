#!/bin/sh
# Creates a compressed PostgreSQL backup and prunes old ones.
#
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE   standard libpq connection variables
#   BACKUP_DIR              where dumps are written (default ./backups)
#   BACKUP_RETENTION_DAYS   delete dumps older than this (default 14)
#   BACKUP_PASSPHRASE       if set, the dump is encrypted with AES-256 (openssl, PBKDF2)
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
DB="${PGDATABASE:-monetra}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
umask 077

FILE="$BACKUP_DIR/monetra-$DB-$STAMP.dump"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$DB" --file="$FILE"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_PASSPHRASE
  rm -f "$FILE"
  FILE="$FILE.enc"
fi

# Record a checksum so restores can be verified.
(cd "$(dirname "$FILE")" && sha256sum "$(basename "$FILE")") > "$FILE.sha256"
echo "backup written: $FILE ($(wc -c < "$FILE") bytes)"

find "$BACKUP_DIR" -name 'monetra-*.dump*' -type f -mtime +"$RETENTION" -print -delete
