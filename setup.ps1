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

  function Install-Pip([string[]]$packages, [switch]$Required) {
    foreach ($pkg in $packages) {
      Write-Host "pip install $pkg"
      $out = & $PY -m pip install @PIP_FLAGS $pkg 2>&1
      if ($LASTEXITCODE -ne 0) {
        $out | Select-Object -Last 6 | ForEach-Object { Write-Host "  $_" }
        Write-Host "  retrying with --break-system-packages: $pkg"
        $out = & $PY -m pip install @PIP_FLAGS --break-system-packages $pkg 2>&1
      }
      if ($LASTEXITCODE -ne 0) {
        $out | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" }
        Write-Host "  FAILED: $pkg"
        if ($Required) { throw "Required package failed: $pkg" }
      }
    }
  }

  $PY = Find-Python @('python3.11', 'python3', 'python')
  if (-not $PY) { throw 'Python not found. Install Python 3.11 with Add to PATH, then rerun setup.ps1.' }
  Write-Host "Using Python: $PY"
  $ver = & $PY -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>&1
  Write-Host "Python version: $ver"
  if ($ver -ne '3.11') { Write-Host 'Python 3.11 is recommended; XTTS cloning may need it.' }

  Write-Host 'Upgrading pip / setuptools / wheel...'
  & $PY -m pip install @PIP_FLAGS --upgrade pip setuptools wheel 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Host "  $_" }

  # Core backends. For NVIDIA GPU, install CUDA torch instead:
  #   python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
  Install-Pip -Required @('faster-whisper', 'edge-tts', 'transformers', 'huggingface_hub',
                          'soundfile', 'numpy', 'torch', 'torchaudio')
  # RVC extras are optional: RVC fails only if these are missing when it is used.
  Install-Pip @('faiss-cpu', 'av', 'praat-parselmouth', 'pyworld', 'torchcrepe')
  Install-Pip @('rvc-python')

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
