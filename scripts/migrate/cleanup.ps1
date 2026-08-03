# cleanup.ps1 - 源目录清理脚本
# 用法: powershell -ExecutionPolicy Bypass -File cleanup.ps1 -SourcePath "d:\jz\project\image-gen-app"
param(
    [Parameter(Mandatory = $true)][string]$SourcePath
)

$ErrorActionPreference = 'Stop'

Write-Host "[CLEANUP] 待删除: $SourcePath" -ForegroundColor Yellow
Write-Host ""

# 二次确认
$confirmation = Read-Host "确认删除源目录吗？此操作不可逆（备份在 D:\jz\.backup\）。请输入 YES 继续"
if ($confirmation -ne "YES") {
    Write-Host "[CLEANUP] 已取消，源目录保留" -ForegroundColor Yellow
    exit 2
}

# 二次确认
$confirmation2 = Read-Host "请再次确认：您了解删除后只能从备份恢复。输入 DELETE 继续"
if ($confirmation2 -ne "DELETE") {
    Write-Host "[CLEANUP] 已取消，源目录保留" -ForegroundColor Yellow
    exit 2
}

# 执行删除
if (Test-Path -LiteralPath $SourcePath) {
    Write-Host "[CLEANUP] 正在删除..." -ForegroundColor Yellow
    try {
        Remove-Item -LiteralPath $SourcePath -Recurse -Force -ErrorAction Stop
        Write-Host "[CLEANUP] OK 源目录已删除" -ForegroundColor Green
        exit 0
    } catch {
        Write-Host "[CLEANUP] FAIL 删除失败: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[CLEANUP] 源目录不存在，无需删除" -ForegroundColor Yellow
    exit 0
}
