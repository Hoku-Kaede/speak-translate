# Start every backend for the voice translator. Each runs in its own window.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$dir'; python -m http.server 5173"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$dir'; python tts_server.py"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$dir'; python3.11 stt_server.py"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$dir'; python3.11 rvc_server.py"
Start-Process powershell -ArgumentList "-NoExit","-Command","`$env:COQUI_TOS_AGREED='1'; cd '$dir'; python3.11 clone_server.py"

Write-Host "Web:      http://localhost:5173"
Write-Host "TTS/XLAT: 8003"
Write-Host "Whisper:  8002"
Write-Host "RVC:      8004"
Write-Host "Clone:    8001"
Write-Host "First RVC/XTTS request loads models and is slow."
