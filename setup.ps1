# Run once after git clone. Installs Python packages, npm deps, and builds the
# local Malayalam Whisper model that is intentionally not committed to git.
param([switch]$SkipModel)

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $root

function Find-Python([string[]]$names) {
  foreach ($n in $names) {
    $cmd = Get-Command $n -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

$PY = Find-Python @('python3.11', 'python3', 'python')
if (-not $PY) {
  Write-Host 'Python not found. Install Python 3.11 (add to PATH), then rerun setup.ps1.'
  exit 1
}
Write-Host "Using Python: $PY"

foreach ($dir in @('logs', 'models', 'rvc_models', 'voices')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $dir) | Out-Null
}

function Install-Pip([string[]]$packages) {
  foreach ($pkg in $packages) {
    Write-Host "pip install $pkg"
    & $PY -m pip install $pkg 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  retrying with --break-system-packages: $pkg"
      & $PY -m pip install --break-system-packages $pkg 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED: $pkg" }
  }
}

# Core backends. For NVIDIA GPU, install CUDA torch instead:
#   python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
Install-Pip @('faster-whisper', 'edge-tts', 'transformers', 'huggingface_hub',
              'soundfile', 'numpy', 'torch', 'torchaudio')
# RVC: rvc-python ships with stale pinned deps, so install its extras by hand.
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
}

Write-Host @'

Setup done.
Next:
  1. Copy your RVC .pth (and .index) files into rvc_models\ to use RVC.
  2. Run .\launch.ps1, or double-click the Kyrie desktop shortcut.
  3. If a backend fails, check logs\stt.log and logs\rvc.log.
'@
