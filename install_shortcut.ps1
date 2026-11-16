# Creates a desktop shortcut "Kyrie" that launches every backend and opens the app.
$root = 'D:\work\voice-translate'
$icon = Join-Path $root 'kyrie.ico'
$launcher = Join-Path $root 'launch.ps1'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'Kyrie.lnk'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($link)
$sc.TargetPath = 'powershell.exe'
$sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$sc.WorkingDirectory = $root
$sc.Description = 'Kyrie voice translator — starts all backends and opens the app'
if (Test-Path $icon) { $sc.IconLocation = $icon }
$sc.Save()

Write-Host "Shortcut created: $link"
