# Kyrie kill switch. Stops every Kyrie backend and the Vite UI.
# Usage: .\stop.ps1          -> stop Kyrie only
#        .\stop.ps1 -Ollama  -> also stop Ollama
# Never touches port 8000 (Splunk).
param([switch]$Ollama)

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$ports = @(5173, 8001, 8002, 8003, 8004)
$stopped = @()
$failed = @()

foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $targetPid = $c.OwningProcess
    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    try {
      Stop-Process -Id $targetPid -Force -ErrorAction Stop
      $stopped += ("{0}:{1}({2})" -f $port, $proc.ProcessName, $targetPid)
    } catch {
      $failed += ("{0}:{1}" -f $port, $targetPid)
    }
  }
}

if ($Ollama) {
  foreach ($proc in (Get-Process -Name ollama -ErrorAction SilentlyContinue)) {
    try {
      Stop-Process -Id $proc.Id -Force -ErrorAction Stop
      $stopped += ("ollama({0})" -f $proc.Id)
    } catch {
      $failed += ("ollama:{0}" -f $proc.Id)
    }
  }
}

$when = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$line = "{0} | stopped: {1} | failed: {2}" -f $when, ($stopped -join ', '), ($failed -join ', ')
Add-Content -Path (Join-Path $logs 'stop.log') -Value $line
Write-Host $line
