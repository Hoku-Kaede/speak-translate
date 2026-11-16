# Whisper STT backend (faster-whisper). Port 8002.
# Run:  python stt_server.py      (CPU, any Python with faster-whisper)
#       python3.11 stt_server.py  (GPU, when that env has CUDA torch)
# Install: pip install faster-whisper
import os, tempfile, time, json, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HOST = "127.0.0.1"
PORT = 8002
SMALL = os.environ.get("WHISPER_MODEL", "small")
BIG = os.environ.get("WHISPER_MODEL_BIG", "large-v3-turbo")
APP_DIR = os.path.dirname(os.path.abspath(__file__))
ML_DIR = os.path.join(APP_DIR, "models", "ml-ct2")
ML = os.environ.get("WHISPER_ML_MODEL", ML_DIR if os.path.isdir(ML_DIR) else "thennal/whisper-medium-ml")
# short/low-resource scripts: the small model writes the wrong script, so use the big one
INDIC = {"ml", "ta", "te", "kn", "bn", "gu", "pa", "mr", "hi", "ur", "ne", "si", "or", "as"}
MODELS = {}
DEVICE = None


def _device():
    """Pick CUDA when possible. Windows needs torch's bundled CUDA DLLs for ctranslate2."""
    global DEVICE
    if DEVICE:
        return DEVICE
    try:
        import torch
        if hasattr(os, "add_dll_directory"):
            lib = os.path.join(os.path.dirname(torch.__file__), "lib")
            if os.path.isdir(lib):
                try:
                    os.add_dll_directory(lib)
                except OSError:
                    pass
        if torch.cuda.is_available():
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                DEVICE = "cuda"
                return DEVICE
    except Exception:
        pass
    DEVICE = "cpu"
    return DEVICE


def get_model(name):
    if name in MODELS:
        return MODELS[name]
    from faster_whisper import WhisperModel
    t = time.time()
    dev = _device()
    # Ollama holds ~2.2 GB; drop it before loading a big model so Whisper actually uses the GPU
    if dev == "cuda" and name in (BIG, ML):
        for om in ("qwen3.5:2b", "aya:8b"):
            try:
                req = urllib.request.Request(
                    "http://127.0.0.1:11434/api/generate",
                    data=json.dumps({"model": om, "keep_alive": 0}).encode(),
                    headers={"Content-Type": "application/json"},
                )
                urllib.request.urlopen(req, timeout=5).read()
            except Exception:
                pass
    compute = "int8" if dev == "cpu" else ("int8_float16" if name == BIG else "float16")
    try:
        m = WhisperModel(name, device=dev, compute_type=compute)
    except Exception as e:
        print("[stt] %s on %s failed (%s); loading on CPU" % (name, dev, str(e).splitlines()[-1][:160]), flush=True)
        m = WhisperModel(name, device="cpu", compute_type="int8")
        dev = "cpu"
    MODELS[name] = m
    print("[stt] %s loaded on %s in %.1fs" % (name, dev, time.time() - t), flush=True)
    return m


def _transcribe(model, path, lang=None, beam=5):
    segs, info = model.transcribe(path, beam_size=beam, language=lang)
    segs = list(segs)
    text = " ".join(s.text for s in segs).strip()
    dur = sum(max(0.0, s.end - s.start) for s in segs) or 1.0
    lp = sum(s.avg_logprob * max(0.0, s.end - s.start) for s in segs) / dur
    got = (getattr(info, "language", None) or lang or "").lower()
    return text, got, lp, float(getattr(info, "language_probability", 0.0) or 0.0)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.send_header("Content-Type", "application/json"); self._cors(); self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "device": DEVICE or "unloaded", "loaded": list(MODELS)}).encode())
            return
        self.send_response(404); self._cors(); self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/stt":
            self.send_response(404); self._cors(); self.end_headers(); return
        qs = urllib.parse.parse_qs(parsed.query)
        hint = (qs.get("lang") or [""])[0].strip().lower() or None
        free = (qs.get("free") or ["0"])[0] == "1"
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        if not data:
            self.send_response(400); self.end_headers(); return
        fd, path = tempfile.mkstemp(suffix=".webm")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(data)
        # convert to 16k mono wav via ffmpeg for compatibility
        wav_path = path + ".wav"
        os.system('ffmpeg -y -loglevel error -i "%s" -ar 16000 -ac 1 "%s"' % (path, wav_path))
        transcribe_path = wav_path if os.path.exists(wav_path) else path
        used = SMALL
        try:
            t0 = time.time()
            if hint == "ml":
                name = ML
            elif hint in INDIC:
                name = BIG
            else:
                name = SMALL
            beam = 1 if name == BIG else 5
            text, lang, score, prob = _transcribe(get_model(name), transcribe_path, hint, beam)
            used = name
            if not hint and lang == "ml" and name != ML:
                try:
                    t2, l2, s2, p2 = _transcribe(get_model(ML), transcribe_path, "ml", 5)
                    if t2:
                        text, lang, score, prob, used = t2, l2, s2, p2, ML
                except Exception as e:
                    print("[stt] ml-model retry failed: %s" % str(e).splitlines()[-1][:160], flush=True)
            elif not hint and lang in INDIC and lang != "ml" and name != BIG:
                try:
                    t2, l2, s2, p2 = _transcribe(get_model(BIG), transcribe_path, lang, 1)
                    if t2:
                        text, lang, score, prob, used = t2, l2, s2, p2, BIG
                except Exception as e:
                    print("[stt] big-model retry failed: %s" % str(e).splitlines()[-1][:160], flush=True)
            print("[stt] %s %s %.1fs" % (used, lang, time.time() - t0), flush=True)
            if free and _device() == "cuda":
                try:
                    global MODEL
                    del MODEL
                    MODEL = None
                    import torch
                    torch.cuda.empty_cache()
                    print("[stt] unloaded model to free VRAM for RVC", flush=True)
                except Exception as e:
                    print("[stt] unload failed: %s" % e, flush=True)
        except Exception as e:
            msg = str(e).encode()
            self.send_response(500); self.send_header("Content-Type", "text/plain"); self._cors(); self.end_headers()
            self.wfile.write(msg)
            for p in (path, wav_path):
                try: os.remove(p)
                except: pass
            return
        for p in (path, wav_path):
            try: os.remove(p)
            except: pass
        out = json.dumps({"text": text, "language": lang, "probability": round(prob, 3),
                          "score": round(score, 3), "model": used}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self._cors()
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"Whisper STT server on http://{HOST}:{PORT} (small={SMALL}, big={BIG})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
