# Run once after git clone. Installs Python packages, npm deps, and builds the
# local Malayalam Whisper model that is intentionally not committed to git.
param([switch]$SkipModel)

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $root

foreach ($dir in @('logs', 'models', 'rvc_models', 'voices')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $dir) | Out-Null
}
Start-Transcript -Path (Join-Path $root 'logs\setup.log') -Force | Out-Null

try {
  function Find-Python([string[]]$names) {
    foreach ($n in $names) {
      $cmd = Get-Command $n -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    }
    return $null
  }

  $PIP_FLAGS = @('--timeout', '120', '--retries', '10')

  function Install-Requirements([string]$file) {
    Write-Host "pip install -r $file"
    $out = & $PY -m pip install @PIP_FLAGS -r $file 2>&1
    if ($LASTEXITCODE -ne 0) {
      $out | Select-Object -Last 8 | ForEach-Object { Write-Host "  $_" }
      Write-Host '  retrying with --break-system-packages'
      $out = & $PY -m pip install @PIP_FLAGS --break-system-packages -r $file 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
      $out | Select-Object -Last 15 | ForEach-Object { Write-Host "  $_" }
      throw "pip install failed for $file"
    }
  }

  $PY = Find-Python @('python3.11', 'python3', 'python')
  if (-not $PY) { throw 'Python not found. Install Python 3.11 with Add to PATH, then rerun setup.ps1.' }
  Write-Host "Using Python: $PY"
  Set-Content -Path (Join-Path $root '.python_path') -Value $PY
  $ver = & $PY -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>&1
  Write-Host "Python version: $ver"
  if ($ver -ne '3.11') { Write-Host 'Python 3.11 is recommended; XTTS cloning may need it.' }

  Write-Host 'Upgrading pip / setuptools / wheel...'
  & $PY -m pip install @PIP_FLAGS --upgrade pip setuptools wheel 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Host "  $_" }

  # All Python dependencies live in one reviewed file. For NVIDIA GPU, install
  # CUDA torch first:
  #   python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
  Install-Requirements (Join-Path $root 'requirements-kyrie.txt')

  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host 'npm install (react-app)'
    npm install --prefix (Join-Path $root 'react-app')
  } else {
    Write-Host 'npm not found. Install Node 18+ for the UI.'
  }

  if (-not $SkipModel) {
    Write-Host 'Building Malayalam STT model (downloads ~300 MB, then converts to ct2)...'
    & $PY (Join-Path $root 'build_ml_small.py')
    if ($LASTEXITCODE -ne 0) { throw 'Malayalam STT model build failed. Check internet access and rerun: python build_ml_small.py' }
  }

  Write-Host @'

Setup done.
Next:
  1. Copy your RVC .pth (and .index) files into rvc_models\ to use RVC.
  2. Run .\launch.ps1, or double-click the Kyrie desktop shortcut.
  3. If a backend fails, check logs\stt.log and logs\rvc.log.
'@
} catch {
  Write-Host "SETUP FAILED: $($_.Exception.Message)"
  throw
} finally {
  Stop-Transcript | Out-Null
}
