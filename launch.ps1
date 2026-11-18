# Kyrie launcher — starts every backend that is not already running, then opens the app.
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Hidden([string]$title, [string]$command, [string]$log) {
  $inner = "`$host.UI.RawUI.WindowTitle='$title'; $command *>> '$log'"
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $inner
  ) | Out-Null
}

function Find-Python([string[]]$names) {
  foreach ($n in $names) {
    $cmd = Get-Command $n -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

# Fresh clones do not necessarily have a python3.11 alias, or Python on PATH at all.
$PY311 = Find-Python @('python3.11', 'python3', 'python')
$PY = Find-Python @('python', 'python3', 'python3.11')
# setup.ps1 records the exact interpreter it installed into. Use it, so launch
# cannot pick a different Python from PATH and miss faster-whisper.
$savedPy = Join-Path $root '.python_path'
if ((Test-Path $savedPy) -and (Test-Path (Get-Content $savedPy -Raw).Trim())) {
  $saved = (Get-Content $savedPy -Raw).Trim()
  $PY = $saved
  $PY311 = $saved
}
if (-not $PY311 -or -not $PY) {
  Write-Host 'Python not found on PATH. Install Python 3.11, then run launch.ps1 again.'
  exit 1
}

if (-not (Test-Port 8003)) {
  Start-Hidden 'kyrie-tts' "Set-Location '$root'; & '$PY' tts_server.py" (Join-Path $logs 'tts.log')
}
if (-not (Test-Port 8002)) {
  Start-Hidden 'kyrie-stt' "Set-Location '$root'; & '$PY311' stt_server.py" (Join-Path $logs 'stt.log')
}
if (-not (Test-Port 8004)) {
  Start-Hidden 'kyrie-rvc' "Set-Location '$root'; & '$PY311' rvc_server.py" (Join-Path $logs 'rvc.log')
}
if (-not (Test-Port 8001)) {
  Start-Hidden 'kyrie-clone' "`$env:COQUI_TOS_AGREED='1'; Set-Location '$root'; & '$PY311' clone_server.py" (Join-Path $logs 'clone.log')
}
if (-not (Test-Port 5173)) {
  Start-Hidden 'kyrie-web' "Set-Location '$root\react-app'; npm run dev" (Join-Path $logs 'web.log')
}

# Give the UI server time to bind, then open it in the default browser.
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Port 5173) { break }
  Start-Sleep -Seconds 1
}
Start-Process 'http://localhost:5173'
