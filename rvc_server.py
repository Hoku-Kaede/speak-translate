# RVC voice conversion server (port 8004).
# Uses rvc-python 0.1.5 without fairseq: ContentVec (transformers) replaces hubert_base.pt.
# Run:  python3.11 rvc_server.py
import sys, types, os, io, json, time, tempfile, threading, traceback, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import numpy as np
import torch

# ---------- fairseq stubs (rvc_python imports fairseq, but we use transformers) ----------
_fs = types.ModuleType("fairseq")
_cu = types.ModuleType("fairseq.checkpoint_utils")
def _no_fairseq(*a, **k):
    raise RuntimeError("fairseq disabled: this server uses transformers ContentVec")
_cu.load_model_ensemble_and_task = _no_fairseq
_fu = types.ModuleType("fairseq.utils")
_fu.index_put = lambda x, mask, val: x
_fs.checkpoint_utils = _cu
_fs.utils = _fu
sys.modules.update({"fairseq": _fs, "fairseq.checkpoint_utils": _cu, "fairseq.utils": _fu})

from rvc_python.configs.config import Config
from rvc_python.modules.vc.modules import VC

HOST = "127.0.0.1"
PORT = 8004
APP_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(APP_DIR, "rvc_models")
EXTRA_DIRS = [os.path.join(os.path.expanduser("~"), "Downloads", "Cypher")]
os.makedirs(MODELS_DIR, exist_ok=True)
CONTENTVEC = os.environ.get("RVC_CONTENTVEC", "lengyue233/content-vec-best")
DEVICE = os.environ.get("RVC_DEVICE") or ("cuda:0" if torch.cuda.is_available() else "cpu")
GPU_OK = DEVICE != "cpu"

LOCK = threading.Lock()
VC_CACHE = {}          # (model path, device) -> vc
HUBERT = {}            # device -> ContentVec


class ContentVec:
    """Minimal drop-in for the fairseq hubert wrapper used by rvc_python pipeline."""

    def __init__(self, model_name, device, half=False):
        from transformers import HubertModel
        self.model = HubertModel.from_pretrained(model_name)
        self.model.eval().to(device)
        if half:
            self.model.half()
        self.device = device
        self.half_mode = half

    def eval(self):
        return self

    def to(self, device):
        self.model.to(device)
        self.device = device
        return self

    def half(self):
        self.model.half()
        self.half_mode = True
        return self

    def float(self):
        self.model.float()
        self.half_mode = False
        return self

    def final_proj(self, x):
        return x

    def extract_features(self, source, padding_mask=None, output_layer=12, **kw):
        with torch.no_grad():
            # the pipeline may hand over a CUDA tensor even when this encoder sits on CPU
            if source.device.type != torch.device(self.device).type:
                source = source.to(self.device)
            if self.half_mode:
                source = source.half()
            else:
                source = source.float()
            return (self.model(source)["last_hidden_state"],)


def get_hubert(device, half=False):
    key = (device, bool(half))
    if key not in HUBERT:
        t = time.time()
        HUBERT[key] = ContentVec(CONTENTVEC, device, half)
        print("[rvc] contentvec loaded on %s (half=%s) in %.1fs" % (device, half, time.time() - t), flush=True)
    return HUBERT[key]


def list_models():
    out = []
    seen = set()
    for d in [MODELS_DIR] + EXTRA_DIRS:
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.lower().endswith(".pth"):
                p = os.path.join(d, f)
                name = f[:-4]
                if name.lower() in seen:
                    continue
                seen.add(name.lower())
                idx = ""
                for g in os.listdir(d):
                    if g.lower().endswith(".index") and f.split(".")[0].lower() in g.lower():
                        idx = os.path.join(d, g)
                        break
                out.append({"name": name, "path": p, "index": idx, "size": os.path.getsize(p)})
    return out


