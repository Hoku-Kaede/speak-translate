# Kyrie

Kyrie is a free voice translator with a two-way **Call mode** for Discord and Google Meet.
It runs speech recognition, translation and speech synthesis locally. No paid API key is required.
Gemini or Groq keys are optional and only improve idiom handling.

## Requirements

- Windows 10 or 11
- Python 3.11, added to PATH
- Node.js 18 or newer with npm
- Git
- Internet on first install (downloads Python packages, npm packages and the Malayalam STT model)
- NVIDIA GPU is optional. Everything works on CPU, just slower.

## Install on a new PC

```powershell
git clone https://github.com/Hoku-Kaede/speak-translate.git
cd speak-translate
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

`install.ps1` does three things: runs `setup.ps1`, creates the desktop shortcuts, and starts Kyrie.
First run takes several minutes. Wait for `Kyrie should be open at http://localhost:5173`.

If you prefer to do it manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\install_shortcut.ps1
powershell -ExecutionPolicy Bypass -File .\launch.ps1
```

`setup.ps1` installs everything from `requirements-kyrie.txt`, runs `npm install`, creates
`logs\`, `models\` and `rvc_models\`, and downloads/converts the Malayalam Whisper model into
`models\ml-small-ct2`. It records the Python path it used in `.python_path`; `launch.ps1` uses
that same interpreter, so packages cannot end up installed into a different Python.

For NVIDIA GPU acceleration, install CUDA torch before setup:

```powershell
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
```

## RVC voice models

RVC models are intentionally **not** in git. Copy your own files into `rvc_models\`:

```
rvc_models\cypher.pth
rvc_models\cypher.index     (optional, must share the base name)
```

Restart the RVC backend after adding files. `http://localhost:8004/health` should list them.
Without `.pth` files, RVC is unavailable; the rest of Kyrie still works.

## Start and stop

- Start: double-click the **Kyrie** desktop shortcut, or run `launch.ps1`.
- Stop: double-click **Kill Kyrie** or press **Ctrl+Alt+K**. Also runnable as `stop.ps1`.

`launch.ps1` only starts services that are not already running and opens `http://localhost:5173`.
Closing the browser tab does not stop the backends.

## Call mode

Open **📞 call mode** in the app. Set your language, their language, microphone, `CABLE Input`
as "to call (cable)", and your headphones as "to your ears". Press start, choose the Discord or
Meet tab in the screen picker, and tick **Share tab audio**.

In Discord or Meet:
- microphone = `CABLE Output (VB-Audio Virtual Cable)`
- output = your headphones
- noise suppression / echo cancellation / auto gain = off

Other controls: translator engine, male/female voice for each direction, microphone and system
audio thresholds, silence timeout, and RVC on your outbound voice.

## Optional online translators

The **translator** dropdown accepts `auto`, `google`, `mymemory`, `qwen`, `aya`, `gemini` and `groq`.
Offline Ollama engines need Ollama running on port 11434. Gemini and Groq need a free API key;
paste it into the Call mode key field, stored only in this browser, or set `GEMINI_API_KEY` /
`GROQ_API_KEY` before launching. `auto` falls back to Google when a paid or online engine fails.

## Ports

| Port | Service |
|---|---|
| 5173 | Vite UI |
| 8001 | XTTS voice cloning |
| 8002 | Whisper STT |
| 8003 | Edge TTS and translation |
| 8004 | RVC voice conversion |
| 11434 | Ollama (optional) |

Do not stop port 8000. It belongs to Splunk.

## Logs

`logs\stt.log`, `logs\tts.log`, `logs\rvc.log`, `logs\clone.log`, `logs\web.log`, `logs\setup.log`,
`logs\stop.log`.

## Troubleshooting

- `python3.11 is not recognized` → install Python 3.11 with "Add to PATH", rerun setup.
- `ModuleNotFoundError: faster_whisper` → rerun `setup.ps1`; `launch.ps1` will use the recorded Python path.
- RVC says `no .pth models found` → copy `.pth` files into `rvc_models\` and restart.
- RVC says `unreachable` → check `logs\rvc.log`; first start downloads ContentVec and can take ~30 s.
- CUDA DLL errors → install CUDA torch, or set `$env:RVC_DEVICE='cpu'` before launching.
- Malayalam STT missing → check `models\ml-small-ct2`; rerun `python build_ml_small.py`.
- Other person cannot hear → verify cable with the button in Call mode; set Discord/Meet input to `CABLE Output`.
- You cannot hear translation → press the test button next to "to your ears"; check Windows default output.
