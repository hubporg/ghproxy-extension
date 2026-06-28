param(
    [ValidateSet('chrome', 'firefox', 'all')]
    [string]$Target = 'all',
    [string]$Version = ''
)

$distDir = "dist"
if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

if ($Version -ne '') {
    $manifestFile = "manifest.json"
    $content = [System.IO.File]::ReadAllText($manifestFile)
    $content = $content -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$Version`""
    [System.IO.File]::WriteAllText($manifestFile, $content, (New-Object System.Text.UTF8Encoding $false))

    $manifestFile = "manifest-firefox.json"
    $content = [System.IO.File]::ReadAllText($manifestFile)
    $content = $content -replace '"version"\s*:\s*"[^"]*"', "`"version`": `"$Version`""
    [System.IO.File]::WriteAllText($manifestFile, $content, (New-Object System.Text.UTF8Encoding $false))

    Write-Host "Version set to: $Version"
}

function Create-Zip {
    param(
        [string]$ZipPath,
        [string[]]$Files
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Create')
    foreach ($file in $Files) {
        if (Test-Path $file) {
            $item = Get-Item $file
            if ($item.PSIsContainer) {
                $children = Get-ChildItem -Path $file -Recurse -File
                foreach ($child in $children) {
                    $entryName = $child.FullName.Replace((Get-Location).Path + '\', '') -replace '\\', '/'
                    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $child.FullName, $entryName) | Out-Null
                }
            } else {
                $entryName = $item.FullName.Replace((Get-Location).Path + '\', '') -replace '\\', '/'
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, $entryName) | Out-Null
            }
        }
    }
    $archive.Dispose()
}

$files = @("background.js", "popup.js", "privacy.js", "intercept.js", "browser-polyfill.js", "stats.js", "popup.html", "privacy.html", "intercept.html", "manifest.json", "icons", "README.md", "LICENSE")

if ($Target -eq 'chrome' -or $Target -eq 'all') {
    # Chrome 打包：直接使用 manifest.json
    $chromeZip = "$distDir\ghproxy-extension-chrome.zip"
    if (Test-Path $chromeZip) {
        Remove-Item $chromeZip -Force
    }
    Create-Zip -ZipPath $chromeZip -Files $files
    Write-Host "Chrome/Edge zip: $chromeZip"
}

if ($Target -eq 'firefox' -or $Target -eq 'all') {
    # Firefox 打包：临时把 manifest.json 重命名为 manifest-chrome.json 备份
    # 再用 manifest-firefox.json 覆盖为 manifest.json，打包完恢复
    if (Test-Path "manifest.json") {
        Rename-Item manifest.json manifest-chrome.json -Force
    }
    Copy-Item manifest-firefox.json manifest.json -Force

    $firefoxZip = "$distDir\ghproxy-extension-firefox.zip"
    if (Test-Path $firefoxZip) {
        Remove-Item $firefoxZip -Force
    }
    Create-Zip -ZipPath $firefoxZip -Files $files
    Write-Host "Firefox zip: $firefoxZip"

    # Firefox 打包完成后恢复 manifest.json
    Remove-Item manifest.json -Force
    if (Test-Path "manifest-chrome.json") {
        Rename-Item manifest-chrome.json manifest.json -Force
    }
}

if ($Target -eq 'all') {
    Write-Host "Done. Files in $distDir"
}

# CRX3 packing
Write-Host "`nPacking CRX3..."
$crxDir = "$distDir\crx"
if (Test-Path $crxDir) {
    Remove-Item $crxDir -Recurse -Force
}
New-Item -ItemType Directory -Path $crxDir | Out-Null

# Use Chrome zip for CRX packing
$chromeZip = "$distDir\ghproxy-extension-chrome.zip"
if (!(Test-Path $chromeZip)) {
    Write-Error "Chrome zip not found. Please build Chrome package first."
    exit 1
}

# Extract to crx directory
Expand-Archive -Path $chromeZip -DestinationPath $crxDir -Force

# Pack CRX3
$pemFile = "ghproxy-extension.pem"
$crxFile = "$distDir\ghproxy-extension.crx"

if (!(Test-Path $pemFile)) {
    Write-Error "Private key not found: $pemFile"
    exit 1
}

if (Test-Path $crxFile) {
    Remove-Item $crxFile -Force
}

Write-Host "Creating CRX3 package..."
crx3 --private-key=$pemFile --crx=$crxFile $crxDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "CRX3 packaging failed."
    Remove-Item $crxDir -Recurse -Force
    exit 1
}

# Cleanup temporary directory
Remove-Item $crxDir -Recurse -Force

Write-Host "CRX3 package: $crxFile"
Write-Host "Done."
