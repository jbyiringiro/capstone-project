import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { db, deleteRecording, getRecording, saveRecording } from './db.js'
import { Icon, SymbolArtwork } from './ui.jsx'
import { localizedError, userError } from './errors-rw.js'
import './audio-settings.css'

const MAX_SECONDS = 15
const MAX_BYTES = 10 * 1024 * 1024

const clipError = localizedError

async function validateClip(blob) {
  if (!blob.size) throw clipError('Nta jwi ririmo. Ongera ufate ijwi cyangwa uhitemo indi dosiye.')
  if (blob.size > MAX_BYTES) throw clipError('Hitamo dosiye y’ijwi iri munsi ya MB 10.')
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) throw clipError('Iyi porogaramu ukoresha gufungura imbuga ntishobora kugenzura ijwi. Gerageza indi igezweho.')
  const context = new AudioContext()
  try {
    let buffer
    try { buffer = await context.decodeAudioData(await blob.arrayBuffer()) }
    catch { throw clipError('Iyi dosiye y’ijwi ntifunguka. Gerageza dosiye ya WAV, MP3, WebM cyangwa Ogg.') }
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw clipError('Nta jwi ririmo. Ongera ugerageze.')
    if (buffer.duration > MAX_SECONDS + 0.5) throw clipError('Ijwi rya buri jambo ntirigomba kurenza amasegonda 15.')
    let peak = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel)
      for (let index = 0; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index]))
    }
    if (peak < 0.001) throw clipError('Nta jwi ryumvikana muri iyi dosiye. Genzura mikoro, wongere ufate ijwi.')
    return { blob, duration: buffer.duration }
  } finally { await context.close().catch(() => {}) }
}

function microphoneError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Gukoresha mikoro ntibyemewe. Byemere mu igenamiterere ry’uru rubuga cyangwa uhitemo dosiye y’ijwi.'
  if (error.name === 'NotFoundError') return 'Nta mikoro yabonetse. Huza mikoro n’iki gikoresho cyangwa uhitemo dosiye y’ijwi.'
  if (error.name === 'NotReadableError') return 'Mikoro ntiboneka cyangwa iri gukoreshwa ahandi. Funga izindi porogaramu ziyikoresha, wongere ugerageze.'
  return userError(error, 'Gufata ijwi ntibyatangiye. Ongera ugerageze cyangwa uhitemo dosiye y’ijwi.')
}

function ClipPlayer({ blob, label }) {
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const player = useRef(null)
  useEffect(() => {
    if (!blob) return
    const objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    player.current = audio
    setPlaying(false); setCurrent(0); setDuration(0); setError('')
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    audio.ontimeupdate = () => setCurrent(audio.currentTime)
    audio.onplay = () => setPlaying(true)
    audio.onpause = () => setPlaying(false)
    audio.onended = () => { setPlaying(false); setCurrent(0); audio.currentTime = 0 }
    audio.onerror = () => { setPlaying(false); setError('Ijwi ntiryumvikanye. Genzura indangururamajwi, wongere ugerageze.') }
    return () => {
      audio.onloadedmetadata = null; audio.ontimeupdate = null; audio.onplay = null
      audio.onpause = null; audio.onended = null; audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (player.current === audio) player.current = null
      URL.revokeObjectURL(objectUrl)
    }
  }, [blob])
  async function toggle() {
    const audio = player.current
    if (!audio) return
    setError('')
    if (!audio.paused) { audio.pause(); audio.currentTime = 0; setCurrent(0); return }
    try { await audio.play() }
    catch (cause) {
      if (player.current === audio) {
        setPlaying(false)
        setError(userError(cause, 'Ijwi ntiryumvikanye. Emerera uru rubuga gukoresha amajwi, wongere ugerageze.'))
      }
    }
  }
  const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
  return blob ? <div className="audio-clip-player" role="group" aria-label={label}>
    <button type="button" className="button-outline" onClick={toggle} aria-label={`${playing ? 'Hagarika' : 'Umva'}: ${label}`}><Icon name={playing ? 'stop' : 'speaker'} />{playing ? 'Hagarika ijwi' : 'Umva ijwi'}</button>
    <span className="audio-clip-time" aria-label={`Amasegonda ${Math.floor(current)} kuri ${Math.floor(duration)}`}>{time(current)} / {time(duration)}</span>
    {error && <p className="audio-error" role="alert">{error}</p>}
  </div> : null
}

