# Kyrie

Voice translator with a two-way Call mode for Discord / Google Meet.

## Fresh clone setup (Windows)

The repo intentionally excludes models, RVC `.pth` files, logs and `node_modules`.
A fresh `git clone` will not have a working Malayalam STT model or any RVC voice.
Run once from the cloned folder:

```powershell
cd <your-clone-folder>
.\setup.ps1
```

That installs Python/npm packages and downloads + converts the Malayalam Whisper
model into `models\ml-small-ct2`. It needs internet on first run. For RVC, copy
your `.pth` (and matching `.index`) into `rvc_models\`. Then:

```powershell
.\launch.ps1
```

`launch.ps1`, `install_shortcut.ps1` and `stop.ps1` now derive their paths from
their own folder, so the cloned folder can live anywhere. `launch.ps1` also
detects whichever Python is on PATH; it no longer requires a `python3.11` alias.

Common clone errors:
- `python3.11 is not recognized` → fixed by `setup.ps1` / updated `launch.ps1`.
- `no .pth models found in rvc_models` → copy your RVC model into `rvc_models\`.
- STT model download fails → check internet, or rerun `python build_ml_small.py`.
- CUDA DLL errors (`cublas64_12.dll`, `cudnn_ops64_9.dll`) → install CUDA torch
  from `https://download.pytorch.org/whl/cu124`, or run backends on CPU.

## Run (needed for mic permission)

Chrome/Edge block mic on `file://`. Serve over localhost:

```powershell
cd D:\work\voice-translate
python -m http.server 5173
```

Open http://localhost:5173 in Chrome or Edge.

## Use
- Pick source/target languages, tap mic, speak.
- Translation shows + auto-speaks in target language (toggle auto-speak).
- "continuous listen" keeps listening after each utterance.
- "edit before send" lets you fix STT text before translating.
- History saved in browser (localStorage).

## Phone
Mic needs HTTPS. Use a tunnel:
```powershell
npx localtunnel --port 5173
```
or ngrok. Open the https URL on your phone.

## Limits
- STT/TTS: Chrome/Edge only (Web Speech API). Safari partial.
- Translation: MyMemory free tier 5000 chars/day anonymous, then Google fallback.
- Voice quality: OS voices (robotic). For better, build path B (offline Python: faster-whisper + Piper).

## Human-like voice (optional, free)
Edge neural voices via local backend:

```powershell
cd D:\work\voice-translate
pip install edge-tts
python tts_server.py
```

Keep it running. In the app, enable "human voice (Edge)" chip and pick a voice. Falls back to OS voice if backend down. Supports Malayalam (ml-IN-MidhunNeural, ml-IN-SobhanaNeural) and 100+ languages.

## Voice cloning (optional, ElevenLabs-style)
Requires Python 3.11 (for PyTorch/Coqui). Install torch + coqui-tts:

```powershell
python3.11 -m pip install --break-system-packages torch torchaudio --index-url https://download.pytorch.org/whl/cu124
python3.11 -m pip install --break-system-packages coqui-tts
```

Run clone backend:

```powershell
cd D:\work\voice-translate
python3.11 clone_server.py
```

First run downloads ~2GB XTTS model. In app, enable "clone voice (XTTS)", upload a 6-10s clean voice sample (wav/mp3), select it. Supported langs: en es fr de it pt pl tr ru nl cs ar zh ja hu ko hi. (Malayalam not supported by XTTS; use Edge voice for ml.)

## RVC voice (your own .pth model, works with any language)
Local RVC conversion runs after Edge TTS, so Malayalam text can be spoken in a cloned RVC timbre. Requires Python 3.11.

Install once:

```powershell
python3.11 -m pip install --break-system-packages --no-deps rvc-python
python3.11 -m pip install --break-system-packages av faiss-cpu praat-parselmouth pyworld torchcrepe
```

Run:

```powershell
cd D:\work\voice-translate
python3.11 rvc_server.py
```

Model discovery: `.pth` files in `rvc_models/` (create it) or `%USERPROFILE%\Downloads\Cypher`. Index `.index` files with a matching name load automatically.

Adding models from the app: enable "RVC voice (local)" → **add model** → select the `.pth` (and its `.index` in the same selection if you have one). The file name becomes the model name, and the index is renamed to match so pairing is automatic. **delete** removes uploaded models only (files in `Downloads` are never touched).

No fairseq needed: the server uses `lengyue233/content-vec-best` (transformers) as the feature encoder and `rmvpe.pt` for pitch.

VRAM: the server loads the model on CUDA (fp16) and needs ~1 GB free. If the GPU is full (Ollama, XTTS) or a CUDA error occurs, it switches to CPU automatically (~4 s per sentence). Force CPU with `$env:RVC_DEVICE="cpu"` before starting.

In the app: enable "RVC voice (local)", pick model, set pitch offset in semitones (-12 for a female Edge voice into a male model, 0 if unsure). Base voice still comes from the Edge chip.

## Whisper STT (local, optional)

```powershell
python -m pip install faster-whisper
python stt_server.py
```

Push-to-talk: enable "Whisper STT (local)", tap mic to record. Hands-free auto-stop (VAD, ~1.1 s silence) works in this mode too.

Source language **Auto-detect (Whisper)**: Whisper identifies the spoken language and the app translates from it. The detected code shows on the mic label. Browser Web Speech API cannot auto-detect, so choosing Auto switches STT to Whisper.

Quality: `small` (default, ~1-3 s/utterance on CPU) is fine for English/European languages but weak on Malayalam — it often writes Devanagari or Latin gibberish. `large-v3-turbo` writes correct Malayalam script but needs ~12-18 s/utterance on CPU; run it on the GPU (install faster-whisper into the Python 3.11 env that has CUDA torch) for ~1-2 s. Switch with `$env:WHISPER_MODEL="large-v3-turbo"`. Auto-detect confuses Malayalam with Tamil at times; pick the source language explicitly when that happens.