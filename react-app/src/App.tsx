import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassSurface from './components/GlassSurface'
import Strands from './components/Strands'
import LiquidEther from './components/LiquidEther'
import OptionWheel from './components/OptionWheel'
import CallMode from './components/CallMode'
import { LANGS } from './lang'
import './App.css'

const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
const STT_LOCALE: Record<string, string> = {
  en: 'en-US', hi: 'hi-IN', ml: 'ml-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', mr: 'mr-IN',
  gu: 'gu-IN', bn: 'bn-IN', pa: 'pa-IN', ur: 'ur-PK', ne: 'ne-NP', si: 'si-LK',
  es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', it: 'it-IT', nl: 'nl-NL', ru: 'ru-RU',
  uk: 'uk-UA', pl: 'pl-PL', sv: 'sv-SE', no: 'nb-NO', da: 'da-DK', fi: 'fi-FI', cs: 'cs-CZ',
  sk: 'sk-SK', sl: 'sl-SI', hr: 'hr-HR', sr: 'sr-RS', bg: 'bg-BG', ro: 'ro-RO', el: 'el-GR',
  tr: 'tr-TR', ar: 'ar-SA', he: 'he-IL', fa: 'fa-IR', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
  ja: 'ja-JP', ko: 'ko-KR', vi: 'vi-VN', th: 'th-TH', id: 'id-ID', ms: 'ms-MY', tl: 'fil-PH',
}
const LANGS_LOCAL_REMOVED = true
const WHISPER_ALIAS: Record<string,string> = { zh:'zh-CN', yue:'zh-TW', jw:'id', nn:'no', nb:'no', iw:'he', fil:'tl' }
const LANG_CODES = LANGS.map(([c]) => c)
const FROM_ITEMS = ['Auto-detect', ...LANGS.map(([, n]) => n)]
const TO_ITEMS = LANGS.map(([, n]) => n)
function normLang(code: string) {
  if (!code) return ''
  const c = String(code).toLowerCase()
  if (LANG_CODES.includes(c)) return c
  if (WHISPER_ALIAS[c]) return WHISPER_ALIAS[c]
  const hit = LANG_CODES.find(x => x.toLowerCase() === c || x.toLowerCase().split('-')[0] === c)
  return hit || ''
}

