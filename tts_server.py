# Free TTS + translation backend.
# Run:  python tts_server.py   (port 8000)
# STT/TTS frontend uses browser; this server provides:
#   - /tts        Edge neural TTS (human-like voices)
#   - /translate  Google -> Aya -> Qwen, with engine param
#   - /voices     list Edge voices for a language
import asyncio
import json
import os
import urllib.parse
import urllib.request

HOST = "127.0.0.1"
PORT = 8003
_VOICES = None

LANG_NAMES = {
 "en":"English","hi":"Hindi","ml":"Malayalam","ta":"Tamil","te":"Telugu","kn":"Kannada",
 "mr":"Marathi","gu":"Gujarati","bn":"Bengali","pa":"Punjabi","ur":"Urdu","ne":"Nepali",
 "si":"Sinhala","es":"Spanish","fr":"French","de":"German","pt":"Portuguese","it":"Italian",
 "nl":"Dutch","ru":"Russian","uk":"Ukrainian","pl":"Polish","sv":"Swedish","no":"Norwegian",
 "da":"Danish","fi":"Finnish","cs":"Czech","sk":"Slovak","sl":"Slovenian","hr":"Croatian",
 "sr":"Serbian","bg":"Bulgarian","ro":"Romanian","el":"Greek","tr":"Turkish","ar":"Arabic",
 "he":"Hebrew","fa":"Persian","zh":"Chinese","zh-CN":"Chinese (Simplified)","zh-TW":"Chinese (Traditional)",
 "ja":"Japanese","ko":"Korean","vi":"Vietnamese","th":"Thai","id":"Indonesian","ms":"Malay",
 "tl":"Filipino","my":"Burmese","km":"Khmer","lo":"Lao","am":"Amharic","sw":"Swahili",
 "yo":"Yoruba","ig":"Igbo","ha":"Hausa","zu":"Zulu","af":"Afrikaans"
}

import edge_tts


def load_voices():
    global _VOICES
    if _VOICES is None:
        _VOICES = asyncio.run(edge_tts.list_voices())
    return _VOICES


TTS_LANG_ALIAS = {"tl": "fil", "zh": "zh-cn", "zh-cn": "zh-cn", "zh-tw": "zh-tw", "yue": "zh-hk", "iw": "he", "fil": "fil"}


def voices_for(lang):
    lang = (TTS_LANG_ALIAS.get((lang or "").lower().split("-")[0], lang) or lang).lower()
    out = []
    for v in load_voices():
        loc = (v.get("Locale") or "").lower()
        if loc == lang.lower() or loc.startswith(lang.lower() + "-") or loc.startswith(lang.lower().split("-")[0] + "-"):
            if "neural" in (v.get("ShortName") or "").lower() or "neural" in (v.get("FriendlyName") or "").lower():
                out.append(v)
    if not out:
        primary = lang.split("-")[0].lower()
        for v in load_voices():
            if (v.get("Locale") or "").lower().startswith(primary + "-"):
                out.append(v)
    return out


def voice_lang(voice):
    return (voice or "").split("-")[0].lower()


# script -> language for automatic voice matching
SCRIPT_RANGES = [
    (0x0D00, 0x0D7F, "ml"), (0x0900, 0x097F, "hi"), (0x0980, 0x09FF, "bn"),
    (0x0A00, 0x0A7F, "pa"), (0x0A80, 0x0AFF, "gu"), (0x0B80, 0x0BFF, "ta"),
    (0x0C00, 0x0C7F, "te"), (0x0C80, 0x0CFF, "kn"), (0x0E00, 0x0E7F, "th"),
    (0x1000, 0x109F, "my"), (0x1780, 0x17FF, "km"), (0x0E80, 0x0EFF, "lo"),
    (0x1200, 0x137F, "am"), (0x10A0, 0x10FF, "ka"), (0x0530, 0x058F, "hy"),
    (0x0590, 0x05FF, "he"), (0x0600, 0x06FF, "ar"), (0x0700, 0x074F, "syr"),
    (0x0750, 0x077F, "ar"), (0x07C0, 0x07FF, "so"), (0x0900, 0x097F, "mr"),
    (0x3040, 0x30FF, "ja"), (0x4E00, 0x9FFF, "zh"), (0xAC00, 0xD7AF, "ko"),
    (0x0400, 0x04FF, "ru"), (0x0370, 0x03FF, "el"), (0x12000, 0x123FF, "cuneiform"),
]