export default function AudioSettings({ symbols, appearance, onRecordingsChange }) {
  const [selectedKey, setSelectedKey] = useState(() => symbols.find(symbol => symbol.symbol_id === 'WATER')?.symbol_id ?? symbols[0]?.symbol_id ?? '')
  const [query, setQuery] = useState('')
  const [recordedKeys, setRecordedKeys] = useState(new Set())
  const [coverageReady, setCoverageReady] = useState(false)
  const [saved, setSaved] = useState(null), [loadingSaved, setLoadingSaved] = useState(true)
  const [candidate, setCandidate] = useState(null)
  const [phase, setPhase] = useState('idle'), [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState('')
  const mounted = useRef(false), recorder = useRef(null), stream = useRef(null)
  const interval = useRef(null), timeout = useRef(null), operation = useRef(0)
  const fileInput = useRef(null)
  const selected = symbols.find(symbol => symbol.symbol_id === selectedKey)
  const locked = phase !== 'idle' || busy || loadingSaved
  const filter = query.trim().toLocaleLowerCase()
  const filtered = symbols.filter(symbol => symbol.label_rw.toLocaleLowerCase().includes(filter))
  const covered = symbols.filter(symbol => recordedKeys.has(symbol.symbol_id)).length

  function releaseMicrophone() {
    clearInterval(interval.current); clearTimeout(timeout.current)
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
  }

  useEffect(() => {
    mounted.current = true
    const subscription = liveQuery(() => db.recordings.toCollection().primaryKeys()).subscribe({
      next: keys => { if (mounted.current) { setRecordedKeys(new Set(keys)); setCoverageReady(true) } },
      error: cause => { if (mounted.current) setError(userError(cause, 'Amajwi yabitswe ntashobora gusomwa. Ongera ugerageze.')) }
    })
    return () => {
      mounted.current = false; operation.current++
      subscription.unsubscribe()
      if (recorder.current) {
        recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.onerror = null
        if (recorder.current.state !== 'inactive') recorder.current.stop()
        recorder.current = null
      }
      releaseMicrophone()
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoadingSaved(true); setSaved(null); setCandidate(null); setConfirmDelete(false)
    setError(''); setStatus('')
    getRecording(selectedKey).then(blob => { if (active) setSaved(blob) })
      .catch(cause => { if (active) setError(userError(cause, 'Iri jwi ntiryafungutse. Ongera ugerageze.')) })
      .finally(() => { if (active) setLoadingSaved(false) })
    return () => { active = false }
  }, [selectedKey])

  async function acceptClip(blob, op) {
    try {
      const validated = await validateClip(blob)
      if (mounted.current && operation.current === op) {
        setCandidate(validated); setStatus('Banza wumve ijwi, hanyuma uribike kuri iri jambo.')
      }
    } catch (cause) { if (mounted.current && operation.current === op) setError(userError(cause, 'Iyi dosiye y’ijwi ntishobora kugenzurwa. Ongera ufate ijwi cyangwa uhitemo indi dosiye.')) }
    finally { if (mounted.current && operation.current === op) setPhase('idle') }
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || locked) return
    setError(''); setStatus(''); setCandidate(null); setConfirmDelete(false)
    setPhase('processing')
    const op = ++operation.current
    await acceptClip(file, op)
  }

  async function startRecording() {
    if (locked) return
    setError(''); setStatus(''); setCandidate(null); setConfirmDelete(false)
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Gufata ijwi ntibishoboka hano. Fungura Vuga ukoresheje ihuza ririnzwe n’uburyo bugezweho bwo gufungura imbuga, cyangwa uhitemo dosiye y’ijwi.')
      return
    }
    const op = ++operation.current
    setPhase('requesting'); setSeconds(0)
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current || operation.current !== op) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      const capture = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      const chunks = []
      recorder.current = capture
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      capture.onerror = event => {
        operation.current++
        capture.onstop = null
        if (capture.state !== 'inactive') capture.stop()
        releaseMicrophone(); recorder.current = null
        if (mounted.current) { setPhase('idle'); setError(microphoneError(event.error ?? event)) }
      }
      capture.onstop = () => {
        releaseMicrophone(); recorder.current = null
        if (!mounted.current || operation.current !== op) return
        setPhase('processing')
        acceptClip(new Blob(chunks, { type: capture.mimeType || chunks[0]?.type || 'audio/webm' }), op)
      }
      capture.start()
      setPhase('recording')
      const startedAt = performance.now()
      interval.current = setInterval(() => { if (mounted.current) setSeconds(Math.min(MAX_SECONDS, Math.floor((performance.now() - startedAt) / 1000))) }, 250)
      timeout.current = setTimeout(() => { if (capture.state === 'recording') { setPhase('processing'); capture.stop(); releaseMicrophone() } }, MAX_SECONDS * 1000)
    } catch (cause) {
      releaseMicrophone()
      if (mounted.current && operation.current === op) { setPhase('idle'); setError(microphoneError(cause)) }
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') { setPhase('processing'); recorder.current.stop(); releaseMicrophone() }
  }

  async function saveClip() {
    if (!candidate || locked) return
    setBusy(true); setError(''); setStatus('')
    const key = selectedKey, blob = candidate.blob
    try {
      await saveRecording(key, blob)
      if (mounted.current) { setSaved(blob); setCandidate(null); setStatus(`Ijwi rya “${selected.label_rw}” ryabitswe kuri iki gikoresho. Rikora na interineti idahari.`) }
      onRecordingsChange?.()
    } catch (cause) { if (mounted.current) setError(userError(cause, 'Ijwi ntiryabitswe. Ongera ugerageze.')) }
    finally { if (mounted.current) setBusy(false) }
  }

  async function removeClip() {
    if (locked) return
    setBusy(true); setError(''); setStatus('')
    try {
      await deleteRecording(selectedKey)
      if (mounted.current) { setSaved(null); setConfirmDelete(false); setStatus(`Ijwi ryabitswe rya “${selected.label_rw}” ryasibwe.`) }
      onRecordingsChange?.()
    } catch (cause) { if (mounted.current) setError(userError(cause, 'Ijwi ntiryasibwe. Ongera ugerageze.')) }
    finally { if (mounted.current) setBusy(false) }
  }

  return <section className="audio-settings" aria-label="Amajwi y’amagambo">
    <div className="dash-heading"><div><p className="dash-eyebrow">Ijwi rimenyerewe</p><h1>Ha buri shusho ijwi.</h1><p>Fata ijwi ry’ijambo mu Kinyarwanda cyangwa uhitemo dosiye y’ijwi. Banza wumve uko rivugwa mbere yo kuribika.</p></div><Icon name="speaker" size={48} /></div>
    <div className="audio-coverage"><Icon name="offline" /><div><strong>{coverageReady ? `Wabikiye amajwi amagambo ${covered} muri ${symbols.length}` : 'Amajwi yabitswe aragenzurwa…'}</strong><p>Amajwi ubika hano aguma kuri iki gikoresho kandi akora na interineti idahari. Abagikoresha bose bashobora kuyumva. Ntabwo yoherezwa kuri seriveri.</p></div></div>
    <div className="audio-layout">
      <div className="audio-picker"><label htmlFor="audio-word-search">Shaka ijambo</label><input id="audio-word-search" type="search" placeholder="Andika ijambo mu Kinyarwanda" value={query} onChange={event => setQuery(event.target.value)} disabled={locked} />
        <p className="audio-picker-help">Hitamo ishusho ushaka gufatira ijwi.</p>
        <div className="audio-word-list" role="group" aria-label="Amagambo yo gufatira amajwi">{filtered.map(symbol => <button type="button" key={symbol.symbol_id} aria-pressed={selectedKey === symbol.symbol_id} disabled={locked} onClick={() => setSelectedKey(symbol.symbol_id)} className={selectedKey === symbol.symbol_id ? 'selected' : ''}><SymbolArtwork symbol={symbol} realistic={appearance?.realisticImages !== false} /><span><b>{symbol.label_rw}</b></span><span className={`audio-word-status ${recordedKeys.has(symbol.symbol_id) ? 'saved' : ''}`}>{recordedKeys.has(symbol.symbol_id) ? 'Ryarabitswe' : 'Ongeraho'}</span></button>)}</div>
        {!filtered.length && <p className="audio-picker-help">Nta jambo ribonetse. Gerageza irindi jambo.</p>}
      </div>
      <div className="audio-editor">{selected ? <>
        <div className="audio-selected"><SymbolArtwork symbol={selected} realistic={appearance?.realisticImages !== false} /><div><p className="dash-eyebrow">Fata ijwi ry’iri jambo</p><h2>{selected.label_rw}</h2></div></div>
        <p className="audio-instruction">Vuga <strong>{selected.label_rw}</strong> neza, uri ahantu hatuje. Ijwi ntirirenge amasegonda {MAX_SECONDS}.</p>
        <div className="audio-capture-actions">{phase === 'recording' ? <button type="button" className="button-primary audio-stop" onClick={stopRecording}><Icon name="stop" />Hagarika gufata ijwi · {seconds}</button> : <button type="button" className="button-primary" onClick={startRecording} disabled={locked}><span className="audio-record-dot" aria-hidden="true" />{phase === 'requesting' ? 'Mikoro irategerejwe…' : phase === 'processing' ? 'Ijwi riragenzurwa…' : 'Fata ijwi'}</button>}<button type="button" className="button-outline" disabled={locked} onClick={() => fileInput.current?.click()}>Hitamo dosiye y’ijwi</button><input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.webm,.ogg,.m4a" hidden aria-label="Dosiye y’ijwi" onChange={chooseFile} /></div>
        <p className="audio-file-note">WAV, MP3, WebM, Ogg cyangwa ubundi bwoko bwemewe · Ntirenge MB 10</p>
        {phase === 'requesting' && <p className="audio-inline-status" role="status">Emera gukoresha mikoro mu butumwa bwa porogaramu ufunguriramo imbuga, kugira ngo utangire.</p>}
        {phase === 'recording' && <p className="audio-inline-status" role="status">Mikoro iri gufata ijwi. Irahagarara nyuma y’amasegonda {MAX_SECONDS}.</p>}
        {error && <div className="audio-error" role="alert">{error}</div>}
        <p className="audio-status" role="status" aria-live="polite">{status}</p>
        {candidate && phase === 'idle' && <section className="audio-preview" aria-label="Ijwi rishya ryo kubanza kumva"><h3>Banza wumve ijwi <small>Amasegonda {candidate.duration.toFixed(1)}</small></h3><ClipPlayer blob={candidate.blob} label={`Ijwi rishya rya ${selected.label_rw}`} /><p>{saved ? 'Ijwi ubika rirajya mu mwanya w’irisanzwe kuri iri jambo, ku bantu bose bakoresha iki gikoresho.' : 'Genzura ko ijambo rivuzwe neza kandi ryumvikana.'}</p><div className="audio-actions"><button type="button" className="button-primary" onClick={saveClip} disabled={locked}>{busy ? 'Ijwi rirabikwa…' : 'Bika ijwi'}</button><button type="button" className="button-outline" disabled={locked} onClick={() => { setCandidate(null); setStatus('Ijwi rishya ryakuweho. Iryari risanzwe ribitse riracyahari.') }}>Reka kubika iri jwi</button></div></section>}
        {saved && phase === 'idle' && <section className="audio-saved" aria-label="Ijwi ryabitswe"><h3><Icon name="speaker" />Ryabitswe kuri iki gikoresho</h3><ClipPlayer blob={saved} label={`Ijwi ryabitswe rya ${selected.label_rw}`} />{confirmDelete ? <div className="audio-delete-confirm"><p>Gusiba iri jwi ku bantu bose bakoresha iki gikoresho?</p><div className="audio-actions"><button type="button" className="button-outline audio-delete" disabled={locked} onClick={removeClip}>Siba ijwi</button><button type="button" className="button-outline" disabled={locked} onClick={() => setConfirmDelete(false)}>Gumana ijwi</button></div></div> : <button type="button" className="audio-delete-link" disabled={locked} onClick={() => setConfirmDelete(true)}>Siba ijwi ryabitswe</button>}</section>}
        {!saved && !loadingSaved && <p className="audio-empty-note">Nturabika ijwi ryawe bwite kuri iri jambo. Ushobora kuribika hano kugira ngo rikoreshwe mbere y’ijwi rizananye na Vuga.</p>}
      </> : <p>Nta magambo yo gufatira amajwi ahari.</p>}</div>
    </div>
    <p className="audio-storage-note">Gusiba amakuru ya porogaramu ufunguriramo imbuga bisiba n’amajwi wabikiyemo. Bika kopi za dosiye z’amajwi yawe kugira ngo uzikoreshe ku kindi gikoresho.</p>
  </section>
}