def resolve_model(name):
    models = list_models()
    if not models:
        raise RuntimeError("no .pth models found in %s" % MODELS_DIR)
    if not name or name == "default":
        m = models[0]
    else:
        m = None
        for mm in models:
            if mm["name"].lower() == name.lower() or mm["path"] == name:
                m = mm; break
        if m is None:
            raise RuntimeError("model not found: %s" % name)
    # drop unreadable indices so conversion still works (lower quality, no retrieval)
    idx = m.get("index")
    if idx:
        try:
            import faiss
            faiss.read_index(idx)
        except Exception as e:
            print("[rvc] index unreadable for %s (%s); using model without index" % (m["name"], str(e).splitlines()[-1][:80]), flush=True)
            m = dict(m); m["index"] = ""
    return m


def get_vc(model, device=None):
    device = device or DEVICE
    key = (model["path"], device)
    if key in VC_CACHE:
        return VC_CACHE[key]
    lib_dir = os.path.dirname(os.path.abspath(__import__("rvc_python").__file__))
    cfg = Config(lib_dir, device)
    cfg.device = device   # Config.device_config() overrides to CUDA even when device="cpu" on CUDA hosts
    half = device != "cpu"
    cfg.is_half = half
    vc = VC(lib_dir, cfg)
    vc.get_vc(model["path"], "v2")
    if getattr(vc, "pipeline", None) is not None:
        vc.pipeline.device = device
    vc.hubert_model = get_hubert(device, half)
    VC_CACHE[key] = vc
    print("[rvc] model loaded: %s (device=%s half=%s sr=%s)" % (model["name"], device, half, vc.tgt_sr), flush=True)
    return vc


def _run_convert(vc, model, path, transpose, f0method, index_rate, protect, filter_radius, rms_mix_rate):
    out = vc.vc_single(0, path, int(transpose), None, f0method, model.get("index", ""), "",
                       float(index_rate), int(filter_radius), 0, float(rms_mix_rate), float(protect))
    if not isinstance(out, np.ndarray):
        lines = [l.strip() for l in str(out).splitlines() if l.strip()]
        raise RuntimeError(lines[-1] if lines else "convert failed")
    return out


