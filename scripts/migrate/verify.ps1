# verify.ps1 - 验证脚本
# 用法: powershell -ExecutionPolicy Bypass -File verify.ps1 -SourcePath "..." -TargetPath "D:\jz\image-gen-app"
param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
)

$ErrorActionPreference = 'Continue'
$Report = @{
    RequiredFiles = @{}
    ExcludedItems = @{}
    GitStatus = ""
    HashCheck = @{}
}

Write-Host "[VERIFY] 源: $SourcePath" -ForegroundColor Cyan
Write-Host "[VERIFY] 目标: $TargetPath" -ForegroundColor Cyan
Write-Host ""

# === 1. 关键文件存在性检查 ===
Write-Host "[VERIFY 1/4] 关键文件存在性..." -ForegroundColor Cyan
$requiredPaths = @(
    "app",
    "components",
    "electron",
    "lib",
    "public",
    "scripts",
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "AGENTS.md",
    "README.md"
)

$allRequiredExist = $true
foreach ($p in $requiredPaths) {
    $fullPath = Join-Path $TargetPath $p
    if (Test-Path -LiteralPath $fullPath) {
        $Report.RequiredFiles[$p] = "OK"
        Write-Host "  [OK] $p" -ForegroundColor Green
    } else {
        $Report.RequiredFiles[$p] = "MISSING"
        Write-Host "  [MISSING] $p" -ForegroundColor Red
        $allRequiredExist = $false
    }
}

# === 2. 排除项核查 ===
Write-Host ""
Write-Host "[VERIFY 2/4] 排除项核查..." -ForegroundColor Cyan
$excludedPaths = @(
    @{ Path = "node_modules"; Type = "Directory" },
    @{ Path = ".next"; Type = "Directory" },
    @{ Path = "dist2"; Type = "Directory" },
    @{ Path = "build"; Type = "Directory" },
    @{ Path = "tsconfig.tsbuildinfo"; Type = "File" }
)

$allExcludedCorrect = $true
foreach ($item in $excludedPaths) {
    $fullPath = Join-Path $TargetPath $item.Path
    $exists = Test-Path -LiteralPath $fullPath
    if ($exists) {
        $Report.ExcludedItems[$item.Path] = "STILL_EXISTS (ERROR)"
        Write-Host "  [ERROR] $($item.Path) 不应存在但存在" -ForegroundColor Red
        $allExcludedCorrect = $false
    } else {
        $Report.ExcludedItems[$item.Path] = "EXCLUDED (OK)"
        Write-Host "  [OK] $($item.Path) 未迁移" -ForegroundColor Green
    }
}

# === 3. Git 仓库检查 ===
Write-Host ""
Write-Host "[VERIFY 3/4] Git 仓库状态..." -ForegroundColor Cyan
$gitPath = Join-Path $TargetPath ".git"
if (Test-Path -LiteralPath $gitPath) {
    Push-Location $TargetPath
    try {
        $gitStatus = git status --short 2>&1
        $gitBranch = git rev-parse --abbrev-ref HEAD 2>&1
        $Report.GitStatus = "Branch: $gitBranch, Modified files: $(($gitStatus | Measure-Object).Count)"
        Write-Host "  [OK] .git 存在" -ForegroundColor Green
        Write-Host "  分支: $gitBranch"
        Write-Host "  状态: $(if ($gitStatus) { '有变更' } else { '干净' })"
    } catch {
        $Report.GitStatus = "ERROR: $($_.Exception.Message)"
        Write-Host "  [WARN] Git 命令执行异常: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        Pop-Location
    }
} else {
    $Report.GitStatus = "MISSING"
    Write-Host "  [WARN] .git 目录不存在" -ForegroundColor Yellow
}

# === 4. SHA256 一致性检查（关键文件）===
Write-Host ""
Write-Host "[VERIFY 4/4] 关键文件 SHA256 一致性..." -ForegroundColor Cyan
$hashCheckFiles = @("package.json", "tsconfig.json", "AGENTS.md")
$hashAllMatch = $true

foreach ($f in $hashCheckFiles) {
    $srcFile = Join-Path $SourcePath $f
    $dstFile = Join-Path $TargetPath $f
    if ((Test-Path -LiteralPath $srcFile) -and (Test-Path -LiteralPath $dstFile)) {
        $srcHash = (Get-FileHash -LiteralPath $srcFile -Algorithm SHA256).Hash
        $dstHash = (Get-FileHash -LiteralPath $dstFile -Algorithm SHA256).Hash
        if ($srcHash -eq $dstHash) {
            $Report.HashCheck[$f] = "MATCH"
            Write-Host "  [OK] $f (SHA256 一致)" -ForegroundColor Green
        } else {
            $Report.HashCheck[$f] = "MISMATCH"
            Write-Host "  [ERROR] $f SHA256 不一致" -ForegroundColor Red
            $hashAllMatch = $false
        }
    } else {
        $Report.HashCheck[$f] = "SKIP (file not found)"
        Write-Host "  [SKIP] $f 文件不存在" -ForegroundColor Yellow
    }
}

# === 5. .env 文件检查 ===
Write-Host ""
Write-Host "[VERIFY 5/5] .env 文件状态..." -ForegroundColor Cyan
$envFiles = @(".env", ".env.local", ".env.example", ".env.local.example")
foreach ($env in $envFiles) {
    $srcFile = Join-Path $SourcePath $env
    $dstFile = Join-Path $TargetPath $env
    $srcExists = Test-Path -LiteralPath $srcFile
    $dstExists = Test-Path -LiteralPath $dstFile
    if ($srcExists -and $dstExists) {
        Write-Host "  [OK] $env 已迁移" -ForegroundColor Green
    } elseif ($srcExists -and -not $dstExists) {
        Write-Host "  [WARN] $env 源存在但目标不存在" -ForegroundColor Yellow
    } elseif (-not $srcExists) {
        Write-Host "  [INFO] $env 源不存在" -ForegroundColor Gray
    }
}

# === 总结 ===
Write-Host ""
Write-Host "===== 验证结果 =====" -ForegroundColor Cyan
$isValid = $allRequiredExist -and $allExcludedCorrect -and $hashAllMatch
if ($isValid) {
    Write-Host "[VERIFY] OK 验证通过" -ForegroundColor Green
} else {
    Write-Host "[VERIFY] FAIL 验证未通过" -ForegroundColor Red
}

Write-Output "VERIFY_VALID=$isValid"

exit $(if ($isValid) { 0 } else { 1 })