def detect_text_lang(text):
    counts = {}
    for ch in text:
        cp = ord(ch)
        for lo, hi, lang in SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[lang] = counts.get(lang, 0) + 1
                break
    if not counts:
        return None
    return max(counts, key=counts.get)


def pick_voice_for(lang, gender=None, exclude=None):
    vs = [v for v in voices_for(lang) if v.get("ShortName") != exclude]
    if not vs:
        return None
    if gender:
        same = [v for v in vs if (v.get("Gender") or "").lower() == gender.lower()]
        if same:
            return same[0]
    return vs[0]


async def synth(text, voice):
    comm = edge_tts.Communicate(text, voice)
    audio = bytearray()
    async for chunk in comm.stream():
        if chunk.get("type") == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)



def translate_mymemory(text, src, tgt):
    url = "https://api.mymemory.translated.net/get?q=%s&langpair=%s" % (urllib.parse.quote(text), urllib.parse.quote(src + "|" + tgt))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    if data.get("responseStatus") != 200:
        raise RuntimeError(data.get("responseDetails") or "mymemory fail")
    t = (data.get("responseData") or {}).get("translatedText")
    if not t or "MYMEMORY WARNING" in t.upper():
        raise RuntimeError("mymemory limit")
    return t.strip()


def translate_google(text, src, tgt):
    """Free Chrome-extension endpoint; returns idiomatic, non-literal output."""
    q = urllib.parse.quote(text)
    url = ("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=%s&tl=%s&q=%s"
           % (urllib.parse.quote(src), urllib.parse.quote(tgt), q))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    if isinstance(data, list):
        if data and isinstance(data[0], str):
            out = " ".join(data)
        else:
            parts = []
            for seg in data:
                if isinstance(seg, list) and seg:
                    if isinstance(seg[0], str) and seg[0].strip():
                        parts.append(seg[0])
                    elif len(seg) > 1 and isinstance(seg[1], str):
                        parts.append(seg[1])
                elif isinstance(seg, str):
                    parts.append(seg)
            out = " ".join(parts)
    elif isinstance(data, dict):
        out = data.get("sentences") and " ".join(s.get("trans", "") for s in data["sentences"]) or ""
    else:
        out = ""
    out = (out or "").strip()
    if not out:
        raise RuntimeError("google empty")
    return out


GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# llama-3.3-70b-versatile was removed from Groq's free tier in Aug 2026.
# gpt-oss-120b is still free: 30 req/min, 1000/day, 200k tokens/day.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent"
# 2.5 models are being retired in late 2026. Flash-Lite is free and is the
# translation-optimized, highest-quota free model (typically 15 RPM / 500 RPD).
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")