def convert(model_name, audio_bytes, transpose=0, f0method="rmvpe", index_rate=0.5,
            protect=0.33, filter_radius=3, rms_mix_rate=1.0):
    import soundfile as sf
    model = resolve_model(model_name)

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with open(path, "wb") as f:
        f.write(audio_bytes)
    audio = None
    vc = None
    global GPU_OK
    use_gpu = GPU_OK and DEVICE != "cpu"
    if use_gpu and DEVICE != "cpu" and (model["path"], DEVICE) not in VC_CACHE and torch.cuda.is_available():
        try:
            free_mb = torch.cuda.mem_get_info()[0] / (1024 * 1024)
            if free_mb < 1200:
                print("[rvc] only %.0f MB VRAM free; using CPU" % free_mb, flush=True)
                use_gpu = False
        except Exception:
            pass
    try:
        if use_gpu:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                vc = get_vc(model, DEVICE)
                audio = _run_convert(vc, model, path, transpose, f0method, index_rate, protect, filter_radius, rms_mix_rate)
            except Exception as e:
                msg = str(e)
                print("[rvc] GPU convert failed (%s); switching to CPU" % msg.splitlines()[-1][:200], flush=True)
                GPU_OK = False
                vc = None
                audio = None
                VC_CACHE.pop((model["path"], DEVICE), None)
                if torch.cuda.is_available():
                    try:
                        torch.cuda.empty_cache()
                    except Exception:
                        pass
        if audio is None:
            vc = get_vc(model, "cpu")
            audio = _run_convert(vc, model, path, transpose, f0method, index_rate, protect, filter_radius, rms_mix_rate)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    buf = io.BytesIO()
    sf.write(buf, audio, vc.tgt_sr, format="WAV", subtype="PCM_16")
    return buf.getvalue(), vc.tgt_sr


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _err(self, msg, code=500):
        data = str(msg).encode("utf-8", "replace")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(data)
        except Exception:
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self._json({"ok": True, "device": DEVICE, "models": [m["name"] for m in list_models()]})
        elif parsed.path == "/models":
            self._json([{"name": m["name"], "index": bool(m["index"]), "size": m["size"]} for m in list_models()])
        else:
            self._err("not found", 404)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return b""
        if length > 600 * 1024 * 1024:
            raise ValueError("file too large (max 600 MB)")
        return self.rfile.read(length)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/model":
            self._err("not found", 404)
            return
        q = urllib.parse.parse_qs(parsed.query)
        name = (q.get("name") or [""])[0]
        if not name:
            self._err("missing name", 400)
            return
        removed = []
        for f in os.listdir(MODELS_DIR):
            stem = f.rsplit(".", 1)[0]
            if stem.lower() == name.lower() and f.lower().endswith((".pth", ".index")):
                try:
                    os.remove(os.path.join(MODELS_DIR, f))
                    removed.append(f)
                except OSError as e:
                    self._err("delete failed: %s" % e)
                    return
        if not removed:
            self._err("model not found in rvc_models (only uploaded models can be deleted)", 404)
            return
        VC_CACHE.pop(os.path.join(MODELS_DIR, name + ".pth"), None)
        self._json({"removed": removed})
        print("[rvc] deleted:", removed, flush=True)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query)
        get = lambda k, d=None: q.get(k, [d])[0]

        if parsed.path == "/upload":
            name = (get("name", "") or "").strip()
            kind = (get("kind", "pth") or "pth").lower()
            if not name or any(ch in name for ch in '\\/:*?"<>|'):
                self._err("invalid model name", 400)
                return
            if kind not in ("pth", "index"):
                self._err("kind must be pth or index", 400)
                return
            try:
                data = self._read_body()
            except ValueError as e:
                self._err(str(e), 413)
                return
            if not data:
                self._err("empty body", 400)
                return
            os.makedirs(MODELS_DIR, exist_ok=True)
            ext = ".pth" if kind == "pth" else ".index"
            # an uploaded index always takes the model's name so pairing is automatic
            dest = os.path.join(MODELS_DIR, name + ext)
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            if kind == "pth":
                try:
                    ck = torch.load(tmp, map_location="cpu", weights_only=False)
                    if not (isinstance(ck, dict) and "weight" in ck and "config" in ck):
                        raise ValueError("not an RVC checkpoint (missing weight/config)")
                except Exception as e:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                    self._err("bad model file: %s" % str(e).splitlines()[-1][:200], 400)
                    return
            os.replace(tmp, dest)
            self._json({"ok": True, "name": name, "file": os.path.basename(dest), "size": len(data)})
            print("[rvc] uploaded: %s (%d bytes)" % (dest, len(data)), flush=True)
            return

        if parsed.path != "/convert":
            self._err("not found", 404)
            return
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        if not data:
            self._err("empty body", 400)
            return
        try:
            with LOCK:
                wav, sr = convert(
                    get("model", "default"),
                    data,
                    transpose=float(get("transpose", 0)),
                    f0method=get("f0method", "rmvpe"),
                    index_rate=float(get("index_rate", 0.5)),
                    protect=float(get("protect", 0.33)),
                )
        except Exception as e:
            traceback.print_exc()
            self._err("RVC failed: %s" % e)
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.send_header("X-Sample-Rate", str(sr))
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(wav)
        except ConnectionError:
            pass

    def log_message(self, fmt, *args):
        print("[rvc] " + fmt % args, flush=True)


if __name__ == "__main__":
    os.makedirs(MODELS_DIR, exist_ok=True)
    try:
        get_hubert(DEVICE, DEVICE != "cpu")
    except Exception as e:
        print("[rvc] preload failed: %s" % e, flush=True)
    print("RVC server on http://%s:%d (device=%s)" % (HOST, PORT, DEVICE), flush=True)
    print("models:", [m["name"] for m in list_models()], flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
