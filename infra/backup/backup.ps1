# Windows backup helper (PowerShell). Requires PostgreSQL client tools (pg_dump) on PATH.
#   $env:PGPASSWORD = 'monetra'; ./infra/backup/backup.ps1 -Database monetra
param(
  [string]$Database = $(if ($env:PGDATABASE) { $env:PGDATABASE } else { 'monetra' }),
  [string]$HostName = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
  [string]$User = $(if ($env:PGUSER) { $env:PGUSER } else { 'monetra' }),
  [string]$BackupDir = '.\backups',
  [int]$RetentionDays = 14
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$file = Join-Path $BackupDir "monetra-$Database-$stamp.dump"
& pg_dump --format=custom --compress=9 --no-owner --no-privileges --host=$HostName --username=$User --dbname=$Database --file=$file
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
(Get-FileHash -Algorithm SHA256 $file).Hash.ToLower() + "  " + (Split-Path $file -Leaf) | Set-Content "$file.sha256"
Write-Host "backup written: $file"
Get-ChildItem $BackupDir -Filter 'monetra-*.dump*' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | Remove-Item