def translate_groq(text, src, tgt, key):
    s = LANG_NAMES.get(src, src)
    t = LANG_NAMES.get(tgt, tgt)
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a professional interpreter. Translate meaning and intent, "
                                          "not words. Use idioms a native speaker would use. "
                                          "Output only the translation, no notes, no romanization, no original text."},
            {"role": "user", "content": "Translate this %s text to %s:\n\n%s" % (s, t, text)},
        ],
        "temperature": 0.3,
        "max_tokens": 512,
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(GROQ_URL, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "User-Agent": "Mozilla/5.0",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        res = json.loads(r.read().decode())
    out = ((res.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    out = out.strip().strip('"').strip()
    if not out:
        raise RuntimeError("groq empty")
    return out


def translate_gemini(text, src, tgt, key):
    """Google Gemini free tier. Key via GEMINI_API_KEY or the gemini_key query param."""
    s = LANG_NAMES.get(src, src)
    t = LANG_NAMES.get(tgt, tgt)
    body = {
        "system_instruction": {"parts": [{"text":
            "You are a professional interpreter. Translate meaning and intent, not words. "
            "Use idioms a native speaker would use. Output only the translation: no notes, "
            "no romanization, no source text, no quotes around the answer."}]},
        "contents": [{"role": "user", "parts": [{"text":
            "Translate this %s text to %s:\n\n%s" % (s, t, text)}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
    }
    req = urllib.request.Request(GEMINI_URL % GEMINI_MODEL, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json",
        "x-goog-api-key": key,
        "User-Agent": "Mozilla/5.0",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        res = json.loads(r.read().decode())
    out = ""
    for cand in res.get("candidates") or []:
        for part in ((cand.get("content") or {}).get("parts") or []):
            out += part.get("text") or ""
    out = out.strip().strip('"').strip()
    if not out:
        raise RuntimeError("gemini empty")
    return out


def translate_ollama_model(text, src, tgt, model):
    s = LANG_NAMES.get(src, src)
    t = LANG_NAMES.get(tgt, tgt)
    prompt = ("Translate the %s text below into %s. Use natural, idiomatic %s as a native speaker would say it. "
              "Do not translate word by word. Do not add explanations, notes, transliterations or the original text. "
              "Output only the %s translation.\n\nText: %s\nTranslation:"
              % (s, t, t, t, text))
    body = {"model": model, "prompt": prompt, "stream": False, "think": False,
            "options": {"temperature": 0.2, "num_predict": 256}}
    data = json.dumps(body).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=data,
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.loads(r.read().decode())
    out = (res.get("response") or "").strip()
    if not out:
        raise RuntimeError("empty")
    return out


LANG_SCRIPT = {}
for _lo, _hi, _lang in SCRIPT_RANGES:
    LANG_SCRIPT.setdefault(_lang, (_lo, _hi))


def valid_translation(out, src_text, tgt):
    """Reject echoes and outputs in the wrong script (classic MyMemory failures)."""
    o = (out or "").strip()
    if not o:
        return False
    if o.lower().strip(" .!?،。") == src_text.lower().strip(" .!?،。"):
        return False
    rng = LANG_SCRIPT.get(tgt.split("-")[0].lower())
    if rng:
        letters = [c for c in o if c.isalpha()]
        if not letters:
            return False
        inside = sum(1 for c in letters if rng[0] <= ord(c) <= rng[1])
        if inside / len(letters) < 0.5:
            return False
    return True


from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        if parsed.path == "/voices":
            lang = (qs.get("lang") or ["en"])[0]
            vs = voices_for(lang)
            payload = [{"short": v["ShortName"], "locale": v["Locale"],
                        "gender": v.get("Gender"), "name": v.get("FriendlyName")} for v in vs]
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/tts":
            text = (qs.get("text") or [""])[0]
            voice = (qs.get("voice") or [""])[0]
            lang = (qs.get("lang") or [""])[0]
            if not text.strip():
                self.send_response(400); self.end_headers(); return
            # text script wins over a stale / mismatched voice (edge-tts returns no audio otherwise)
            det = detect_text_lang(text)
            if det:
                cur = voice_lang(voice)
                if not voice or cur != det:
                    gender = None
                    for v in load_voices():
                        if v.get("ShortName") == voice:
                            gender = v.get("Gender")
                            break
                    nv = pick_voice_for(det, gender)
                    if nv:
                        voice = nv["ShortName"]
            if not voice:
                vs = voices_for(lang or det or "en")
                if not vs:
                    self.send_response(404); self.end_headers(); return
                voice = vs[0]["ShortName"]
            try:
                audio = asyncio.run(synth(text, voice))
            except Exception as e:
                audio = b""
                # one retry with another voice of the same language
                retry = pick_voice_for(voice_lang(voice), exclude=voice) or pick_voice_for(lang or "en", exclude=voice)
                if retry:
                    try:
                        voice = retry["ShortName"]
                        audio = asyncio.run(synth(text, voice))
                    except Exception as e2:
                        e = e2
                else:
                    audio = b""
                if not audio:
                    msg = ("TTS failed for voice %s: %s" % (voice, e)).encode()
                    self.send_response(500)
                    self.send_header("Content-Type", "text/plain")
                    self._cors()
                    self.end_headers()
                    self.wfile.write(msg)
                    return
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("X-Voice", voice)
            self._cors()
            self.end_headers()
            self.wfile.write(audio)
            return
        if parsed.path == "/translate":
            text = (qs.get("text") or [""])[0]
            src = (qs.get("from") or ["en"])[0]
            tgt = (qs.get("to") or ["en"])[0]
            engine = (qs.get("engine") or ["auto"])[0]
            if not text.strip():
                self.send_response(400); self.end_headers(); return
            used_engine = "echo"
            if src == tgt:
                out = text
            else:
                key = (qs.get("key") or [os.environ.get("GROQ_API_KEY", "")])[0]
                gkey = (qs.get("gemini_key") or [os.environ.get("GEMINI_API_KEY", "")])[0]
                order = ["google", "mymemory", "qwen", "aya"]
                if gkey:
                    order.insert(0, "gemini")
                if key:
                    order.insert(0, "groq")
                if engine == "groq":
                    order = ["groq"]
                elif engine == "gemini":
                    order = ["gemini"]
                elif engine != "auto":
                    order = [engine]
                out = None
                last = None
                last_eng = None
                failures = []
                for eng in order:
                    if src == "auto" and eng != "google":
                        continue  # only Google accepts an unknown source language
                    try:
                        if eng == "groq":
                            if not key:
                                raise RuntimeError("no key")
                            cand = translate_groq(text, src, tgt, key)
                        elif eng == "gemini":
                            if not gkey:
                                raise RuntimeError("no key")
                            cand = translate_gemini(text, src, tgt, gkey)
                        elif eng == "google":
                            cand = translate_google(text, src, tgt)
                        elif eng == "mymemory":
                            cand = translate_mymemory(text, src, tgt)
                        elif eng == "qwen":
                            cand = translate_ollama_model(text, src, tgt, "qwen3.5:2b")
                        elif eng == "aya":
                            cand = translate_ollama_model(text, src, tgt, "aya:8b")
                        else:
                            continue
                    except Exception as e:
                        reason = str(e).splitlines()[-1][:90] if str(e) else type(e).__name__
                        failures.append("%s: %s" % (eng, reason))
                        continue
                    cand = (cand or "").strip().strip('"').strip()
                    if not cand:
                        failures.append("%s: empty" % eng)
                        continue
                    last = cand
                    last_eng = eng
                    if valid_translation(cand, text, tgt):
                        out = cand
                        used_engine = eng
                        break
                if out is None:
                    out = last
                    used_engine = last_eng
                if out is None:
                    detail = "; ".join(failures)[:400]
                    print(("[translate] FAILED %s->%s %s" % (src, tgt, detail)).encode("ascii", "replace").decode(), flush=True)
                    msg = json.dumps({"error": "translation failed", "tried": failures}, ensure_ascii=False).encode()
                    self.send_response(502)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(msg)))
                    self._cors()
                    self.end_headers()
                    self.wfile.write(msg)
                    return
            print(("[translate] %s->%s via %s: %s" % (src, tgt, used_engine, out[:80])).encode("ascii", "replace").decode(), flush=True)
            data = json.dumps({"translated": out, "engine": used_engine}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Edge TTS server on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
