import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER, HOME_KEYS, categoryOf } from './categories.js'
import { finaliseMessage, getRecording, logAction, startDraft } from './db.js'
import { createMessageSession } from './message-session.js'
import { playSpeechPart, prepareSpeech } from './speech.js'
import { Brand, Icon, SymbolArtwork } from './ui.jsx'
import { userError } from './errors-rw.js'
import './board.css'

// Kept as a small adapter for caregiver vocabulary lists.
export function SymbolPicture({ symbol, realistic = true }) {
  return <SymbolArtwork symbol={symbol} realistic={realistic} />
}

export function SymbolCell({ symbol, onPress, size = 'normal', suggested = false, disabled = false, selected = false, realistic = true }) {
  const category = categoryOf(symbol.category)
  return (
    <button className={`cell ${suggested ? 'suggestion-tile suggest' : 'symbol-tile'} ${selected ? 'selected' : ''} ${realistic ? 'photo-cell' : ''} ${size}`}
      style={{ '--tile-accent': category.colour }} onClick={() => onPress(symbol.symbol_id, suggested)}
      aria-label={symbol.label_rw} disabled={disabled} data-symbol={symbol.symbol_id}>
      <span className="picture-frame pic"><SymbolArtwork symbol={symbol} realistic={realistic} /></span>
      <span className="label">{symbol.label_rw}</span>
      {suggested && <span className="suggestion-plus" aria-hidden="true">+</span>}
    </button>
  )
}

