import { useCallback, useEffect, useRef, useState } from 'react'
import { LANGS, LANG_NAMES } from '../lang'

const DEFAULT_MIC_THRESHOLD = 0.006
const DEFAULT_SYS_THRESHOLD = 0.006
const MIN_SPEECH_MS = 350
const MAX_UTTERANCE_MS = 20000
const COOLDOWN_MS = 300

type Side = 'you' | 'them'

type LogEntry = {
  id: number
  side: Side
  src: string
  dst: string
  from: string
  to: string
  engine: string
  voice: string
}

type Channel = {
  side: Side
  stream: MediaStream
  analyser: AnalyserNode
  buf: Float32Array
  rec: MediaRecorder | null
  chunks: Blob[]
  speaking: boolean
  start: number
  last: number
  floor: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export default function CallMode({ onClose }: { onClose: () => void }) {
  const [youLang, setYouLang] = useState('en')
  const [themLang, setThemLang] = useState('ml')
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [micId, setMicId] = useState('')
  const [cableId, setCableId] = useState('')
  const [hpId, setHpId] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('idle')
  const [log, setLog] = useState<LogEntry[]>([])
  const [rvcOn, setRvcOn] = useState(false)
  const [rvcModel, setRvcModel] = useState('')
  const [rvcModels, setRvcModels] = useState<any[]>([])
  const [transpose, setTranspose] = useState(0)
  const [engine, setEngine] = useState('auto')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kyrieApiKey') || '')
  const [voiceYou, setVoiceYou] = useState('auto')
  const [voiceThem, setVoiceThem] = useState('auto')
  const [silenceMs, setSilenceMs] = useState(1200)
  const [micThreshold, setMicThreshold] = useState(DEFAULT_MIC_THRESHOLD)
  const [sysThreshold, setSysThreshold] = useState(DEFAULT_SYS_THRESHOLD)
  const [levels, setLevels] = useState({ you: 0, them: 0 })

  const runningRef = useRef(false)
  const busyRef = useRef(false)
  const cooldownRef = useRef(0)
  const rafRef = useRef(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const chansRef = useRef<Channel[]>([])
  const streamsRef = useRef<MediaStream[]>([])
  const youLangRef = useRef(youLang)
  const themLangRef = useRef(themLang)
  const cableIdRef = useRef(cableId)
  const hpIdRef = useRef(hpId)
  const rvcOnRef = useRef(rvcOn)
  const rvcModelRef = useRef(rvcModel)
  const transposeRef = useRef(transpose)
  const engineRef = useRef(engine)
  const apiKeyRef = useRef(apiKey)
  const voiceYouRef = useRef(voiceYou)
  const voiceThemRef = useRef(voiceThem)
  const silenceRef = useRef(silenceMs)
  const micThresholdRef = useRef(micThreshold)
  const sysThresholdRef = useRef(sysThreshold)
  const voiceCache = useRef<Record<string, string>>({})
  const idRef = useRef(0)
  const outputsRef = useRef<MediaDeviceInfo[]>([])
  const lastLevelAt = useRef(0)

  outputsRef.current = outputs

  youLangRef.current = youLang
  themLangRef.current = themLang
  cableIdRef.current = cableId
  hpIdRef.current = hpId
  rvcOnRef.current = rvcOn
  rvcModelRef.current = rvcModel
  transposeRef.current = transpose
  engineRef.current = engine
  apiKeyRef.current = apiKey
  voiceYouRef.current = voiceYou
  voiceThemRef.current = voiceThem
  silenceRef.current = silenceMs
  micThresholdRef.current = micThreshold
  sysThresholdRef.current = sysThreshold

  useEffect(() => {
    (async () => {
      try {
        try { await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {}
        const devs = await navigator.mediaDevices.enumerateDevices()
        const ins = devs.filter(d => d.kind === 'audioinput')
        const outs = devs.filter(d => d.kind === 'audiooutput')
        setInputs(ins)
        setOutputs(outs)
        if (ins.length && !micId) setMicId(ins[0].deviceId)
        const cable = outs.find(o => /cable input/i.test(o.label))
        if (cable) setCableId(cable.deviceId)
        const hp = outs.find(o => /headphone|speaker/i.test(o.label) && !/cable/i.test(o.label))
        if (hp) setHpId(hp.deviceId)
        else if (outs.length) setHpId(outs[0].deviceId)
      } catch {}
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!rvcOn) return
    (async () => {
      // ContentVec preload can take ~30 s on first start. Retry instead of
      // declaring the backend dead after one 8 s timeout.
      setStatus('RVC backend starting on 8004…')
      let last: any = null
      for (let i = 0; i < 5; i++) {
        try {
          const h = await fetch('http://localhost:8004/health', { signal: AbortSignal.timeout(8000) })
          if (!h.ok) throw new Error('health http ' + h.status)
          const res = await fetch('http://localhost:8004/models', { signal: AbortSignal.timeout(8000) })
          const data = await res.json()
          setRvcModels(data)
          if (data.length && !rvcModel) setRvcModel(data[0].name)
          setStatus('RVC ready · ' + data.length + ' models')
          return
        } catch (e: any) {
          last = e
          await new Promise(r => setTimeout(r, 1500))
        }
      }
      setStatus(`RVC backend unreachable on 8004: ${String(last?.message || last?.name || 'error').slice(0, 70)}`)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rvcOn])

  const pushLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog(prev => [{ ...entry, id: ++idRef.current }, ...prev].slice(0, 40))
  }, [])

  const warm = useCallback((lang: string) => {
    const code = lang.split('-')[0]
    fetch(`http://localhost:8002/warm?lang=${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(240000)
    }).catch(() => {})
  }, [])

  const stt = useCallback(async (blob: Blob, lang: string) => {
    const code = lang.split('-')[0]
    const res = await fetch(`http://localhost:8002/stt?lang=${encodeURIComponent(code)}`, {
      method: 'POST',
      body: blob,
      signal: AbortSignal.timeout(120000)
    })
    if (!res.ok) throw new Error('stt http ' + res.status)
    const data = await res.json()
    return String(data.text || '').trim()
  }, [])

  const translate = useCallback(async (text: string, from: string, to: string) => {
    const key = apiKeyRef.current
    let eng = engineRef.current
    // Route by key shape, so a Gemini key pasted while "Groq" is selected still works.
    if (key.startsWith('AIza') && (eng === 'groq' || eng === 'auto')) eng = 'gemini'
    if (key.startsWith('gsk_') && eng === 'gemini') eng = 'groq'
    const keyParam = !key ? '' : eng === 'gemini' ? `&gemini_key=${encodeURIComponent(key)}` : `&key=${encodeURIComponent(key)}`
    const url = (e: string) => `http://localhost:8003/translate?text=${encodeURIComponent(text)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&engine=${encodeURIComponent(e)}${keyParam}`
    const res = await fetch(url(eng), { signal: AbortSignal.timeout(60000) })
    if (res.ok) {
      const data = await res.json()
      return { text: String(data.translated || '').trim(), engine: String(data.engine || eng) }
    }
    let detail = ''
    try {
      const body = await res.json()
      detail = Array.isArray(body?.tried) ? body.tried.join('; ') : String(body?.error || '')
    } catch {}
    // Keep the call alive: retry once on Google when the chosen engine is down.
    if (eng !== 'google') {
      try {
        const fb = await fetch(url('google'), { signal: AbortSignal.timeout(30000) })
        if (fb.ok) {
          const data = await fb.json()
          return { text: String(data.translated || '').trim(), engine: 'google (fallback)' }
        }
      } catch {}
    }
    throw new Error('translate ' + res.status + ': ' + detail.slice(0, 110))
  }, [])

  const pickVoice = useCallback(async (lang: string, gender: string) => {
    const code = lang.split('-')[0]
    const key = code + ':' + gender
    if (voiceCache.current[key]) return voiceCache.current[key]
    try {
      const res = await fetch(`http://localhost:8003/voices?lang=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(8000) })
      const list = await res.json()
      const want = gender.toLowerCase()
      const chosen = want === 'auto'
        ? list?.[0]
        : (list || []).find((v: any) => String(v.gender || '').toLowerCase() === want) || list?.[0]
      const short = chosen?.short || ''
      if (short) voiceCache.current[key] = short
      return short
    } catch {
      return ''
    }
  }, [])

  const tts = useCallback(async (text: string, lang: string, gender: string) => {
    const voice = await pickVoice(lang, gender)
    const res = await fetch(
      `http://localhost:8003/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&lang=${encodeURIComponent(lang)}`,
      { signal: AbortSignal.timeout(45000) }
    )
    if (!res.ok) throw new Error('tts http ' + res.status)
    return { blob: await res.blob(), voice: voice || 'default' }
  }, [pickVoice])

  const rvc = useCallback(async (blob: Blob) => {
    const model = rvcModelRef.current || rvcModels[0]?.name
    if (!model) throw new Error('no RVC model selected')
    const res = await fetch(
      `http://localhost:8004/convert?model=${encodeURIComponent(model)}&transpose=${transposeRef.current}&f0method=rmvpe`,
      { method: 'POST', body: blob, signal: AbortSignal.timeout(60000) }
    )
    if (!res.ok) throw new Error('rvc http ' + res.status)
    return await res.blob()
  }, [rvcModels])

  const play = useCallback(async (blob: Blob, sinkId: string) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = 1
    if (sinkId) {
      if (typeof (audio as any).setSinkId === 'function') {
        try {
          await (audio as any).setSinkId(sinkId)
        } catch (e: any) {
          const label = outputsRef.current.find(o => o.deviceId === sinkId)?.label || sinkId.slice(0, 8)
          setStatus(`cannot switch to "${label}" (${e?.name || 'error'}) — playing on default`)
        }
      } else {
        setStatus('this browser cannot choose an output device — using default')
      }
    }
    await new Promise<void>(resolve => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      audio.play().catch((e: any) => {
        setStatus('playback blocked: ' + (e?.name || 'error'))
        resolve()
      })
    })
    URL.revokeObjectURL(url)
  }, [])

  const toneBlob = useCallback(() => {
    const rate = 24000
    const seconds = 0.7
    const frames = Math.floor(rate * seconds)
    const buffer = new ArrayBuffer(44 + frames * 2)
    const view = new DataView(buffer)
    const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
    str(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); str(8, 'WAVE')
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    str(36, 'data'); view.setUint32(40, frames * 2, true)
    for (let i = 0; i < frames; i++) {
      const t = i / rate
      const env = Math.min(1, t * 12) * Math.min(1, (seconds - t) * 6)
      const s = Math.sin(2 * Math.PI * 660 * t) * 0.25 * env
      view.setInt16(44 + i * 2, s * 32767, true)
    }
    return new Blob([buffer], { type: 'audio/wav' })
  }, [])

  const testOutput = useCallback(async (side: Side) => {
    const sink = side === 'you' ? cableIdRef.current : hpIdRef.current
    const label = outputsRef.current.find(o => o.deviceId === sink)?.label || (sink ? sink.slice(0, 8) : 'default')
    setStatus(`test tone → ${label}`)
    await play(toneBlob(), sink)
    setStatus(`test tone done → ${label}`)
  }, [play, toneBlob])

  // Synthesize a short line, run it through the selected RVC model, and play it
  // into the headphones so the clone can be judged without joining a call.
  const testRvc = useCallback(async () => {
    const model = rvcModelRef.current || rvcModels[0]?.name || ''
    if (!model) { setStatus('no RVC model selected'); return }
    try {
      setStatus(`RVC test: rendering with ${model}…`)
      const spoken = await tts('Hello, this is a test of the cloned voice.', 'en', voiceThemRef.current)
      let audio = await rvc(spoken.blob)
      await play(audio, hpIdRef.current)
      setStatus(`RVC test played → headphones · ${model} (base ${spoken.voice})`)
    } catch (e: any) {
      setStatus(`RVC test failed: ${String(e?.message || e).slice(0, 90)}`)
    }
  }, [tts, rvc, play, rvcModels])

  // Plays a tone into the cable and measures the cable's own capture device,
  // so we can prove the outbound route works before blaming Discord.
  const verifyCable = useCallback(async () => {
    const sink = cableIdRef.current || outputsRef.current.find(o => /cable input/i.test(o.label))?.deviceId || ''
    if (!sink) { setStatus('no CABLE Input device found'); return }
    const cableCapture = inputs.find(d => /cable output/i.test(d.label))
    if (!cableCapture) { setStatus('CABLE Output not found in inputs — is VB-CABLE installed?'); return }
    setStatus('checking cable…')
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: cableCapture.deviceId } } })
      ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Float32Array(an.fftSize)
      let peak = 0
      const timer = setInterval(() => {
        an.getFloatTimeDomainData(buf as any)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        peak = Math.max(peak, Math.sqrt(sum / buf.length))
      }, 60)
      await play(toneBlob(), sink)
      clearInterval(timer)
      const ok = peak > 0.005
      setStatus(ok
        ? `cable OK — tone reached CABLE Output (level ${peak.toFixed(3)}). Set Discord input to CABLE Output.`
        : 'cable silent — no signal on CABLE Output. Check Windows volume for CABLE Input / reinstall VB-CABLE.')
    } catch (e: any) {
      setStatus('cable check failed: ' + String(e?.message || e).slice(0, 90))
    } finally {
      stream?.getTracks().forEach(t => t.stop())
      try { await ctx?.close() } catch {}
    }
  }, [inputs, play, toneBlob])

  const handleUtterance = useCallback(async (side: Side, blob: Blob, durMs: number) => {
    if (durMs < MIN_SPEECH_MS) { busyRef.current = false; return }
    const src = side === 'you' ? youLangRef.current : themLangRef.current
    const dst = side === 'you' ? themLangRef.current : youLangRef.current
    const who = side === 'you' ? 'you' : 'them'
    try {
      const t0 = performance.now()
      const timer = setInterval(() => {
        setStatus(`${who}: transcribing… ${Math.round((performance.now() - t0) / 1000)}s`)
      }, 700)
      setStatus(`${who}: transcribing…`)
      let text = ''
      try {
        text = await stt(blob, src)
      } finally {
        clearInterval(timer)
      }
      if (!text) return
      setStatus(`${who}: translating…`)
      const result = await translate(text, src, dst)
      if (!result.text) return
      setStatus(`${who}: speaking…`)
      const spoken = await tts(result.text, dst, side === 'you' ? voiceThemRef.current : voiceYouRef.current)
      let audio = spoken.blob
      let voice = 'Edge TTS · ' + spoken.voice
      if (side === 'you' && rvcOnRef.current) {
        try {
          setStatus(`${who}: RVC converting…`)
          const model = rvcModelRef.current || rvcModels[0]?.name || ''
          audio = await rvc(audio)
          voice = 'RVC · ' + model
        } catch (e: any) {
          voice = 'RVC failed · Edge TTS · ' + spoken.voice
          setStatus(`RVC failed: ${String(e?.message || e).slice(0, 70)} — used Edge TTS`)
        }
      }
      const sinkId = side === 'you' ? cableIdRef.current : hpIdRef.current
      await play(audio, sinkId)
      const sinkLabel = outputsRef.current.find(o => o.deviceId === sinkId)?.label || 'default'
      pushLog({ side, src, dst, from: text, to: result.text, engine: result.engine, voice })
      setStatus(`listening · last: ${who} → ${sinkLabel}`)
    } catch (e: any) {
      setStatus(`${who}: ${String(e?.message || e).slice(0, 80)}`)
    } finally {
      busyRef.current = false
      cooldownRef.current = performance.now() + COOLDOWN_MS
    }
  }, [stt, translate, tts, rvc, play, pushLog])

  const stop = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    for (const ch of chansRef.current) {
      try { ch.rec?.stop() } catch {}
      ch.rec = null
    }
    chansRef.current = []
    for (const s of streamsRef.current) {
      try { s.getTracks().forEach(t => t.stop()) } catch {}
    }
    streamsRef.current = []
    try { ctxRef.current?.close() } catch {}
    ctxRef.current = null
    busyRef.current = false
    setRunning(false)
    setStatus('idle')
  }, [])

  const start = useCallback(async () => {
    if (runningRef.current) return
    setStatus('requesting microphones…')
    try {
      const cable = cableIdRef.current || outputsRef.current.find(o => /cable input/i.test(o.label))?.deviceId || ''
      if (!cable) {
        setStatus('select "CABLE Input" as the call output first (VB-CABLE playback device)')
        return
      }
      cableIdRef.current = cable
      if (!cableId) setCableId(cable)

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: micId
          ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      streamsRef.current.push(mic)

      setStatus('select your screen and tick "share system audio"…')
      const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const sysTracks = disp.getAudioTracks()
      disp.getVideoTracks().forEach(t => t.stop())
      if (!sysTracks.length) {
        setStatus('no system audio shared — stop, then start again and tick "Share system audio"')
        disp.getTracks().forEach(t => t.stop())
        return
      }
      const sys = new MediaStream(sysTracks)
      streamsRef.current.push(sys)

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const make = (side: Side, stream: MediaStream) => {
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(an)
        return {
          side,
          stream,
          analyser: an,
          buf: new Float32Array(an.fftSize),
          rec: null,
          chunks: [],
          speaking: false,
          start: 0,
          last: 0,
          floor: 0.0005
        } as Channel
      }
      const chans = [make('you', mic), make('them', sys)]
      chansRef.current = chans

      const beginRec = (ch: Channel) => {
        try {
          const mr = new MediaRecorder(ch.stream)
          ch.chunks = []
          mr.ondataavailable = (e: BlobEvent) => { if (e.data.size) ch.chunks.push(e.data) }
          mr.onstop = () => {
            const blob = new Blob(ch.chunks, { type: mr.mimeType || 'audio/webm' })
            const dur = performance.now() - ch.start
            ch.chunks = []
            if (blob.size > 2000) void handleUtterance(ch.side, blob, dur)
            else busyRef.current = false
          }
          mr.start()
          ch.rec = mr
        } catch {
          busyRef.current = false
        }
      }

      const endRec = (ch: Channel) => {
        try { ch.rec?.stop() } catch { busyRef.current = false }
        ch.rec = null
      }

      runningRef.current = true
      setRunning(true)
      setStatus('listening · speak in either language')
      warm(youLangRef.current)
      warm(themLangRef.current)

      const loop = () => {
        if (!runningRef.current) return
        const now = performance.now()
        const lv: { you: number; them: number } = { you: 0, them: 0 }
        for (const ch of chans) {
          const rms = (() => {
            ch.analyser.getFloatTimeDomainData(ch.buf as any)
            let sum = 0
            for (let i = 0; i < ch.buf.length; i++) sum += ch.buf[i] * ch.buf[i]
            return Math.sqrt(sum / ch.buf.length)
          })()
          lv[ch.side] = clamp((rms - 0.002) * 8, 0, 1)
          const threshold = ch.side === 'you' ? micThresholdRef.current : sysThresholdRef.current
          // Track the quiet noise floor, so a soft talker is not clipped mid-sentence.
          if (!ch.speaking && rms < threshold * 2) ch.floor = ch.floor * 0.98 + rms * 0.02
          const loud = rms > Math.max(threshold, ch.floor * 3)
          if (!ch.speaking) {
            if (!busyRef.current && now > cooldownRef.current && loud) {
              ch.speaking = true
              ch.start = now
              ch.last = now
              busyRef.current = true
              beginRec(ch)
            }
          } else {
            if (loud) ch.last = now
            else if (now - ch.last > silenceRef.current) { ch.speaking = false; endRec(ch) }
            if (now - ch.start > MAX_UTTERANCE_MS) { ch.speaking = false; endRec(ch) }
          }
        }
        if (now - lastLevelAt.current > 100) {
          lastLevelAt.current = now
          setLevels(lv)
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (e: any) {
      setStatus('start failed: ' + String(e?.message || e).slice(0, 100))
      stop()
    }
  }, [micId, handleUtterance, stop, warm])

  useEffect(() => () => stop(), [stop])

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md overflow-auto p-4">
      <div className="max-w-3xl mx-auto glass px-5 py-5 my-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-lg font-semibold">Call mode</div>
            <div className="text-[11px] text-zinc-400">two-way live translation for Discord / Meet</div>
          </div>
          <button onClick={() => { stop(); onClose() }} className="btn">close</button>
        </div>

        <div className="grid gap-2 mb-4">
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">your language</label>
            <select value={youLang} onChange={e => setYouLang(e.target.value)} className="field flex-1">
              {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">their language</label>
            <select value={themLang} onChange={e => setThemLang(e.target.value)} className="field flex-1">
              {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">translator</label>
            <select value={engine} onChange={e => setEngine(e.target.value)} className="field flex-1">
              <option value="auto">auto · Google first, then fallbacks</option>
              <option value="google">Google · idiomatic (free)</option>
              <option value="mymemory">MyMemory · often literal</option>
              <option value="qwen">Qwen 2B · local, meaning-level</option>
              <option value="aya">Aya 8B · local, meaning-level</option>
              <option value="gemini">Gemini Flash · free key</option>
              <option value="groq">Groq · free key</option>
            </select>
          </div>
          {(engine === 'gemini' || engine === 'groq' || engine === 'auto') && (
            <div className="flex gap-3 items-center">
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">{engine === 'gemini' ? 'Gemini key' : 'API key'}</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); localStorage.setItem('kyrieApiKey', e.target.value) }}
                placeholder={engine === 'gemini' ? 'AI Studio key' : 'Groq key (optional with auto)'}
                className="field flex-1"
              />
              <span className="text-[10px] text-zinc-500 w-28">stored in this browser</span>
            </div>
          )}
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">voice to them</label>
            <select value={voiceThem} onChange={e => setVoiceThem(e.target.value)} className="field flex-1">
              <option value="auto">auto · first available</option>
              <option value="female">female</option>
              <option value="male">male</option>
            </select>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">voice to you</label>
            <select value={voiceYou} onChange={e => setVoiceYou(e.target.value)} className="field flex-1">
              <option value="auto">auto · first available</option>
              <option value="female">female</option>
              <option value="male">male</option>
            </select>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">end after silence</label>
            <input type="range" min={500} max={2500} step={100} value={silenceMs} onChange={e => setSilenceMs(Number(e.target.value))} className="flex-1 accent-sky-400" />
            <span className="text-[11px] text-zinc-300 w-12 text-right">{(silenceMs / 1000).toFixed(1)}s</span>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">mic threshold</label>
            <input type="range" min={0.001} max={0.02} step={0.001} value={micThreshold} onChange={e => setMicThreshold(Number(e.target.value))} className="flex-1 accent-rose-400" />
            <span className="text-[11px] text-zinc-300 w-12 text-right">{micThreshold.toFixed(3)}</span>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">them threshold</label>
            <input type="range" min={0.001} max={0.02} step={0.001} value={sysThreshold} onChange={e => setSysThreshold(Number(e.target.value))} className="flex-1 accent-sky-400" />
            <span className="text-[11px] text-zinc-300 w-12 text-right">{sysThreshold.toFixed(3)}</span>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">microphone</label>
            <select value={micId} onChange={e => setMicId(e.target.value)} className="field flex-1">
              {inputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
            </select>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">to call (cable)</label>
            <select value={cableId} onChange={e => setCableId(e.target.value)} className="field flex-1">
              <option value="">— pick CABLE Input —</option>
              {outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
            </select>
            <button onClick={() => testOutput('you')} className="btn px-3">test</button>
          </div>
          <div className="flex gap-3 items-center">
            <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-32">to your ears</label>
            <select value={hpId} onChange={e => setHpId(e.target.value)} className="field flex-1">
              <option value="">default</option>
              {outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
            </select>
            <button onClick={() => testOutput('them')} className="btn px-3">test</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center mb-4">
          <label className={`chip ${rvcOn ? 'chip-on' : ''}`}>
            <input type="checkbox" checked={rvcOn} onChange={e => setRvcOn(e.target.checked)} className="accent-indigo-400 w-3.5 h-3.5" />
            RVC on your voice
          </label>
          {rvcOn && (
            <>
              <select value={rvcModel} onChange={e => setRvcModel(e.target.value)} className="field w-48">
                {rvcModels.length === 0 && <option value="">no models</option>}
                {rvcModels.map((m: any, i: number) => <option key={m.name + i} value={m.name}>{m.name}</option>)}
              </select>
              <label className="text-[11px] text-zinc-400">pitch</label>
              <input type="number" value={transpose} onChange={e => setTranspose(Number(e.target.value))} className="field w-16 text-center" />
              <button onClick={testRvc} className="btn px-3">test RVC → ears</button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 mb-4">
          {running
            ? <button onClick={stop} className="px-5 py-2 rounded-full bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium">■ stop call mode</button>
            : <button onClick={start} className="px-5 py-2 rounded-full bg-emerald-500/90 hover:bg-emerald-500 text-black text-sm font-semibold">▶ start call mode</button>}
          <span className="text-[12px] text-zinc-400">{status}</span>
          <button onClick={verifyCable} className="btn px-3 ml-auto">verify cable</button>
        </div>

        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">you</div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-rose-400 transition-[width] duration-100" style={{ width: `${Math.round(levels.you * 100)}%` }} />
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">them (system audio)</div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-sky-400 transition-[width] duration-100" style={{ width: `${Math.round(levels.them * 100)}%` }} />
            </div>
          </div>
        </div>

        <div className="text-[11px] text-zinc-500 leading-relaxed mb-4">
          Discord → Settings → Voice → Input = <span className="text-zinc-300">CABLE Output</span>, Output = your headphones.
          When you press start, pick a screen/window and tick <span className="text-zinc-300">share system audio</span> so their side is captured.
        </div>

        <div className="max-h-64 overflow-auto border-t border-white/10 pt-3">
          {log.length === 0
            ? <div className="text-zinc-500 text-sm py-3">Nothing translated yet.</div>
            : log.map(e => (
              <div key={e.id} className="mb-3 pb-3 border-b border-white/10 last:border-0">
                <div className="text-[11px] text-zinc-500 mb-1">
                  {e.side === 'you' ? 'you' : 'them'} · {LANG_NAMES[e.src] || e.src} → {LANG_NAMES[e.dst] || e.dst}
                  <span className="ml-2 text-violet-300">{e.engine}</span>
                  <span className="ml-2 text-emerald-300">{e.voice}</span>
                </div>
                <div className="text-[14px] text-zinc-200">{e.from}</div>
                <div className="text-[14px] text-sky-200">{e.to}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
