param(
    [ValidateSet('chrome', 'firefox', 'all')]
    [string]$Target = 'all'
)

$distDir = "dist"
if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
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

$files = @("background.js", "popup.js", "intercept.js", "browser-polyfill.js", "popup.html", "intercept.html", "manifest.json", "icons", "README.md", "LICENSE")

if ($Target -eq 'chrome' -or $Target -eq 'all') {
    $chromeZip = "$distDir\ghproxy-extension-chrome.zip"
    if (Test-Path $chromeZip) {
        Remove-Item $chromeZip -Force
    }
    Create-Zip -ZipPath $chromeZip -Files $files
    Write-Host "Chrome/Edge zip: $chromeZip"
}

if ($Target -eq 'firefox' -or $Target -eq 'all') {
    Copy-Item manifest-firefox.json manifest.json -Force
    $firefoxZip = "$distDir\ghproxy-extension-firefox.zip"
    if (Test-Path $firefoxZip) {
        Remove-Item $firefoxZip -Force
    }
    Create-Zip -ZipPath $firefoxZip -Files $files
    git checkout -- manifest.json
    Write-Host "Firefox zip: $firefoxZip"
}

if ($Target -eq 'all') {
    Write-Host "Done. Files in $distDir"
}
