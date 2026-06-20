param(
  [string]$Server = "186.246.31.163",
  [string]$User = "root",
  [string]$RemotePath = "/opt/yohka",
  [string]$BackupDir = "$PSScriptRoot\..\backups"
)

$ErrorActionPreference = "Stop"
$target = "$User@$Server"

& "$PSScriptRoot\backup-server.ps1" `
  -Server $Server `
  -User $User `
  -RemotePath $RemotePath `
  -BackupDir $BackupDir

Write-Host "Updating server..."
ssh $target "cd '$RemotePath' && git pull && docker compose up -d --build"
Write-Host "Server updated. Backup saved on this computer."
