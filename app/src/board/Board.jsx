import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER } from '../symbols/categories.js'
import { environmentById, environmentWords } from '../symbols/environments.js'
import { relatedWords } from '../symbols/related-words.js'
import { DEFAULT_PREFERENCES, GRID_SIZES } from '../storage/board-preferences.js'
import { finaliseMessage, logAction, startDraft } from '../storage/messages.js'
import { getRecording } from '../storage/recordings.js'
import { AudioWarmer, playSpeechPart, prepareSpeech } from '../speech/index.js'
import { sentenceBuilder, wordByWord } from '../grammar/sentence.js'
import { Chevron, Icon, SymbolArtwork } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import { useSwipe } from '../shared/use-swipe.js'
import { MessageSession } from './message-session.js'
import { gridPage, gridShape } from './grid-pages.js'
import { sectionKeys, sectionName } from './sections.js'
import { useSuggestions } from './use-suggestions.js'
import { ShowMessageDialog, SpeechFailedDialog } from './MessageDialogs.jsx'
import HoldButton from './HoldButton.jsx'
import SymbolCell from './SymbolCell.jsx'
import './board.css'

const storage = { startDraft, logAction, finaliseMessage }

// The delete key: a black key pointing left with a white cross.
const DeleteMark = () => <svg className="delete-mark" viewBox="0 0 44 30" aria-hidden="true">
  <path d="M13 2h27a2 2 0 0 1 2 2v22a2 2 0 0 1-2 2H13L2 15z" fill="currentColor" />
  <path d="M21 10l10 10M31 10L21 20" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
</svg>
const plain = text => text.toLocaleLowerCase('rw').replace(/[.,?!]/g, '').trim()

