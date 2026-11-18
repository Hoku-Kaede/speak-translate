# One-shot setup for Kyrie: install deps, create shortcuts, start all services.
# Run once after git clone:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $root

Write-Host '=== Kyrie install: dependencies + Malayalam model ==='
& (Join-Path $root 'setup.ps1')
if ($LASTEXITCODE -ne 0) { throw 'setup.ps1 failed. Check logs\setup.log.' }

Write-Host '=== Creating desktop shortcuts ==='
& (Join-Path $root 'install_shortcut.ps1')

Write-Host '=== Starting Kyrie ==='
& (Join-Path $root 'launch.ps1')

Write-Host @'

Kyrie should be open at http://localhost:5173
Next: copy your RVC .pth files into rvc_models\ if you want RVC.
Stop anytime with the Kill Kyrie shortcut (Ctrl+Alt+K).
'@
