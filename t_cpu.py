import time
import rvc_server as r
print("device:", r.DEVICE)
data=open(r"C:\Users\anand\AppData\Local\Temp\opencode\stttest.wav","rb").read()
t=time.time(); wav,sr=r.convert("cypher", data, transpose=-12, f0method="rmvpe"); print("1st", round(time.time()-t,2),"s")
t=time.time(); wav,sr=r.convert("cypher", data, transpose=-12, f0method="rmvpe"); print("2nd", round(time.time()-t,2),"s")
t=time.time(); wav,sr=r.convert("cypher", data, transpose=-12, f0method="pm"); print("pm ", round(time.time()-t,2),"s")
open(r"C:\Users\anand\AppData\Local\Temp\opencode\cpu_rvc.wav","wb").write(wav)
