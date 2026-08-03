# backup.ps1 - 完整备份脚本
# 用法: powershell -ExecutionPolicy Bypass -File backup.ps1 -SourcePath "..." -BackupRoot "D:\jz\.backup"
param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$BackupRoot
)

$ErrorActionPreference = 'Stop'

# 创建时间戳目录
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "image-gen-app-$timestamp"
$backupPath = Join-Path $BackupRoot $backupName

Write-Host "[BACKUP] 源: $SourcePath" -ForegroundColor Cyan
Write-Host "[BACKUP] 目标: $backupPath" -ForegroundColor Cyan

# 创建备份根目录
if (-not (Test-Path -LiteralPath $BackupRoot)) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    Write-Host "[BACKUP] 创建备份根目录: $BackupRoot"
}

# 使用 robocopy 完整镜像
# /MIR 镜像模式 /R:3 失败重试3次 /W:5 等待5秒 /MT:8 8线程
$robocopyArgs = @(
    $SourcePath,
    $backupPath,
    "/MIR",
    "/R:3",
    "/W:5",
    "/MT:8",
    "/NFL",  # 不记录文件列表，减少日志
    "/NDL",  # 不记录目录列表
    "/NP"    # 不显示进度
)

Write-Host "[BACKUP] 开始 robocopy 完整镜像（包含 node_modules 等所有内容，便于回滚后立即可用）..."
$process = Start-Process -FilePath "robocopy.exe" -ArgumentList $robocopyArgs -NoNewWindow -Wait -PassThru
$exitCode = $process.ExitCode

# robocopy 退出码: 0=无变化 1=复制成功 2=额外文件 3=选择 0-7=成功 8+=失败
if ($exitCode -ge 8) {
    Write-Host "[BACKUP] FAIL 退出码: $exitCode" -ForegroundColor Red
    exit 1
}

# 计算备份大小
$backupSize = (Get-ChildItem -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
$backupSizeGB = [math]::Round($backupSize / 1GB, 2)

Write-Host "[BACKUP] OK 完成" -ForegroundColor Green
Write-Host "[BACKUP] 路径: $backupPath"
Write-Host "[BACKUP] 大小: $backupSizeGB GB"
Write-Host "[BACKUP] 退出码: $exitCode"

# 输出备份信息到标准输出（供后续脚本解析）
Write-Output "BACKUP_PATH=$backupPath"
Write-Output "BACKUP_SIZE=$backupSize"
Write-Output "BACKUP_EXITCODE=$exitCode"

exit 0
