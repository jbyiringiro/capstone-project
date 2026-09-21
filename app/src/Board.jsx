import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER, HOME_KEYS, categoryOf } from './categories.js'
import { fallbackGlyph } from './emoji.js'
import { finaliseMessage, logAction, startDraft } from './db.js'

// Child-facing board. Every task action is logged (select | navigate | correct | speak); a draft
// message row exists before the first event; Speak finalises the message (proposal 3.2.3, FR4-FR7).

export function SymbolCell({ symbol, onPress, size = 'normal', suggested = false }) {
  const cat = categoryOf(symbol.category)
  return (
    <button
      className={`cell ${size} ${suggested ? 'suggested' : ''}`}
      style={{ '--cat': cat.colour }}
      onClick={() => onPress(symbol.symbol_id, suggested)}
      aria-label={symbol.label_rw}
    >
      <span className="pic">
        {symbol.image_path
          ? <img src={symbol.image_path} alt="" draggable="false" onError={e => { e.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'glyph', textContent: fallbackGlyph(symbol) })) }} />
          : <span className="glyph">{fallbackGlyph(symbol)}</span>}
      </span>
      <span className="label">{symbol.label_rw}</span>
    </button>
  )
}

export default function Board({ symbols, byKey, allowed, mode, profileId, predictor, onOpenAdult, onBench }) {
  const [category, setCategory] = useState('core')
  const [message, setMessage] = useState([])
  const [speaking, setSpeaking] = useState(false)
  const draft = useRef({ id: null, index: 0 })

  // reset the visible board when the adult changes profile or mode
  useEffect(() => { setMessage([]); setCategory('core'); draft.current = { id: null, index: 0 } }, [profileId, mode])

  async function ensureDraft() {
    if (!draft.current.id) draft.current = { id: await startDraft(profileId, mode), index: 0 }
    return draft.current
  }
  async function act(type, extra) { const d = await ensureDraft(); await logAction(d.id, d.index++, type, extra) }

  const visible = s => allowed.has(s.symbol_id)
  const categories = useMemo(() => CATEGORY_ORDER.filter(c => c === 'core' || symbols.some(s => s.category === c && visible(s))), [symbols, allowed])
  const cells = useMemo(() => (category === 'core'
    ? HOME_KEYS.map(k => byKey[k]).filter(Boolean)
    : symbols.filter(s => s.category === category)).filter(visible), [category, symbols, byKey, allowed])
  const suggestions = mode === 'predictive' && predictor
    ? predictor.topK(message, 3, allowed).map(k => byKey[k]).filter(Boolean) : []

  async function select(key, was_suggested = false) {
    await act('select', { symbol_key: key, was_suggested })
    setMessage(m => [...m, key])
  }
  async function navigate(cat) {
    if (cat === category) return
    await act('navigate', { context: cat === 'core' ? 'home' : `cat:${cat}` })
    setCategory(cat)
  }
  async function correct() { if (!message.length) return; await act('correct'); setMessage(m => m.slice(0, -1)) }
  async function clearAll() {
    if (!message.length) return
    for (let i = 0; i < message.length; i++) await act('correct', { context: 'clear' })
    setMessage([])
  }
  async function speak() {
    if (!message.length || speaking) return
    setSpeaking(true)
    await act('speak')
    for (const key of message) {
      const ok = await playClip(key)
      if (!ok && 'speechSynthesis' in window) await speakFallback(byKey[key]?.label_rw ?? key)
    }
    await finaliseMessage(draft.current.id, draft.current.index)
    draft.current = { id: null, index: 0 }
    setMessage([]); setCategory('core'); setSpeaking(false)
  }

  return (
    <div className={`board ${mode}`}>
      <header className="msgbar">
        <HoldButton className="gear" onHold={onOpenAdult} title="Gumya ukanze: umwarimu / Hold for adult area">⚙</HoldButton>
        <div className="strip" aria-live="polite">
          {message.length === 0 && <span className="hint">Kanda ku mashusho ukore interuro · Tap symbols to build a sentence</span>}
          {message.map((k, i) => {
            const s = byKey[k]
            return (
              <span key={i} className="chip" style={{ '--cat': categoryOf(s?.category).colour }}>
                {s?.image_path ? <img src={s.image_path} alt="" /> : <span className="glyph">{s ? fallbackGlyph(s) : '▫️'}</span>}
                <span>{s?.label_rw ?? k}</span>
              </span>
            )
          })}
        </div>
        <button className="ctl delete" onClick={correct} disabled={!message.length} aria-label="Siba imwe">⌫<small>Siba</small></button>
        <button className="ctl clear" onClick={clearAll} disabled={!message.length} aria-label="Siba byose">✕<small>Byose</small></button>
        <button className={`ctl speak ${speaking ? 'busy' : ''}`} onClick={speak} disabled={!message.length} aria-label="Vuga">🔊<small>Vuga</small></button>
      </header>

      {mode === 'predictive' && (
        <section className="suggestions" aria-label="Ibyifuzo">
          <span className="caption">Birashoboka ko ushaka…</span>
          <div className="row3">
            {suggestions.map(s => <SymbolCell key={s.symbol_id} symbol={s} onPress={select} size="suggest" suggested />)}
          </div>
        </section>
      )}

      <div className="body">
        <nav className="rail" aria-label="Ibyiciro">
          {categories.map(c => {
            const meta = CATEGORIES[c]
            return (
              <button key={c} className={`railbtn ${category === c ? 'on' : ''}`} style={{ '--cat': meta.colour }} onClick={() => navigate(c)}>
                <span className="icon">{meta.icon}</span><span>{meta.rw}</span>
              </button>
            )
          })}
        </nav>
        <main className="grid" key={category}>
          {cells.map(s => <SymbolCell key={s.symbol_id} symbol={s} onPress={select} />)}
          {cells.length === 0 && <p className="empty">Nta shusho ryemewe muri iki cyiciro. · No enabled symbols in this category.</p>}
        </main>
      </div>

      {onBench && <button className="benchlink" onClick={onBench} title="Latency benchmark">·</button>}
    </div>
  )
}

// Press-and-hold button (1.2 s) so a child cannot open the adult area by accident.
function HoldButton({ onHold, children, className, title, ms = 1200 }) {
  const timer = useRef(null)
  const [progress, setProgress] = useState(false)
  const start = () => { setProgress(true); timer.current = setTimeout(() => { setProgress(false); onHold() }, ms) }
  const cancel = () => { setProgress(false); clearTimeout(timer.current) }
  return (
    <button className={`${className} ${progress ? 'holding' : ''}`} title={title}
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onContextMenu={e => e.preventDefault()}>
      {children}
    </button>
  )
}

function playClip(key) {
  return new Promise(resolve => {
    const a = new Audio(`/audio/${key}.wav`)
    a.onended = () => resolve(true)
    a.onerror = () => resolve(false)
    a.play().catch(() => resolve(false))
  })
}

function speakFallback(text) {
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'rw-RW'; u.rate = 0.9
    u.onend = resolve; u.onerror = resolve
    speechSynthesis.speak(u)
    setTimeout(resolve, 4000)
  })
}