export default function App() {
  const [from, setFrom] = useState('auto')
  const [to, setTo] = useState('hi')
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [continuous, setContinuous] = useState(false)
  const [handsFree, setHandsFree] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [humanVoice, setHumanVoice] = useState(false)
  const [whisperStt, setWhisperStt] = useState(true)
  const [rvcMode, setRvcMode] = useState(false)
  const [rvcModels, setRvcModels] = useState<any[]>([])
  const [rvcModel, setRvcModel] = useState('')
  const [rvcTranspose, setRvcTranspose] = useState(0)
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [recording, setRecording] = useState(false)
  const [userStop, setUserStop] = useState(false)
  const [finalBuf, setFinalBuf] = useState('')
  const [interimBuf, setInterimBuf] = useState('')
  const [orig, setOrig] = useState('')
  const [tr, setTr] = useState('')
  const [editText, setEditText] = useState('')
  const [micLabel, setMicLabel] = useState('tap to speak')
  const [status, setStatus] = useState('idle')
  const [err, setErr] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [voices, setVoices] = useState<any[]>([])
  const [selectedVoice, setSelectedVoice] = useState('')
  const [outputDevices, setOutputDevices] = useState<any[]>([])
  const [selectedOutput, setSelectedOutput] = useState('')
  const [engine, setEngine] = useState('auto')
  const [langSync, setLangSync] = useState(0)
  const [callOpen, setCallOpen] = useState(false)

  const recRef = useRef<any>(null)
  const speakRef = useRef<any>(null)
  const mediaRecorderRef = useRef<any>(null)
  const recordingRef = useRef(false)
  const audioChunksRef = useRef<Blob[]>([])
  const recStreamRef = useRef<any>(null)
  const audioCtxRef = useRef<any>(null)
  const vadRafRef = useRef(0)
  const micLevelRef = useRef(0)
  const getMicLevel = useCallback(() => micLevelRef.current, [])
  const recStartRef = useRef(0)
  const startListenRef = useRef<any>(null)
  const startWhisperRecRef = useRef<any>(null)
  const switchingWhisperRef = useRef(false)
  const sttRetryRef = useRef(0)
  const busyRef = useRef(false)
  const speakingRef = useRef(false)

  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { speakingRef.current = speaking }, [speaking])

  const showErr = useCallback((m: string) => setErr(m), [])
  const clearErr = useCallback(() => setErr(''), [])

  const loadVoices = useCallback(async () => {
    try {
      const res = await fetch(`http://localhost:8003/voices?lang=${encodeURIComponent(to.split('-')[0])}`, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) throw new Error('http ' + res.status)
      const data = await res.json()
      setVoices(data)
      setSelectedVoice(prev => {
        if (!data.length) return ''
        return data.some((v: any) => v.short === prev) ? prev : data[0].short
      })
    } catch (e: any) {
      showErr('TTS backend unreachable: ' + e.message)
      setTimeout(() => loadVoices(), 3000)
    }
  }, [to, showErr])

  useEffect(() => { loadVoices() }, [loadVoices])

  const loadRvcModels = useCallback(async () => {
    try {
      console.log('loadRvcModels: fetching...')
      const res = await fetch('http://localhost:8004/models', { signal: AbortSignal.timeout(6000) })
      if (!res.ok) throw new Error('http ' + res.status)
      const data = await res.json()
      console.log('loadRvcModels: got', data.length, 'models', data.map((m: any) => m.name))
      setRvcModels(data)
      if (data.length && !rvcModel) setRvcModel(data[0].name)
    } catch (e: any) {
      console.error('loadRvcModels failed:', e)
      showErr('RVC backend unreachable: ' + e.message)
      setTimeout(() => loadRvcModels(), 3000)
    }
  }, [rvcModel, showErr])

  useEffect(() => { if (rvcModels.length > 0 && !rvcMode) setRvcMode(true) }, [rvcModels])
  useEffect(() => { if (rvcMode) setHumanVoice(true) }, [rvcMode])
  useEffect(() => { if (rvcMode) loadRvcModels() }, [rvcMode, loadRvcModels])
  useEffect(() => {
    const t = setInterval(() => {
      if (!rvcModels.length) loadRvcModels()
      if (!voices.length) loadVoices()
    }, 5000)
    return () => clearInterval(t)
  }, [rvcModels.length, voices.length, loadRvcModels, loadVoices])
  const loadOutputDevices = useCallback(async () => {
    try {
      // ensure labels are available
      try { await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {}
      const devs = await navigator.mediaDevices.enumerateDevices()
      const outs = devs.filter((d: any) => d.kind === 'audiooutput')
      setOutputDevices(outs)
      if (outs.length && !selectedOutput) setSelectedOutput(outs[0].deviceId)
    } catch (e: any) { console.warn('output devices', e) }
  }, [selectedOutput])

  useEffect(() => { loadOutputDevices() }, [loadOutputDevices])
  useEffect(() => {
    const h = () => loadOutputDevices()
    navigator.mediaDevices?.addEventListener('devicechange', h)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', h)
  }, [loadOutputDevices])

  const chunkText = (text: string, max = 420) => {
    if (text.length <= max) return [text]
    const parts: string[] = []; let buf = ''
    for (const s of text.split(/(?<=[.!?।。！？])\s+/)) {
      if ((buf + ' ' + s).trim().length > max && buf) { parts.push(buf.trim()); buf = s }
      else buf = (buf + ' ' + s).trim()
    }
    if (buf) parts.push(buf.trim())
    const out: string[] = []
    for (const p of parts) {
      if (p.length <= max) { out.push(p); continue }
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max))
    }
    return out
  }

  const translateOne = useCallback(async (text: string, from: string, to: string) => {
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) throw new Error('gt http ' + res.status)
    const data = await res.json()
    if (Array.isArray(data)) {
      if (data.length && typeof data[0] === 'string') return data.join(' ')
      const parts: string[] = []
      for (const seg of data) {
        if (Array.isArray(seg) && seg.length) {
          if (typeof seg[0] === 'string' && seg[0].trim()) parts.push(seg[0])
          else if (typeof seg[1] === 'string') parts.push(seg[1])
        } else if (typeof seg === 'string') parts.push(seg)
      }
      return parts.join(' ')
    }
    if (data && data.sentences) return data.sentences.map((s: any) => s.trans || '').join('')
    return ''
  }, [])

  const doTranslate = useCallback(async (text: string, srcArg?: string) => {
    if (!text || !text.trim()) return
    const src = srcArg || from
    if (src === to) { setTr(text); if (autoSpeak) await speak(text); return }
    setStatus('thinking'); setTr('…')
    try {
      const engineVal = engine
      let result = ''
      if (false) {
        const chunks = chunkText(text)
        const outs: string[] = []
        for (const c of chunks) outs.push(await translateOne(c, src, to))
        result = outs.join(' ')
      } else {
        try {
          const groqKey = localStorage.getItem('groqKey') || ''
          const savedKey = localStorage.getItem('kyrieApiKey') || ''
          const geminiKey = savedKey.startsWith('AIza') ? savedKey : (localStorage.getItem('geminiKey') || '')
          const usingGemini = engineVal === 'gemini' || (engineVal === 'auto' && geminiKey)
          const keyParam = usingGemini ? (geminiKey ? '&gemini_key=' + encodeURIComponent(geminiKey) : '') : (groqKey ? '&key=' + encodeURIComponent(groqKey) : '')
          const res = await fetch(`http://localhost:8003/translate?text=${encodeURIComponent(text)}&from=${encodeURIComponent(src)}&to=${encodeURIComponent(to)}&engine=${encodeURIComponent(engineVal)}${keyParam}`, { signal: AbortSignal.timeout(120000) })
          if (!res.ok) throw new Error('backend ' + res.status)
          const data = await res.json()
          result = data.translated || ''
          if (!result) throw new Error('empty')
        } catch {
          const chunks = chunkText(text)
          const outs: string[] = []
          for (const c of chunks) outs.push(await translateOne(c, src, to))
          result = outs.join(' ')
        }
      }
      setTr(result)
      const list = JSON.parse(localStorage.getItem('vt_hist') || '[]')
      list.unshift({ o: text, t: result, ts: Date.now(), from: src, to })
      localStorage.setItem('vt_hist', JSON.stringify(list.slice(0, 40)))
      setHistory(list.slice(0, 40))
      if (autoSpeak) await speakRef.current?.(result)
      setStatus('idle')
      setMicLabel('tap to speak')
      setListening(false)
      console.log('after speak: continuous=', continuous, 'handsFree=', handsFree, 'userStop=', userStop)
    } catch (e: any) {
      setTr(''); showErr('Translate failed: ' + e.message); setStatus('idle')
    }
  }, [from, to, autoSpeak, engine, translateOne, showErr])

  // speak placeholder (full implementation ported separately)
  const speak = useCallback(async (text: string) => {
    if (!text) return
    console.log('speak: rvcMode=', rvcMode, 'rvcModel=', rvcModel, 'rvcModels=', rvcModels.length)
    setSpeaking(true)
    const useHuman = humanVoice || rvcMode
    if (useHuman) {
      try {
        if (rvcMode && (!rvcModels.length || !rvcModel)) await loadRvcModels()
        const voice = selectedVoice || voices[0]?.short || ''
        const res = await fetch(`http://localhost:8003/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&lang=${encodeURIComponent(to)}`, { signal: AbortSignal.timeout(30000) })
        if (!res.ok) throw new Error(await res.text())
        let blob = await res.blob()
        if (rvcMode) {
          const model = rvcModel || rvcModels[0]?.name
          if (!model) throw new Error('No RVC models loaded (check 8004)')
          setMicLabel('converting voice…')
          const cu = `http://localhost:8004/convert?model=${encodeURIComponent(model)}&transpose=${encodeURIComponent(rvcTranspose)}&f0method=rmvpe`
          console.log('RVC converting with model:', model, 'base blob size:', blob.size)
          const cr = await fetch(cu, { method: 'POST', body: blob, signal: AbortSignal.timeout(180000) })
          if (cr.ok) {
            const newBlob = await cr.blob()
            console.log('RVC converted blob size:', newBlob.size)
            if (newBlob.size > 0) blob = newBlob
            else showErr('RVC returned empty audio, playing base voice')
          } else {
            const t = await cr.text()
            showErr('RVC failed, playing base voice: ' + t.slice(0, 200))
            console.error('RVC fail', t)
          }
          setMicLabel('tap to speak')
        }
        const audio = new Audio(URL.createObjectURL(blob))
        if (selectedOutput && typeof (audio as any).setSinkId === 'function') {
          try { await (audio as any).setSinkId(selectedOutput) } catch (e) { console.warn('setSinkId', e) }
        }
        await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onerror = () => resolve(); audio.play().catch(() => resolve()) })
      } catch (e: any) { showErr('Human TTS failed: ' + e.message); console.error(e) }
    } else {
      // OS voice
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = STT_LOCALE[to] || to
        window.speechSynthesis.speak(u)
        await new Promise<void>((resolve) => { u.onend = () => resolve(); u.onerror = () => resolve() })
      }
    }
    setSpeaking(false)
  }, [humanVoice, rvcMode, rvcModel, rvcTranspose, voices, rvcModels, selectedVoice, selectedOutput, to, showErr])
  speakRef.current = speak

  // STT functions
  const stopWhisperRec = useCallback(() => {
    if (!recordingRef.current) return
    setRecording(false)
    recordingRef.current = false
    cancelAnimationFrame(vadRafRef.current)
    micLevelRef.current = 0
    try { mediaRecorderRef.current?.stop() } catch {}
    setMicLabel('transcribing…')
  }, [recording])

  const startWhisperRec = useCallback(async () => {
    if (recording) { stopWhisperRec(); return }
    let stream: any
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch (e: any) { showErr('Mic permission denied: ' + e.message); return }
    recStreamRef.current = stream
    audioChunksRef.current = []
    const mr = new MediaRecorder(stream)
    mediaRecorderRef.current = mr
    mr.ondataavailable = (e: any) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
    mr.onstop = async () => {
      try { stream.getTracks().forEach((t: any) => t.stop()) } catch {}
      micLevelRef.current = 0
      if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {}; audioCtxRef.current = null }
      const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
      audioChunksRef.current = []
      setMicLabel('transcribing…'); setStatus('thinking')
      try {
        const hint = from === 'auto' ? '' : `?lang=${encodeURIComponent(from.split('-')[0])}`
        const qs = hint + (rvcMode ? (hint ? '&' : '?') + 'free=1' : '')
        const res = await fetch(`http://localhost:8002/stt${qs}`, { method: 'POST', body: blob, signal: AbortSignal.timeout(120000) })
        if (!res.ok) throw new Error('http ' + res.status)
        const data = await res.json()
        const text = (data.text || '').trim()
        const det = normLang(data.language)
        const src = from === 'auto' ? (det || 'auto') : from
        if (text) {
          if (from === 'auto') setMicLabel(det ? `detected: ${det}` : 'language?')
          setOrig(text); setBusy(true)
          await doTranslate(text, src)
          setBusy(false)
        } else { showErr('No speech recognized.'); setStatus('idle') }
      } catch (e: any) { showErr('Whisper STT failed: ' + e.message); setStatus('idle') }
      setMicLabel('tap to speak')
      if ((continuous || handsFree) && !userStop) setTimeout(() => { if (!recording && !busyRef.current && !speakingRef.current) startListenRef.current?.() }, 1200)
    }
    mr.start()
    setRecording(true); recordingRef.current = true; recStartRef.current = performance.now()
    setUserStop(false)
    setMicLabel('listening… (tap to stop)'); setStatus('listening')
    try {
      const ctx = new (window as any).AudioContext()
      audioCtxRef.current = ctx
      const an = ctx.createAnalyser(); an.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Float32Array(an.fftSize)
      let spoke = false, quietSince = 0
      const loop = () => {
        if (!recordingRef.current) return
        an.getFloatTimeDomainData(buf)
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        micLevelRef.current = Math.min(1, Math.max(micLevelRef.current * 0.7, (rms - 0.002) * 11))
        const now = performance.now()
        if (rms > 0.003) { spoke = true; quietSince = 0 }
        else if (spoke && !quietSince) quietSince = now
        const dur = (now - recStartRef.current) / 1000
        if ((spoke && quietSince && now - quietSince > 700 && dur > 0.5) || dur > 6) { stopWhisperRec(); return }
        if (!spoke && dur > 2) { stopWhisperRec(); return }
        vadRafRef.current = requestAnimationFrame(loop)
      }
      vadRafRef.current = requestAnimationFrame(loop)
    } catch {}
  }, [recording, from, continuous, handsFree, userStop, rvcMode, doTranslate, showErr, stopWhisperRec])

  const startListen: any = useCallback(() => {
    clearErr()
    if (from === 'auto' && !whisperStt) setWhisperStt(true)
    if (!SR && !whisperStt) { showErr('Speech recognition not supported. Use Chrome/Edge or enable Whisper STT.'); return }
    if (busyRef.current || speakingRef.current) return
    if (whisperStt) { startWhisperRec(); return }
    if (!SR) return
    if (listening) { try { recRef.current?.stop() } catch {}; setUserStop(true); return }
    const r = new SR()
    recRef.current = r
    r.lang = STT_LOCALE[from] || from
    r.continuous = continuous && !handsFree
    r.interimResults = true
    r.maxAlternatives = 1
    r.onstart = () => { setListening(true); setUserStop(false); setFinalBuf(''); setInterimBuf(''); setMicLabel('listening… (tap to stop)'); setStatus('listening') }
    r.onresult = (e: any) => {
      sttRetryRef.current = 0
      let fin = '', inter = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) fin += t; else inter += t
      }
      if (fin) setFinalBuf((prev) => (prev + ' ' + fin).trim())
      setInterimBuf(inter.trim())
    }
    r.onerror = (e: any) => {
      if (e.error === 'network' && !whisperStt) {
        switchingWhisperRef.current = true
        sttRetryRef.current = 0
        setWhisperStt(true)
        showErr('Chrome speech service unreachable — switched to local Whisper.')
        setListening(false)
        try { r.abort() } catch {}
        setTimeout(() => { if (!busyRef.current && !speakingRef.current && !userStop) startListenRef.current?.() }, 400)
        return
      }
      if (e.error === 'network' && sttRetryRef.current < 1 && !userStop) {
        sttRetryRef.current++
        setTimeout(() => { if (!listening) startListenRef.current?.() }, 900)
        return
      }
      const m = e.error === 'not-allowed' ? 'Mic permission denied. Allow mic and retry.' :
        e.error === 'no-speech' ? 'No speech heard.' :
        e.error === 'audio-capture' ? 'No mic found.' :
        e.error === 'network' ? 'STT network error: Chrome speech service unreachable.' :
        'STT error: ' + e.error
      showErr(m)
    }
    r.onend = () => {
      setListening(false); setMicLabel('tap to speak')
      if (switchingWhisperRef.current) { switchingWhisperRef.current = false; return }
      const text = (finalBuf + ' ' + interimBuf).trim()
      if (text) {
        setOrig(text); setBusy(true); setStatus('thinking')
        doTranslate(text).then(() => { setBusy(false); if ((continuous || handsFree) && !userStop) setTimeout(() => { if (!listening && !busyRef.current && !speakingRef.current) startListenRef.current?.() }, 1500) })
      } else {
        setStatus('idle')
        if ((continuous || handsFree) && !userStop) setTimeout(() => { if (!listening && !busyRef.current && !speakingRef.current) startListenRef.current?.() }, 1500)
      }
    }
    try { r.start() } catch (err: any) { showErr('Could not start mic: ' + err.message) }
  }, [from, continuous, handsFree, userStop, whisperStt, listening, finalBuf, interimBuf, doTranslate, showErr, clearErr])

  startWhisperRecRef.current = startWhisperRec
  startListenRef.current = startListen

  useEffect(() => {
    // load history
    setHistory(JSON.parse(localStorage.getItem('vt_hist') || '[]'))
  }, [])

  const onMicClick = () => startListen()

  const voiceActive = listening || recording

  const swap = () => {
    const a = from; setFrom(to === 'auto' ? 'en' : to); setTo(a === 'auto' ? 'en' : a)
    setLangSync(k => k + 1)
  }

  const fromIndex = from === 'auto' ? 0 : Math.max(0, LANGS.findIndex(([c]) => c === from) + 1)
  const toIndex = Math.max(0, LANGS.findIndex(([c]) => c === to))

  return (
    <div className="relative min-h-screen text-zinc-100 flex flex-col items-center p-4 gap-4">
      <div className="fixed inset-0 -z-10 bg-zinc-950">
        <LiquidEther
          colors={['#1e1b4b', '#5227FF', '#FF9FFC']}
          intensity={0.9}
          mouseForce={18}
          cursorSize={120}
          persistence={0.75}
          autoDemo
          autoSpeed={0.4}
          autoIntensity={1.8}
          resolution={0.4}
          maxDevicePixelRatio={1.5}
          style={{ position: 'absolute', inset: 0 }}
        />
        <div className="absolute inset-0 bg-zinc-950/60" />
      </div>
      <div className="hidden xl:flex fixed left-0 top-0 bottom-0 w-64 z-20 flex-col">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 pl-8 pt-7">speak</div>
        <div className="relative flex-1">
          <OptionWheel
            key={`from-${langSync}`}
            items={FROM_ITEMS}
            defaultSelected={fromIndex}
            side="left"
            textColor="#52525b"
            activeColor="#ffffff"
            fontSize={1.45}
            spacing={1.55}
            tilt={7}
            blur={2.4}
            fade={0.2}
            inset={30}
            onChange={(i: number) => setFrom(i === 0 ? 'auto' : LANGS[i - 1][0])}
          />
        </div>
      </div>
      <div className="hidden xl:flex fixed right-0 top-0 bottom-0 w-64 z-20 flex-col">
        <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 text-right pr-8 pt-7">translate to</div>
        <div className="relative flex-1">
          <OptionWheel
            key={`to-${langSync}`}
            items={TO_ITEMS}
            defaultSelected={toIndex}
            side="right"
            textColor="#52525b"
            activeColor="#a5b4fc"
            fontSize={1.45}
            spacing={1.55}
            tilt={7}
            blur={2.4}
            fade={0.2}
            inset={30}
            onChange={(i: number) => setTo(LANGS[i][0])}
          />
        </div>
      </div>
      <div className="w-full max-w-3xl glass flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl glass-soft flex items-center justify-center text-lg">🌐</div>
          <div>
            <div className="title text-[22px] leading-none">Kyrie</div>
            <div className="text-[11px] text-zinc-400 mt-1 tracking-wide">voice translator</div>
          </div>
        </div>
        <div className="flex items-center gap-2 glass-soft px-3 py-1.5 rounded-full text-[11px] text-zinc-300">
          <span className={`w-2 h-2 rounded-full ${speaking ? 'bg-sky-400' : listening || recording ? 'bg-rose-400' : 'bg-emerald-400'}`} />
          {status} · RVC {rvcMode ? 'ON' : 'OFF'}
        </div>
        <button onClick={() => setCallOpen(true)} className="btn">📞 call mode</button>
      </div>
      <div className="w-full max-w-3xl flex gap-2 xl:hidden">
        <select value={from} onChange={e => setFrom(e.target.value)} className="field flex-1">
          <option value="auto">Auto-detect</option>
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <button onClick={swap} className="btn px-3">⇄</button>
        <select value={to} onChange={e => setTo(e.target.value)} className="field flex-1">
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <div className="w-full max-w-3xl glass px-4 py-3 flex flex-wrap gap-2">
        {[
          { k: 'autoSpeak', v: autoSpeak, s: setAutoSpeak, label: 'auto-speak' },
          { k: 'continuous', v: continuous, s: setContinuous, label: 'continuous' },
          { k: 'handsFree', v: handsFree, s: setHandsFree, label: 'hands-free' },
          { k: 'editMode', v: editMode, s: setEditMode, label: 'edit' },
          { k: 'humanVoice', v: humanVoice, s: setHumanVoice, label: 'human voice' },
          { k: 'whisperStt', v: whisperStt, s: setWhisperStt, label: 'Whisper STT' },
          { k: 'rvcMode', v: rvcMode, s: setRvcMode, label: 'RVC voice' },
        ].map(({ k, v, s, label }) => (
          <label key={k} className={`chip ${v ? 'chip-on' : ''}`}>
            <input type="checkbox" checked={v} onChange={e => s(e.target.checked)} className="accent-indigo-400 w-3.5 h-3.5" />{label}
          </label>
        ))}
      </div>
      {rvcMode && (
        <div className="w-full max-w-3xl glass flex flex-wrap gap-2 items-center px-4 py-3">
          {rvcModels.length === 0 ? (
            <span className="text-sm text-red-300">No RVC models found. Check 8004.</span>
          ) : (
            <>
              <select value={rvcModel} onChange={e => setRvcModel(e.target.value)} className="field flex-1">
                {rvcModels.map((m: any, i: number) => <option key={m.name + '_' + i} value={m.name}>{m.name}{m.index ? ' (index)' : ''}</option>)}
              </select>
              <label className="text-[11px] uppercase tracking-wider text-zinc-400">pitch</label>
              <input type="number" value={rvcTranspose} onChange={e => setRvcTranspose(Number(e.target.value))} className="field w-16 text-center" />
              <span className="text-[11px] text-zinc-500">semitones</span>
            </>
          )}
        </div>
      )}
      <div className="w-full max-w-3xl glass flex gap-3 items-center px-4 py-3">
        <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-14">engine</label>
        <select value={engine} onChange={e => setEngine(e.target.value)} className="field flex-1">
          <option value="auto">auto (Google→MyMemory→Qwen)</option>
          <option value="google">Google</option>
          <option value="gemini">Gemini Flash (free key)</option>
          <option value="groq">Groq 120B (free key)</option>
          <option value="mymemory">MyMemory (free)</option>
          <option value="aya">Aya (local)</option>
          <option value="qwen">Qwen (local)</option>
        </select>
      </div>
      <div className="w-full max-w-3xl glass flex gap-3 items-center px-4 py-3">
        <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-14">voice</label>
        <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} className="field flex-1">
          {voices.length === 0 && <option value="">loading voices…</option>}
          {voices.map((v: any) => <option key={v.short} value={v.short}>{v.short.replace(/-Neural$/, '').replace(/-/g, ' ')} ({v.gender})</option>)}
        </select>
        <button onClick={() => loadVoices()} className="btn px-3">↻</button>
      </div>
      <div className="w-full max-w-3xl glass flex gap-3 items-center px-4 py-3">
        <label className="text-[11px] uppercase tracking-wider text-zinc-400 w-14">output</label>
        <select value={selectedOutput} onChange={e => setSelectedOutput(e.target.value)} className="field flex-1">
          {outputDevices.map((d: any) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Output ' + d.deviceId.slice(0, 6)}</option>)}
        </select>
      </div>
      <AnimatePresence>{err && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="w-full max-w-3xl glass bg-red-500/10 border-red-400/40 text-red-200 px-4 py-3 text-sm">{err}</motion.div>}</AnimatePresence>
      <div className="w-full max-w-3xl glass px-5 py-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2">original</div>
        {editMode ? (
          <textarea value={editText} onChange={e => setEditText(e.target.value)} className="w-full bg-transparent outline-none resize-vertical min-h-[72px] text-[15px] leading-relaxed" />
        ) : (
          <div className="min-h-[72px] whitespace-pre-wrap text-[15px] leading-relaxed">{orig || <span className="text-zinc-500 italic">Press mic and speak…</span>}{interimBuf && <span className="text-zinc-500"> …{interimBuf}</span>}</div>
        )}
      </div>
      <div className="flex flex-col items-center gap-3">
        <div onClick={onMicClick} className="w-32 h-32 relative cursor-pointer">
          <Strands
            listening={voiceActive}
            getLevel={recording ? getMicLevel : undefined}
            amplitude={voiceActive ? 2.4 : 0.3}
            waviness={voiceActive ? 1.15 : 0.3}
            glow={voiceActive ? 1.15 : 0.55}
            energy={voiceActive ? 0.45 : 0.05}
            speed={voiceActive ? 1 : 0.5}
          />
        </div>
        <button onClick={onMicClick} className="btn px-4 py-2 rounded-full">🎤 tap to speak</button>
        {(listening || recording) && (
          <button onClick={() => { setUserStop(true); if (listening) { try { recRef.current?.stop() } catch {} } if (recording) stopWhisperRec() }} className="px-5 py-2 rounded-full bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium shadow-[0_10px_30px_-12px_rgba(255,60,60,0.9)] transition">■ Stop</button>
        )}
        <div className="text-sm text-zinc-400">{micLabel}</div>
      </div>
      <div className="w-full max-w-3xl glass px-5 py-4">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2">translated</div>
        <div className="min-h-[72px] whitespace-pre-wrap text-[15px] leading-relaxed text-sky-200">{tr || <span className="text-zinc-500 italic">Translation appears here.</span>}</div>
        <div className="flex gap-2 mt-3">
          <GlassSurface width={120} height={40} borderRadius={20} backgroundOpacity={0.1}>
            <button onClick={() => tr && speak(tr)} disabled={!tr || speaking} className="text-sm">🔊 speak</button>
          </GlassSurface>
          <button onClick={() => tr && navigator.clipboard.writeText(tr)} disabled={!tr} className="btn">copy</button>
        </div>
      </div>
      <div className="w-full max-w-3xl glass px-5 py-4 max-h-64 overflow-auto">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2">history</div>
        {history.length === 0 ? <div className="text-zinc-500 text-sm text-center py-4">No history yet</div> : history.map((h, i) => (
          <div key={i} className="mb-3 pb-3 border-b border-white/10 last:border-0">
            <div className="text-[14px] text-zinc-200">{h.o}</div>
            <div className="text-[14px] text-sky-200">{h.t}</div>
          </div>
        ))}
      </div>
      {callOpen && <CallMode onClose={() => setCallOpen(false)} />}
    </div>
  )
}