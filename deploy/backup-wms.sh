#!/bin/sh
set -eu
umask 077
backup_dir=${WMS_BACKUP_DIR:-/home/deploy/wms-expedicao/backups}
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/wms_expedicao_$stamp.dump"
temporary="$target.partial"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
docker exec wms_postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d wms_expedicao -Fc' > "$temporary"
test -s "$temporary"
docker exec -i wms_postgres pg_restore --list < "$temporary" > /dev/null
mv "$temporary" "$target"
sha256sum "$target" > "$target.sha256"
printf 'Backup WMS validado: %s\n' "$target"
