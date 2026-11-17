"""Build a faster Malayalam Whisper: small variant converted to ct2 int8.

The medium model (models/ml-ct2) is correct but ~6.5s per clip on CPU, which is
slow for call mode. This fetches thennal/whisper-small-ml, converts it, and
times it against the same sample so the choice is measured, not guessed.
"""
import os, time, shutil

MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
SRC = os.path.join(MODELS, "ml-small-src")
DST = os.path.join(MODELS, "ml-small-ct2")
WAV = os.path.join(os.environ["TEMP"], "ml16.wav")
OUT = os.path.join(os.environ["TEMP"], "ml_small_result.txt")


def log(msg):
    print(msg, flush=True)


if not os.path.isdir(SRC):
    from huggingface_hub import snapshot_download
    log("downloading thennal/whisper-small-ml")
    snapshot_download("thennal/whisper-small-ml", local_dir=SRC,
                      allow_patterns=["*.json", "*.txt", "*.bin", "*.model"])
else:
    log("source already present")

if not os.path.isdir(DST):
    from ctranslate2.converters import TransformersConverter
    log("converting to ct2 int8")
    TransformersConverter(SRC).convert(str(DST), quantization="int8", force=True)
    # ct2 4.9 no longer copies the tokenizer extras, and faster-whisper needs them.
    for f in ("tokenizer.json", "preprocessor_config.json", "vocabulary.json",
              "vocab.json", "merges.txt", "added_tokens.json", "normalizer.json",
              "special_tokens_map.json", "tokenizer_config.json"):
        src = os.path.join(SRC, f)
        if os.path.exists(src) and not os.path.exists(os.path.join(DST, f)):
            shutil.copy2(src, os.path.join(DST, f))
else:
    log("converted model already present")

from faster_whisper import WhisperModel
for path, tag in ((DST, "ml-small"), (os.path.join(MODELS, "ml-ct2"), "ml-medium")):
    try:
        m = WhisperModel(path, device="cpu", compute_type="int8")
        t = time.time()
        segs, info = m.transcribe(WAV, beam_size=1, language="ml")
        segs = list(segs)
        text = " ".join(s.text for s in segs).strip()
        with open(OUT, "a", encoding="utf-8") as f:
            f.write("%s took=%.2f\n%s\n\n" % (tag, time.time() - t, text))
        log("%s ok %.2fs" % (tag, time.time() - t))
        del m
    except Exception as e:
        log("%s FAIL %s" % (tag, str(e).splitlines()[-1][:160]))

log("ALLDONE")
