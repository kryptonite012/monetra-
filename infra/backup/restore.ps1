# Windows restore helper (PowerShell). Drops and recreates objects in the target database.
#   ./infra/backup/restore.ps1 -File .\backups\monetra-monetra-20260101T000000Z.dump
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Database = $(if ($env:PGDATABASE) { $env:PGDATABASE } else { 'monetra' }),
  [string]$HostName = $(if ($env:PGHOST) { $env:PGHOST } else { 'localhost' }),
  [string]$User = $(if ($env:PGUSER) { $env:PGUSER } else { 'monetra' })
)
$ErrorActionPreference = 'Stop'
& pg_restore --clean --if-exists --no-owner --no-privileges --host=$HostName --username=$User --dbname=$Database $File
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed' }
Write-Host "restore complete into $Database"