export default function Board({
  symbols, byKey, allowed, mode, profileId, profileCode, predictor, onOpenAdult,
  appearance = { motion: true, largeTiles: false, realisticImages: true }, visible = true
}) {
  const [category, setCategory] = useState('core')
  const [message, setMessage] = useState([])
  const [speaking, setSpeaking] = useState(false)
  const [notice, setNotice] = useState('')
  const [audioError, setAudioError] = useState('')
  const messageRef = useRef([])
  const busy = useRef(false)
  const controller = useRef(null)
  const session = useRef(null)
  const boardRef = useRef(null)
  const messageArea = useRef(null)
  const tray = useRef(null)
  const caregiver = useRef(null)
  const wasVisible = useRef(visible)
  const lastLength = useRef(0)
  const dialog = useRef(null)
  const audioDialog = useRef(null)
  const realistic = appearance.realisticImages !== false

  if (!session.current) session.current = createMessageSession({ startDraft, logAction, finaliseMessage }, profileId, mode)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!visible) {
      controller.current?.abort()
      dialog.current?.close()
      audioDialog.current?.close()
    } else if (!wasVisible.current) caregiver.current?.focus({ preventScroll: true })
    wasVisible.current = visible
  }, [visible])
  useLayoutEffect(() => {
    if (!visible || !messageArea.current) return
    const measure = () => boardRef.current?.style.setProperty('--message-area-height', `${messageArea.current.getBoundingClientRect().height}px`)
    measure()
    if (!('ResizeObserver' in window)) return
    const observer = new ResizeObserver(measure)
    observer.observe(messageArea.current)
    return () => observer.disconnect()
  }, [visible])
  useEffect(() => {
    if (message.length > lastLength.current && tray.current) tray.current.scrollLeft = tray.current.scrollWidth
    lastLength.current = message.length
  }, [message.length])
  useEffect(() => {
    if (audioError && visible && !audioDialog.current?.open) audioDialog.current?.showModal()
  }, [audioError, visible])

  const categories = useMemo(() => CATEGORY_ORDER.filter(c => c === 'core' || symbols.some(s => s.category === c && allowed.has(s.symbol_id))), [symbols, allowed])
  useEffect(() => { if (!categories.includes(category)) setCategory('core') }, [categories, category])
  const cells = useMemo(() => {
    const home = [...HOME_KEYS, ...symbols.filter(s => s.category === 'core' && !HOME_KEYS.includes(s.symbol_id)).map(s => s.symbol_id)]
    return (category === 'core' ? home.map(key => byKey[key]).filter(Boolean) : symbols.filter(s => s.category === category))
      .filter(s => allowed.has(s.symbol_id))
  }, [category, symbols, byKey, allowed])
  const suggestions = mode === 'predictive' && predictor
    ? predictor.topK(message, 3, allowed).map(key => byKey[key]).filter(Boolean) : []

  const persist = (type, extra) => session.current.record(type, extra)
    .catch(() => setNotice('Ubutumwa ntibwabashije kubikwa kuri iki gikoresho. Buracyagaragara. Banza urebe niba ububiko bukora.'))
  function updateMessage(next) { messageRef.current = next; setMessage(next) }
  function select(key, suggested = false) {
    if (busy.current || !visible || !allowed.has(key)) return
    setNotice('')
    updateMessage([...messageRef.current, key])
    persist('select', { symbol_key: key, was_suggested: suggested })
  }
  function navigate(next) {
    if (busy.current || next === category) return
    setCategory(next)
    persist('navigate', { context: next === 'core' ? 'home' : `cat:${next}` })
  }
  function focusFirstSymbol() {
    requestAnimationFrame(() => boardRef.current?.querySelector('.symbol-tile:not(:disabled)')?.focus({ preventScroll: true }))
  }
  function correct() {
    if (busy.current || !messageRef.current.length) return
    const fromKeyboard = document.activeElement?.matches('.delete')
    const next = messageRef.current.slice(0, -1)
    updateMessage(next)
    persist('correct')
    if (!next.length && fromKeyboard) focusFirstSymbol()
  }
  function clearAll() {
    if (busy.current) return
    const length = messageRef.current.length
    const fromKeyboard = document.activeElement?.matches('.clear')
    updateMessage([])
    setNotice('')
    if (length) persist('correct', { context: 'clear' })
    if (fromKeyboard) focusFirstSymbol()
  }
  function showMessage() {
    if (!messageRef.current.length || busy.current) return
    audioDialog.current?.close()
    setAudioError('')
    dialog.current?.showModal()
  }
  async function speak() {
    if (!messageRef.current.length || busy.current) return
    const keys = [...messageRef.current]
    const tappedAt = new Date().toISOString()
    const playback = new AbortController()
    let played = false
    busy.current = true
    setSpeaking(true)
    setNotice('')
    setAudioError('')
    controller.current = playback
    try {
      const parts = await prepareSpeech(keys, byKey, getRecording, playback.signal)
      for (const part of parts) await playSpeechPart(part, playback.signal)
      played = true
      await session.current.record('speak', { ts: tappedAt })
      await session.current.finish()
      updateMessage([])
      setCategory('core')
      setNotice('Ubutumwa bwavuzwe kandi bubitswe kuri iki gikoresho.')
    } catch (error) {
      const text = userError(error, 'Ijwi ntiryabashije gukina. Ubutumwa bwawe buracyahari. Ushobora kubwerekana.')
      setNotice(text)
      if (!played && !playback.signal.aborted) setAudioError(text)
    } finally {
      busy.current = false
      setSpeaking(false)
      controller.current = null
    }
  }

  const currentCategory = categoryOf(category)
  return (
    <div ref={boardRef} className={`board ${mode} ${appearance.motion === false ? 'no-motion' : ''} ${appearance.largeTiles ? 'large-tiles' : ''}`} hidden={!visible}>
      <header className="app-header board-header">
        <Brand />
        <div className="app-title"><b>Amagambo yanjye</b><small>Buri wese afite icyo avuga.</small></div>
        <div className="header-actions">
          <span className="local-status"><i />{profileCode || 'Igerageza'}</span>
          <HoldButton buttonRef={caregiver} className="button-soft caregiver-button gear" onHold={onOpenAdult}
            disabled={speaking || !visible} title="Komeza ukande mu gihe cy'isegonda rimwe n'ibice bibiri, cyangwa ukoreshe buto yo kwemeza kuri mwandikisho." ariaLabel="Igenamiterere ry'umurezi">
            <Icon name="settings" /><span>Umurezi<small>Kwinjira</small></span>
          </HoldButton>
        </div>
      </header>

      <div className="board-layout">
        <nav className="category-sidebar rail" aria-label="Ibyiciro">
          <p className="sidebar-label">AMASHUSHO</p>
          {categories.map(key => {
            const meta = CATEGORIES[key]
            return <button key={key} className={`category-button railbtn ${category === key ? 'active on' : ''}`}
              onClick={() => navigate(key)} aria-pressed={category === key} disabled={speaking} title={meta.rw}>
              {meta.symbol && byKey[meta.symbol]
                ? <span className="category-art"><SymbolArtwork symbol={byKey[meta.symbol]} realistic={realistic} /></span>
                : <Icon name={meta.icon} />}
              <span className="category-copy"><b>{meta.rw}</b></span>
            </button>
          })}
          <div className="sidebar-note"><Icon name="leaf" /><b>Amagambo yawe.</b><span>Ibyo uvuga bifite agaciro.</span></div>
        </nav>

        <div className="board-main">
          <div className="message-area" ref={messageArea}>
            <section className="message-panel msgbar" aria-label="Ubutumwa bwanjye">
              <div className="message-panel-top">
                <h1>Ubutumwa bwanjye</h1>
                <div className="edit-actions">
                  <button className="edit-button delete" onClick={correct} disabled={!message.length || speaking} aria-label="Siba ishusho ya nyuma"><Icon name="back" /><span>Siba</span></button>
                  <button className="edit-button clear" onClick={clearAll} disabled={!message.length || speaking} aria-label="Siba ubutumwa bwose"><Icon name="no" /><span>Byose</span></button>
                </div>
              </div>
              <div className="message-compose">
                <div ref={tray} className={`message-tray strip ${message.length ? 'has-message' : ''}`} aria-live="polite" aria-label="Ubutumwa bwawe">
                  {!message.length && <div className="empty-message"><Icon name="more" /><div><b>Kanda ku mashusho</b><small>Hitamo ishusho kugira ngo utangire.</small></div></div>}
                  {message.map((key, index) => <span key={index} className="message-chip chip" style={{ '--chip': categoryOf(byKey[key]?.category).colour }}>
                    <SymbolArtwork symbol={byKey[key]} realistic={realistic} /><span>{byKey[key]?.label_rw ?? key}</span>
                  </span>)}
                </div>
                <div className="speak-actions">
                  <button className={`speak-button ctl speak ${speaking ? 'busy' : ''}`} onClick={speaking ? () => controller.current?.abort() : speak}
                    disabled={!message.length} aria-label={speaking ? 'Hagarika ijwi' : 'Vuga ubutumwa'}><Icon name={speaking ? 'stop' : 'speaker'} /><span>{speaking ? 'Hagarika' : 'Vuga'}</span></button>
                  <button className="show-button ctl show" onClick={showMessage} disabled={!message.length || speaking} aria-label="Erekana ubutumwa"><Icon name="eye" /><span>Erekana</span></button>
                </div>
              </div>
            </section>

            <section className="suggestion-block suggestions" aria-label="Amagambo asabwa">
              <div className="suggestion-header"><span className="suggestion-label"><Icon name="leaf" />{mode === 'predictive' ? 'Birashoboka…' : 'Amagambo yawe'}</span><span className="suggestion-caption">{mode === 'predictive' ? 'Aya magambo ashobora kugufasha' : 'Amashusho aguma aho amenyerewe'}</span></div>
              <div className="suggestion-row row3">
                {mode === 'predictive' && suggestions.map(symbol => <SymbolCell key={symbol.symbol_id} symbol={symbol} onPress={select} suggested disabled={speaking} realistic={realistic} />)}
                {mode !== 'predictive' && <div className="static-hint">Hitamo ishusho iri hasi. Amashusho aguma mu mwanya wayo.</div>}
                {mode === 'predictive' && !predictor && <div className="static-hint">Ubufasha bwo guhitamo amagambo ntibubonetse. Ushobora gukomeza guhitamo amashusho.</div>}
                {mode === 'predictive' && predictor && !suggestions.length && <div className="static-hint">Amashusho azagaragara umurezi amaze kuyahitamo.</div>}
              </div>
            </section>
          </div>

          <section className="symbol-area" aria-label={currentCategory.rw}>
            <div className="grid-heading"><h2>{currentCategory.rw}</h2><span>Amashusho: {cells.length}</span></div>
            <main className="symbol-grid grid" aria-label={`Amashusho: ${currentCategory.rw}`}>
              {cells.map(symbol => <SymbolCell key={symbol.symbol_id} symbol={symbol} onPress={select} disabled={speaking}
                selected={message.includes(symbol.symbol_id)} realistic={realistic} />)}
              {!cells.length && <div className="board-empty empty"><Icon name="leaf" /><h3>Amashusho yawe</h3><p>Nta mashusho yatoranyijwe. Umurezi ashobora kugufasha guhitamo ayo ukeneye.</p><button className="button-outline" onClick={() => onOpenAdult()}><Icon name="settings" />Umurezi</button></div>}
            </main>
            <div className="board-bottom"><span><Icon name="offline" />Kuri iki gikoresho</span><span>{mode === 'predictive' ? 'Ubufasha burafunguye' : 'Hitamo amashusho'}</span><span>Ikinyarwanda</span></div>
          </section>
        </div>
      </div>

      {notice && <div className="board-notice" role="status"><span>{notice}</span>{message.length > 0 && !speaking && <button className="notice-show" onClick={showMessage}><Icon name="eye" />Erekana</button>}<button className="notice-dismiss" onClick={() => setNotice('')} aria-label="Funga ubutumwa bwo kukumenyesha">×</button></div>}

      <dialog ref={dialog} className="message-dialog board-dialog" aria-labelledby="show-title">
        <button className="dialog-close" onClick={() => dialog.current?.close()} aria-label="Funga ubutumwa">×</button>
        <p className="dialog-eyebrow">UBUTUMWA BWANJYE</p><h2 id="show-title">Ubutumwa bwanjye</h2><p className="dialog-subtitle">Amashusho yanjye. Amagambo yanjye.</p>
        <div className="display-message">{message.map((key, index) => <span className="display-chip" key={index} style={{ '--chip': categoryOf(byKey[key]?.category).colour }}>
          <SymbolArtwork symbol={byKey[key]} realistic={realistic} /><b>{byKey[key]?.label_rw ?? key}</b>
        </span>)}</div>
        <div className="dialog-footer"><span>Ereka undi muntu ubu butumwa.</span><button className="button-primary" onClick={() => dialog.current?.close()}><Icon name="back" />Subira ku kibaho</button></div>
      </dialog>
      <dialog ref={audioDialog} className="audio-dialog board-dialog" aria-labelledby="audio-title" aria-describedby="audio-explanation" onClose={() => setAudioError('')}>
        <button className="dialog-close" onClick={() => audioDialog.current?.close()} aria-label="Funga amakuru y'ijwi">×</button>
        <div className="notice-mark"><Icon name="speaker" /></div><p className="dialog-eyebrow">UBUTUMWA BWAWE BURACYAHARI</p>
        <h2 id="audio-title">Erekana ubutumwa bwawe.</h2><p id="audio-explanation" className="dialog-subtitle">{audioError}</p>
        <div className="audio-message">{message.map(key => byKey[key]?.label_rw ?? key).join(' / ')}</div>
        <div className="dialog-footer"><button className="button-outline" onClick={() => { audioDialog.current?.close(); setAudioError(''); onOpenAdult('audio') }}>Igenamiterere ry'ijwi</button><button className="button-primary" onClick={showMessage}><Icon name="eye" />Erekana</button></div>
      </dialog>
    </div>
  )
}

function HoldButton({ onHold, children, className, title, ariaLabel, disabled, buttonRef, ms = 1200 }) {
  const timer = useRef(null)
  const [progress, setProgress] = useState(false)
  const cancel = () => { setProgress(false); clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (disabled) cancel() }, [disabled])
  const start = event => {
    if (disabled || event.button !== 0) return
    cancel()
    setProgress(true)
    timer.current = setTimeout(() => { cancel(); onHold() }, ms)
  }
  return <button ref={buttonRef} className={`${className} ${progress ? 'holding' : ''}`} title={title} aria-label={ariaLabel} disabled={disabled}
    onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onBlur={cancel}
    onClick={event => { if (event.detail === 0) onHold() }} onContextMenu={event => event.preventDefault()}>{children}</button>
}
