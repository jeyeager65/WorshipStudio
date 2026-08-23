<#
.SYNOPSIS
  Deletes every .backup file (the "previous version" sibling write_json_file keeps beside each
  saved file — see src-tauri/src/domain/*.rs's write_json_file) under a WorshipStudio library.

.DESCRIPTION
  Defaults to a dry run (lists what it would delete, deletes nothing) so you can see the scope
  before committing to it. Pass -Confirm to actually delete — it still asks you to type DELETE
  before touching anything, since these are the only recovery copies of whatever each file's
  most recent .backup captured.

.EXAMPLE
  # Dry run — just see what's there
  .\delete-backup-files.ps1 -LibraryPath "C:\Users\jeyea\OneDrive\WorshipStudio\Library"

.EXAMPLE
  # Actually delete (still prompts for a typed confirmation)
  .\delete-backup-files.ps1 -LibraryPath "C:\Users\jeyea\OneDrive\WorshipStudio\Library" -Confirm
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$LibraryPath,
    [switch]$Confirm
)

if (-not (Test-Path $LibraryPath)) {
    Write-Error "Library path not found: $LibraryPath"
    exit 1
}

$backupFiles = Get-ChildItem -Path $LibraryPath -Recurse -Filter "*.backup" -File -ErrorAction SilentlyContinue

if (-not $backupFiles -or $backupFiles.Count -eq 0) {
    Write-Host "No .backup files found under $LibraryPath"
    exit 0
}

$totalSizeMb = [math]::Round((($backupFiles | Measure-Object -Property Length -Sum).Sum) / 1MB, 2)
Write-Host "Found $($backupFiles.Count) .backup files ($totalSizeMb MB) under $LibraryPath"

if (-not $Confirm) {
    Write-Host ""
    $backupFiles | ForEach-Object { Write-Host "  $($_.FullName)" }
    Write-Host ""
    Write-Host "Dry run only -- nothing deleted. Re-run with -Confirm to actually delete."
    exit 0
}

Write-Host ""
$typed = Read-Host "Type DELETE to permanently remove all $($backupFiles.Count) files"
if ($typed -ne "DELETE") {
    Write-Host "Cancelled -- nothing deleted."
    exit 0
}

$backupFiles | Remove-Item -Force -Confirm:$false
Write-Host "Deleted $($backupFiles.Count) .backup files."
