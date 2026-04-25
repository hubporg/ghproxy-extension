param(
    [ValidateSet('chrome', 'firefox', 'all')]
    [string]$Target = 'all'
)

$distDir = "dist"
if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$files = @("background.js", "popup.js", "intercept.js", "browser-polyfill.js", "popup.html", "intercept.html", "manifest.json", "icons", "README.md", "LICENSE")

if ($Target -eq 'chrome' -or $Target -eq 'all') {
    Compress-Archive -Path $files -DestinationPath "$distDir\ghproxy-extension-chrome.zip" -Force
    Write-Host "Chrome/Edge zip: $distDir\ghproxy-extension-chrome.zip"
}

if ($Target -eq 'firefox' -or $Target -eq 'all') {
    Copy-Item manifest-firefox.json manifest.json -Force
    Compress-Archive -Path $files -DestinationPath "$distDir\ghproxy-extension-firefox.zip" -Force
    git checkout -- manifest.json
    Write-Host "Firefox zip: $distDir\ghproxy-extension-firefox.zip"
}

if ($Target -eq 'all') {
    Write-Host "Done. Files in $distDir"
}
