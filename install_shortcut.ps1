# Creates a desktop shortcut "Kyrie" that launches every backend and opens the app.
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
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

# Kill switch shortcut: Ctrl+Alt+K stops all Kyrie services instantly.
$stopper = Join-Path $root 'stop.ps1'
$killLink = Join-Path $desktop 'Kill Kyrie.lnk'
$kill = $shell.CreateShortcut($killLink)
$kill.TargetPath = 'powershell.exe'
$kill.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$stopper`""
$kill.WorkingDirectory = $root
$kill.Description = 'Kyrie kill switch - stops all Kyrie backends (Ctrl+Alt+K)'
$kill.Hotkey = 'Ctrl+Alt+K'
if (Test-Path $icon) { $kill.IconLocation = $icon }
$kill.Save()

Write-Host "Shortcut created: $killLink"
