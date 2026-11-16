from huggingface_hub import snapshot_download
from transformers import WhisperTokenizerFast
p = snapshot_download("thennal/whisper-medium-ml", local_dir="models/ml-src", ignore_patterns=["runs/*","*.bin.index.json","training_args.bin"])
print("snapshot", p)
tok = WhisperTokenizerFast.from_pretrained(p)
tok.save_pretrained(p)
import os
print("tokenizer.json", os.path.exists(os.path.join(p,"tokenizer.json")))
