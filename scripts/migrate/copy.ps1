# copy.ps1 - 选择性复制脚本
# 用法: powershell -ExecutionPolicy Bypass -File copy.ps1 -SourcePath "..." -TargetPath "D:\jz\image-gen-app"
param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
)

$ErrorActionPreference = 'Stop'

Write-Host "[COPY] 源: $SourcePath" -ForegroundColor Cyan
Write-Host "[COPY] 目标: $TargetPath" -ForegroundColor Cyan

# 创建目标目录
if (-not (Test-Path -LiteralPath $TargetPath)) {
    New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null
    Write-Host "[COPY] 创建目标目录"
}

# 排除项定义
# 排除目录: node_modules、.next、dist2、build
$excludeDirs = @("node_modules", ".next", "dist2", "build")

# 排除文件: tsconfig.tsbuildinfo、test-*、启动.bat
$excludeFiles = @(
    "tsconfig.tsbuildinfo",
    "test-*.js",
    "test-*.json",
    "test-output.png",
    "启动.bat"
)

# 构建 robocopy 参数
$robocopyArgs = @(
    $SourcePath,
    $TargetPath,
    "/E",          # 包括空目录
    "/R:3",        # 失败重试3次
    "/W:5",        # 等待5秒
    "/MT:8",       # 8线程
    "/COPY:DAT",   # 复制数据、属性、时间
    "/DCOPY:DAT",  # 目录也复制属性
    "/NFL",        # 不记录文件列表
    "/NDL",        # 不记录目录列表
    "/NP"          # 不显示进度
)

# 添加排除目录
foreach ($dir in $excludeDirs) {
    $robocopyArgs += "/XD"
    $robocopyArgs += $dir
}

# 添加排除文件
foreach ($file in $excludeFiles) {
    $robocopyArgs += "/XF"
    $robocopyArgs += $file
}

Write-Host "[COPY] 排除目录: $($excludeDirs -join ', ')"
Write-Host "[COPY] 排除文件: $($excludeFiles -join ', ')"
Write-Host "[COPY] 开始复制..."

$process = Start-Process -FilePath "robocopy.exe" -ArgumentList $robocopyArgs -NoNewWindow -Wait -PassThru
$exitCode = $process.ExitCode

if ($exitCode -ge 8) {
    Write-Host "[COPY] FAIL 退出码: $exitCode" -ForegroundColor Red
    exit 1
}

Write-Host "[COPY] OK 完成" -ForegroundColor Green
Write-Host "[COPY] 退出码: $exitCode (0-7 表示成功)"

Write-Output "COPY_EXITCODE=$exitCode"

exit 0
