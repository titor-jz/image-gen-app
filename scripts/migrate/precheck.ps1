# precheck.ps1 - Migration precheck
param(
    [string]$SourcePath = "d:\jz\project\image-gen-app",
    [string]$TargetPath = "D:\jz\image-gen-app"
)

$Blockers = @()
$Warnings = @()

Write-Host ""
Write-Host "[CHECK 1/5] Source directory exists..." -NoNewline
if (Test-Path -LiteralPath $SourcePath) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " FAIL" -ForegroundColor Red
    $Blockers += "Source does not exist: $SourcePath"
}

Write-Host "[CHECK 2/5] Source directory readable..." -NoNewline
try {
    $null = Get-ChildItem -LiteralPath $SourcePath -Force -ErrorAction Stop
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " FAIL" -ForegroundColor Red
    $Blockers += "Source not readable: $($_.Exception.Message)"
}

Write-Host "[CHECK 3/5] Target parent writable..." -NoNewline
$parentPath = Split-Path $TargetPath -Parent
if (-not (Test-Path -LiteralPath $parentPath)) {
    Write-Host " FAIL" -ForegroundColor Red
    $Blockers += "Parent dir missing: $parentPath"
} else {
    $testFile = $parentPath + [char]92 + "test_" + [guid]::NewGuid().ToString("N") + ".tmp"
    try {
        $fs = [System.IO.File]::Open($testFile, [System.IO.FileMode]::Create)
        $fs.Close()
        [System.IO.File]::Delete($testFile)
        Write-Host " OK" -ForegroundColor Green
    } catch {
        Write-Host " FAIL" -ForegroundColor Red
        $Blockers += "Parent not writable: $($_.Exception.Message)"
    }
}

Write-Host "[CHECK 4/5] Target subdir state..." -NoNewline
if (Test-Path -LiteralPath $TargetPath) {
    $existing = @(Get-ChildItem -LiteralPath $TargetPath -Force)
    if ($existing.Count -gt 0) {
        Write-Host " FAIL" -ForegroundColor Red
        $Blockers += "Target exists and not empty: $TargetPath"
    } else {
        Write-Host " WARN-EMPTY" -ForegroundColor Yellow
        $Warnings += "Target exists but empty, will reuse"
    }
} else {
    Write-Host " OK" -ForegroundColor Green
}

Write-Host "[CHECK 5/5] Disk space..." -NoNewline
try {
    $driveLetter = $parentPath.Substring(0, 1)
    $driveInfo = New-Object System.IO.DriveInfo $driveLetter
    $freeGB = [math]::Round($driveInfo.AvailableFreeSpace / 1GB, 2)
    if ($freeGB -lt 1) {
        Write-Host " FAIL ${freeGB}GB" -ForegroundColor Red
        $Blockers += "Low disk space: ${freeGB}GB"
    } else {
        Write-Host " OK ${freeGB}GB" -ForegroundColor Green
    }
} catch {
    Write-Host " SKIP" -ForegroundColor Yellow
    $Warnings += "Cannot check disk: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "===== Result =====" -ForegroundColor Cyan
if ($Blockers.Count -eq 0) {
    Write-Host "PASS" -ForegroundColor Green
    if ($Warnings.Count -gt 0) {
        Write-Host "Warnings:" -ForegroundColor Yellow
        foreach ($w in $Warnings) { Write-Host "  - $w" -ForegroundColor Yellow }
    }
    exit 0
} else {
    Write-Host "FAIL" -ForegroundColor Red
    foreach ($b in $Blockers) { Write-Host "  - $b" -ForegroundColor Red }
    exit 1
}