// Measures the space left for the picture grid, so 'auto' can fit as many tiles as the screen holds.
function useGridArea(ref, visible) {
  const [area, setArea] = useState(() => ({ width: Math.max(innerWidth - 40, 200), height: Math.max(innerHeight - 300, 200) }))
  useLayoutEffect(() => {
    const element = ref.current
    if (!visible || !element) return
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight
      if (width && height) setArea(previous => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    if (!('ResizeObserver' in window)) {
      addEventListener('resize', measure)
      return () => removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, visible])
  return area
}

// The child's board, with Vuga's own pictures: the speech display bar on top, a thin green toolbar,
// and a dense grid of keys that fills the rest of the screen. The child sees one section, which the
// caregiver chooses; section tabs come back only when a caregiver turns them on. Every picture keeps
// one place: hidden words leave their slot empty, and a next-words page opens in the same grid.
export default function Board({
  symbols, byKey, allowed, mode, profileId, profileCode, predictor, onOpenAdult,
  preferences = DEFAULT_PREFERENCES, visible = true
}) {
  const tabs = preferences.sectionTabs === true
  const home = tabs ? 'core' : preferences.section
  const [category, setCategory] = useState(home)
  const [page, setPage] = useState(0)
  // The next-words page open after a picture such as "kunywa", and the page it opened from.
  const [related, setRelated] = useState(null)
  const [message, setMessage] = useState([])
  const [speaking, setSpeaking] = useState(false)
  const [notice, setNotice] = useState('')
  const [audioError, setAudioError] = useState('')
  const messageRef = useRef([])
  const busy = useRef(false)
  const controller = useRef(null)
  const word = useRef(null)
  const session = useRef(null)
  const warmer = useRef(null)
  const boardRef = useRef(null)
  const gridArea = useRef(null)
  const gridRef = useRef(null)
  const slide = useRef(0)
  const tray = useRef(null)
  const caregiver = useRef(null)
  const wasVisible = useRef(visible)
  const lastLength = useRef(0)
  const dialog = useRef(null)
  const audioDialog = useRef(null)
  const area = useGridArea(gridArea, visible)
  const realistic = preferences.realisticImages !== false
  const labels = preferences.showLabels !== false
  const sentences = preferences.sentenceSpeech !== false
  const toSpeech = keys => (sentences ? sentenceBuilder.build(keys, byKey) : wordByWord(keys, byKey))
  const spoken = useMemo(() => (sentences && message.length ? sentenceBuilder.build(message, byKey).text : ''), [sentences, message, byKey])
  const { suggestions: suggestedKeys, recordSelection } = useSuggestions({
    predictor, personal: preferences.personalSuggestions, profileId, mode, message, allowed
  })

  if (!session.current) session.current = new MessageSession(storage, profileId, mode)
  if (!warmer.current) warmer.current = new AudioWarmer()
  useEffect(() => () => { controller.current?.abort(); word.current?.abort(); warmer.current?.close() }, [])
  useEffect(() => { if (visible) warmer.current.prepare() }, [visible])
  useEffect(() => {
    if (!visible) {
      controller.current?.abort()
      word.current?.abort()
      dialog.current?.close()
      audioDialog.current?.close()
    } else if (!wasVisible.current) caregiver.current?.focus({ preventScroll: true })
    wasVisible.current = visible
  }, [visible])
  useEffect(() => {
    if (message.length > lastLength.current && tray.current) tray.current.scrollLeft = tray.current.scrollWidth
    lastLength.current = message.length
  }, [message.length])
  useEffect(() => {
    if (audioError && visible && !audioDialog.current?.open) audioDialog.current?.showModal()
  }, [audioError, visible])

  const categories = useMemo(() => CATEGORY_ORDER.filter(c => c === 'core' || symbols.some(s => s.category === c && allowed.has(s.symbol_id))), [symbols, allowed])
  // Where the child is: that place's pictures lead the board, so a new place opens on its first page.
  const place = environmentById(preferences.environment)
  const placeWords = useMemo(() => (place ? environmentWords(place.id, preferences.environmentLists) : null), [place, preferences.environmentLists])
  const placeOrder = placeWords?.join(' ') ?? ''
  useEffect(() => { setCategory(home); setPage(0); setRelated(null) }, [home, tabs, placeOrder])
  useEffect(() => { if (tabs && !categories.includes(category)) setCategory('core') }, [tabs, categories, category])
  const nextWords = key => relatedWords(key, preferences.relatedLists).filter(next => byKey[next] && allowed.has(next))
  // Every word of the view keeps its slot; words this board hides are null and show as an empty slot.
  const slots = useMemo(() => {
    const keys = related ? relatedWords(related.key, preferences.relatedLists) : sectionKeys(category, symbols, placeWords)
    return keys.filter(key => byKey[key]).map(key => (allowed.has(key) ? byKey[key] : null))
  }, [related, category, symbols, byKey, allowed, placeWords, preferences.relatedLists])
  const shape = gridShape(preferences.gridSize, area.width, area.height, preferences.largeTiles)
  const grid = gridPage(slots, shape, page)
  const shown = grid.cells.filter(Boolean).length
  const suggestions = suggestedKeys.map(key => byKey[key]).filter(Boolean)
  useEffect(() => { if (related && !slots.some(Boolean)) { setPage(related.page); setRelated(null) } }, [related, slots])

  const persist = (type, extra) => session.current.record(type, extra)
    .catch(() => setNotice('Ubutumwa ntibwabashije kubikwa kuri iki gikoresho. Buracyagaragara. Banza urebe niba ububiko bukora.'))
  function updateMessage(next) { messageRef.current = next; setMessage(next) }
  // Each picture is said as it is chosen, so the child hears the word. A new tap stops the word before.
  async function sayWord(key) {
    word.current?.abort()
    const playback = new AbortController()
    word.current = playback
    try {
      for (const part of await prepareSpeech([key], byKey, getRecording, playback.signal)) await playSpeechPart(part, playback.signal)
    } catch {
      // The word is still in the message; Vuga reports a missing voice when the message is spoken.
    } finally {
      if (word.current === playback) word.current = null
    }
  }
  function leaveRelated() {
    if (!related) return
    setPage(related.page)
    setRelated(null)
  }
  function select(key, suggested = false) {
    if (busy.current || !visible || !allowed.has(key)) return
    setNotice('')
    warmer.current.touch()
    recordSelection(messageRef.current, key)
    updateMessage([...messageRef.current, key])
    persist('select', { symbol_key: key, was_suggested: suggested, context: related ? `related:${related.key}` : null })
    if (preferences.speakOnTap) sayWord(key)
    // A next-words page is the second step of one choice, so opening it and returning from it
    // are part of the tap and are not logged as navigation.
    if (related) leaveRelated()
    else if (preferences.relatedWords && nextWords(key).length) {
      setRelated({ key, page: grid.page })
      setPage(0)
    }
  }
  function navigate(next) {
    if (busy.current || (next === category && !related)) return
    warmer.current.touch()
    setRelated(null)
    setCategory(next)
    setPage(0)
    persist('navigate', { context: next === 'core' ? 'home' : `cat:${next}` })
  }
  function closeRelated() {
    if (busy.current || !related) return
    warmer.current.touch()
    leaveRelated()
    persist('navigate', { context: 'back' })
  }
  // Turning a page is a task action like changing category, so it counts towards taps.
  function turnPage(next) {
    if (busy.current || next === grid.page || next < 0 || next >= grid.pages) return false
    warmer.current.touch()
    setPage(next)
    persist('navigate', { context: `page:${next + 1}` })
    return true
  }
  // On a tablet a sideways swipe across the pictures turns the page too, unless a caregiver turns it
  // off for this child. The new page slides in the way the finger moved, unless motion is off.
  useSwipe(gridArea, step => { if (turnPage(grid.page + step)) slide.current = step }, visible && preferences.swipePages !== false)
  useLayoutEffect(() => {
    const step = slide.current
    slide.current = 0
    if (!step || preferences.motion === false || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    gridRef.current?.animate?.([{ transform: `translateX(${step * 24}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: 'ease-out' })
  }, [grid.page])
  function focusFirstSymbol() {
    requestAnimationFrame(() => boardRef.current?.querySelector('.symbol-tile:not(:disabled)')?.focus({ preventScroll: true }))
  }
  function correct() {
    if (busy.current || !messageRef.current.length) return
    const fromKeyboard = document.activeElement?.matches('.delete')
    const next = messageRef.current.slice(0, -1)
    updateMessage(next)
    leaveRelated()
    persist('correct')
    if (!next.length && fromKeyboard) focusFirstSymbol()
  }
  function clearAll() {
    if (busy.current) return
    const length = messageRef.current.length
    const fromKeyboard = document.activeElement?.matches('.clear')
    updateMessage([])
    leaveRelated()
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
    word.current?.abort()
    setSpeaking(true)
    setNotice('')
    setAudioError('')
    controller.current = playback
    try {
      const parts = await prepareSpeech(toSpeech(keys).parts, byKey, getRecording, playback.signal)
      for (const part of parts) await playSpeechPart(part, playback.signal)
      played = true
      await session.current.record('speak', { ts: tappedAt })
      await session.current.finish()
      updateMessage([])
      setRelated(null)
      setCategory(home)
      setPage(0)
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

  const trigger = related ? byKey[related.key] : null
  const title = trigger ? `${trigger.label_rw} …` : place ? `${place.rw} · ${sectionName(category)}` : sectionName(category)
  const words = message.map(key => byKey[key]?.label_rw ?? key).join(' ')
  return (
    <div ref={boardRef} className={`board ${mode} ${GRID_SIZES[preferences.gridSize] ? 'fixed-grid' : `fit-grid ${preferences.largeTiles ? 'large-tiles' : ''}`} ${preferences.motion === false ? 'no-motion' : ''}`}
      style={{ '--grid-cols': grid.columns, '--grid-rows': grid.rows }} hidden={!visible}>
      <header className="board-top">
        <section className="message-panel msgbar" aria-labelledby="message-title">
          <h1 id="message-title" className="sr-only">Ubutumwa bwanjye</h1>
          {/* The speech display bar shows the chosen words; tapping it speaks them.
              When the words become a sentence, the sentence Vuga will say is shown after them. */}
          <div ref={tray} className={`message-tray strip ${message.length ? 'has-message' : ''}`} aria-live="polite" aria-label="Ubutumwa bwawe"
            onClick={() => { if (!speaking) speak() }}>
            {!message.length && <span className="empty-message">Kanda ku mashusho</span>}
            {/* Words as text; with words hidden on the keys, the chosen pictures instead. */}
            {message.map((key, index) => labels
              ? <span key={index} className="message-chip chip">{byKey[key]?.label_rw ?? key}</span>
              : <span key={index} className="message-chip chip picture-chip" title={byKey[key]?.label_rw}><SymbolArtwork symbol={byKey[key]} realistic={realistic} /></span>)}
            {labels && spoken && plain(spoken) !== plain(words) && <span className="message-sentence">{spoken}</span>}
          </div>
        </section>
        <button className={`speak-button ctl speak ${speaking ? 'busy' : ''}`} onClick={speaking ? () => controller.current?.abort() : speak}
          disabled={!message.length} aria-label={speaking ? 'Hagarika ijwi' : 'Vuga ubutumwa'}><Icon name={speaking ? 'stop' : 'speaker'} /><span>{speaking ? 'Hagarika' : 'Vuga'}</span></button>
        <button className="edit-button clear" onClick={clearAll} disabled={!message.length || speaking} aria-label="Siba ubutumwa bwose"><Icon name="trash" /><span>Siba byose</span></button>
        <button className="edit-button delete" onClick={correct} disabled={!message.length || speaking} aria-label="Siba ishusho ya nyuma"><DeleteMark /></button>
      </header>

      {/* The green toolbar: the way back from a next-words page, page arrows, Erekana and the adult area. */}
      <div className="board-strip">
        <span className="strip-name">Vuga</span>
        <span className="local-status"><span className="profile-code">{profileCode || 'Igerageza'}</span>{place && <b className="place-status">{place.rw}</b>}</span>
        {trigger && <button className="related-tab" onClick={closeRelated} disabled={speaking} aria-label={`Funga amagambo akurikira ${trigger.label_rw}`}>
          <Chevron /><span>{trigger.label_rw}</span>
        </button>}
        <span className="strip-space" />
        {grid.pages > 1 && <div className="page-controls" role="group" aria-label="Impapuro">
          <button className="page-button" onClick={() => turnPage(grid.page - 1)} disabled={speaking || grid.page === 0} aria-label="Urupapuro rubanziriza"><Chevron /></button>
          <span aria-live="polite">Urupapuro {grid.page + 1}/{grid.pages}</span>
          <button className="page-button next" onClick={() => turnPage(grid.page + 1)} disabled={speaking || grid.page === grid.pages - 1} aria-label="Urupapuro rukurikira"><Chevron /></button>
        </div>}
        <button className="show-button ctl show" onClick={showMessage} disabled={!message.length || speaking} aria-label="Erekana ubutumwa"><Icon name="eye" /><span>Erekana</span></button>
        <HoldButton buttonRef={caregiver} className="caregiver-button gear" onHold={onOpenAdult}
          disabled={speaking || !visible} title="Komeza ukande mu gihe cy'isegonda rimwe n'ibice bibiri, cyangwa ukoreshe buto yo kwemeza kuri mwandikisho." ariaLabel="Igenamiterere ry'umurezi">
          <Icon name="parent" /><span>Umurezi</span>
        </HoldButton>
      </div>

      {tabs && <div className="board-nav">
        <nav className="category-bar" aria-label="Ibyiciro">
          {categories.map(key => {
            const meta = CATEGORIES[key]
            const active = !related && category === key
            return <button key={key} className={`category-button railbtn ${active ? 'active on' : ''}`}
              onClick={() => navigate(key)} aria-pressed={active} disabled={speaking} title={meta.rw}>
              {meta.symbol && byKey[meta.symbol]
                ? <span className="category-art"><SymbolArtwork symbol={byKey[meta.symbol]} realistic={realistic} /></span>
                : <Icon name={meta.icon} />}
              <span className="category-copy"><b>{meta.rw}</b></span>
            </button>
          })}
        </nav>
      </div>}

      {/* The suggestion row keeps its height on both boards, so the grid sits in the same place with or without suggestions. */}
      <section className="suggestion-block suggestions" aria-label="Amagambo asabwa">
        <div className="suggestion-row row3">
          <span className="suggestion-label">{mode === 'predictive' ? 'Birashoboka' : 'Amagambo yawe'}</span>
          {mode === 'predictive' && suggestions.map(symbol => <SymbolCell key={symbol.symbol_id} symbol={symbol} onPress={select} suggested disabled={speaking} realistic={realistic} showLabel={labels} />)}
          {mode !== 'predictive' && <div className="static-hint">Amashusho aguma mu mwanya wayo.</div>}
          {mode === 'predictive' && !predictor && <div className="static-hint">Ubufasha bwo guhitamo amagambo ntibubonetse. Ushobora gukomeza guhitamo amashusho.</div>}
          {mode === 'predictive' && predictor && !suggestions.length && <div className="static-hint">Amashusho azagaragara umurezi amaze kuyahitamo.</div>}
        </div>
      </section>

      <section ref={gridArea} className={`symbol-area ${related ? 'related-page' : ''}`} aria-label={title}>
        <main ref={gridRef} className="symbol-grid grid" aria-label={`Amashusho: ${title}`}>
          {grid.cells.map((symbol, index) => symbol
            ? <SymbolCell key={symbol.symbol_id} symbol={symbol} onPress={select} disabled={speaking}
              selected={message.includes(symbol.symbol_id)} realistic={realistic} showLabel={labels} />
            : <span key={`hidden-${index}`} className="grid-slot" aria-hidden="true" />)}
          {shown > 0 && Array.from({ length: grid.empty }, (_, i) => <span key={`empty-${i}`} className="grid-slot" aria-hidden="true" />)}
          {!shown && <div className="board-empty empty"><Icon name="leaf" /><h3>Amashusho yawe</h3><p>Nta mashusho yatoranyijwe. Umurezi ashobora kugufasha guhitamo ayo ukeneye.</p><button className="button-outline" onClick={() => onOpenAdult()}><Icon name="settings" />Umurezi</button></div>}
        </main>
      </section>

      {notice && <div className="board-notice" role="status"><span>{notice}</span>{message.length > 0 && !speaking && <button className="notice-show" onClick={showMessage}><Icon name="eye" />Erekana</button>}<button className="notice-dismiss" onClick={() => setNotice('')} aria-label="Funga ubutumwa bwo kukumenyesha">×</button></div>}

      <ShowMessageDialog ref={dialog} message={message} byKey={byKey} realistic={realistic} sentence={spoken} />
      <SpeechFailedDialog ref={audioDialog} message={message} byKey={byKey} explanation={audioError}
        onClosed={() => setAudioError('')} onShow={showMessage}
        onOpenAudioSettings={() => { audioDialog.current?.close(); setAudioError(''); onOpenAdult('audio') }} />
    </div>
  )
}
