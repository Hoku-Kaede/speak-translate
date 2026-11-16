import os, time, torch
os.add_dll_directory(os.path.join(os.path.dirname(torch.__file__), "lib"))
from faster_whisper import WhisperModel
t=time.time()
m=WhisperModel("models/ml-ct2", device="cuda", compute_type="int8_float16")
print("load", round(time.time()-t,1),"s", flush=True)
t=time.time()
segs,info=m.transcribe("C:\\Users\\anand\\AppData\\Local\\Temp\\ml2.wav", beam_size=5, language="ml")
print("time", round(time.time()-t,1),"s", flush=True)
print("TEXT:", " ".join(s.text for s in segs), flush=True)
