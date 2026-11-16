# Voice cloning backend (Coqui XTTS v2) - Python 3.11 required.
# Run:  python3.11 clone_server.py   (serves http://localhost:8001)
# First run downloads ~2GB model. Needs GPU (CUDA) for speed.
import http.server, json, os, urllib.parse, tempfile, threading
import numpy as np

HOST = "127.0.0.1"
PORT = 8001
VOICES_DIR = os.path.join(os.path.dirname(__file__), "voices")
os.makedirs(VOICES_DIR, exist_ok=True)

XTTS_LANGS = {"en","es","fr","de","it","pt","pl","tr","ru","nl","cs","ar","zh-cn","ja","hu","ko","hi","zh"}

_tts = None
_load_lock = threading.Lock()

def get_tts():
    global _tts
    with _load_lock:
        if _tts is None:
            from TTS.api import TTS
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    return _tts

class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        p = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qs(p.query)
        if p.path == "/health":
            self.send_response(200); self.send_header("Content-Type","application/json"); self._cors(); self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        if p.path == "/voices":
            vs = [f for f in os.listdir(VOICES_DIR) if f.lower().endswith((".wav",".mp3",".m4a",".ogg",".webm"))]
            data = json.dumps(vs).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(data))); self._cors(); self.end_headers()
            self.wfile.write(data)
            return
        if p.path == "/tts-clone":
            text = (qs.get("text") or [""])[0]
            voice = (qs.get("voice") or [""])[0]
            lang = (qs.get("lang") or ["en"])[0].lower()
            if not text.strip() or not voice:
                self.send_response(400); self.end_headers(); return
            if lang not in XTTS_LANGS:
                msg = ("language not supported by XTTS: " + lang).encode()
                self.send_response(400); self.send_header("Content-Type","text/plain"); self._cors(); self.end_headers(); self.wfile.write(msg); return
            sample = os.path.join(VOICES_DIR, voice)
            if not os.path.exists(sample):
                self.send_response(404); self.end_headers(); return
            try:
                tts = get_tts()
                fd, out = tempfile.mkstemp(suffix=".wav")
                os.close(fd)
                tts.tts_to_file(text=text, file_path=out, speaker_wav=sample, language=lang)
                with open(out, "rb") as f:
                    audio = f.read()
                os.remove(out)
            except Exception as e:
                msg = str(e).encode()
                self.send_response(500); self.send_header("Content-Type","text/plain"); self._cors(); self.end_headers(); self.wfile.write(msg); return
            self.send_response(200); self.send_header("Content-Type","audio/wav"); self.send_header("Content-Length", str(len(audio))); self._cors(); self.end_headers()
            self.wfile.write(audio)
            return
        self.send_response(404); self._cors(); self.end_headers()

    def do_POST(self):
        p = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qs(p.query)
        if p.path == "/upload-voice":
            name = (qs.get("name") or ["sample.wav"])[0]
            # sanitize
            name = os.path.basename(name)
            if not name.lower().endswith((".wav",".mp3",".m4a",".ogg",".webm")):
                name += ".wav"
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length)
            out = os.path.join(VOICES_DIR, name)
            with open(out, "wb") as f:
                f.write(data)
            self.send_response(200); self.send_header("Content-Type","application/json"); self._cors(); self.end_headers()
            self.wfile.write(json.dumps({"saved": name}).encode())
            return
        self.send_response(404); self._cors(); self.end_headers()

    def log_message(self, *a):
        pass

if __name__ == "__main__":
    print(f"Clone server on http://{HOST}:{PORT}")
    http.server.ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
