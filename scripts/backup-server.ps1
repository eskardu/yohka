param(
  [string]$Server = "186.246.31.163",
  [string]$User = "root",
  [string]$RemotePath = "/opt/yohka",
  [string]$BackupDir = "$PSScriptRoot\..\backups"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "ssh not found. Install OpenSSH Client in Windows."
}

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
  throw "scp not found. Install OpenSSH Client in Windows."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDirPath = (New-Item -ItemType Directory -Force -Path $BackupDir).FullName
$localArchive = Join-Path $backupDirPath "yohka-latest.tar.gz"
$localInfo = Join-Path $backupDirPath "yohka-latest.txt"
$remoteScriptPath = "/tmp/yohka-backup-$timestamp.sh"
$remoteArchive = "/tmp/yohka-full-$timestamp.tar.gz"
$target = "$User@$Server"
$scriptUploaded = $false

function Invoke-CheckedNative {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

$remoteScriptTemplate = @'
set -e
REMOTE_PATH="__REMOTE_PATH__"
TMP="/tmp/yohka-backup-__TIMESTAMP__"
ARCHIVE="__REMOTE_ARCHIVE__"

cd "$REMOTE_PATH"
rm -rf "$TMP"
mkdir -p "$TMP/uploads"

docker compose exec -T postgres sh -lc 'PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -U "${POSTGRES_USER:-yohkar}" -d "${POSTGRES_DB:-yohkar}" -Fc' > "$TMP/database.dump"
cp .env.production "$TMP/.env.production"
git rev-parse HEAD > "$TMP/git-commit.txt" 2>/dev/null || true

UPLOADS_DIR=$(docker volume inspect yohka_uploads_data --format '{{ .Mountpoint }}')
if [ -d "$UPLOADS_DIR" ]; then
  cp -a "$UPLOADS_DIR"/. "$TMP/uploads"/
fi

tar -czf "$ARCHIVE" -C "$TMP" .
rm -rf "$TMP"
'@

$remoteScript = $remoteScriptTemplate.Replace("__REMOTE_PATH__", $RemotePath).Replace("__TIMESTAMP__", $timestamp).Replace("__REMOTE_ARCHIVE__", $remoteArchive)

$localScript = Join-Path ([System.IO.Path]::GetTempPath()) "yohka-backup-$timestamp.sh"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($localScript, $remoteScript, $utf8NoBom)

try {
  Write-Host "Creating backup on server..."
  Invoke-CheckedNative "scp" @($localScript, "${target}:$remoteScriptPath")
  $scriptUploaded = $true
  Invoke-CheckedNative "ssh" @($target, "bash '$remoteScriptPath'")

  Write-Host "Downloading backup to this computer..."
  Remove-Item -LiteralPath $localArchive -Force -ErrorAction SilentlyContinue
  Invoke-CheckedNative "scp" @("${target}:$remoteArchive", $localArchive)
  $createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Set-Content -LiteralPath $localInfo -Value @(
    "created_at=$createdAt",
    "server=$Server",
    "remote_path=$RemotePath",
    "archive=$localArchive"
  ) -Encoding UTF8

  Write-Host "Done: $localArchive"
} finally {
  Remove-Item -LiteralPath $localScript -Force -ErrorAction SilentlyContinue
  if ($scriptUploaded) {
    $cleanupCommand = "rm -f `"$remoteScriptPath`" `"$remoteArchive`""
    ssh -o BatchMode=yes $target $cleanupCommand *> $null
  }
}
