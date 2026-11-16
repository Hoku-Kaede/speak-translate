import time, tts_server as t
for txt,tg in [("Hello, can you hear me?","hi"),("I am feeling under the weather today","ml"),("Let us meet tomorrow at five","ta")]:
    s=time.time(); r=t.translate_ollama_model(txt,"en",tg,"qwen3.5:2b")
    print(tg, round(time.time()-s,1),"s", r.encode("unicode_escape").decode())
