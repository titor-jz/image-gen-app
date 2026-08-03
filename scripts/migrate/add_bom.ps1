# add_bom.ps1 - 为脚本文件添加 UTF-8 BOM
$ErrorActionPreference = 'Stop'
$files = @(
    "d:\jz\project\image-gen-app\scripts\migrate\precheck.ps1",
    "d:\jz\project\image-gen-app\scripts\migrate\backup.ps1",
    "d:\jz\project\image-gen-app\scripts\migrate\copy.ps1",
    "d:\jz\project\image-gen-app\scripts\migrate\verify.ps1",
    "d:\jz\project\image-gen-app\scripts\migrate\cleanup.ps1"
)

$bom = [byte[]](0xEF, 0xBB, 0xBF)

foreach ($f in $files) {
    if (Test-Path -LiteralPath $f) {
        $content = [System.IO.File]::ReadAllBytes($f)
        # Check if already has BOM
        if ($content.Length -ge 3 -and $content[0] -eq 0xEF -and $content[1] -eq 0xBB -and $content[2] -eq 0xBF) {
            Write-Host "Already has BOM: $f"
        } else {
            $newContent = $bom + $content
            [System.IO.File]::WriteAllBytes($f, $newContent)
            Write-Host "Added BOM: $f"
        }
    } else {
        Write-Host "Not found: $f"
    }
}

Write-Host "Done."
