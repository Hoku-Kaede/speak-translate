# Kyrie launcher — starts every backend that is not already running, then opens the app.
$root = 'D:\work\voice-translate'
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

if (-not (Test-Port 8003)) {
  Start-Hidden 'kyrie-tts' "Set-Location '$root'; python tts_server.py" (Join-Path $logs 'tts.log')
}
if (-not (Test-Port 8002)) {
  Start-Hidden 'kyrie-stt' "Set-Location '$root'; python3.11 stt_server.py" (Join-Path $logs 'stt.log')
}
if (-not (Test-Port 8004)) {
  Start-Hidden 'kyrie-rvc' "Set-Location '$root'; python3.11 rvc_server.py" (Join-Path $logs 'rvc.log')
}
if (-not (Test-Port 8001)) {
  Start-Hidden 'kyrie-clone' "`$env:COQUI_TOS_AGREED='1'; Set-Location '$root'; python3.11 clone_server.py" (Join-Path $logs 'clone.log')
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
