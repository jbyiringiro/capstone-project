import { useEffect, useMemo, useRef, useState } from 'react'
import { finaliseMessage, logAction, startDraft } from './db.js'
import { loadPredictor } from './predictor.js'
import symbolsCsv from '../../vocab/symbols.csv?raw'

// Week 4 scaffold: fixed category board, message strip, Speak, and the full all-action log.
// Suggestions (FR6) are shown only when the profile is in predictive mode and a model is loaded.

function parseSymbols(csv) {
  const [head, ...rows] = csv.trim().split(/\r?\n/)
  const cols = head.split(',')
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])))
}

const HOME_KEYS = ['I', 'YOU', 'WANT', 'NOT', 'YES', 'NO', 'HELP_ME', 'THANK_YOU']

export default function App() {
  const symbols = useMemo(() => parseSymbols(symbolsCsv), [])
  const byKey = useMemo(() => Object.fromEntries(symbols.map(s => [s.symbol_id, s])), [symbols])
  const categories = useMemo(() => [...new Set(symbols.map(s => s.category))], [symbols])

  const [mode, setMode] = useState('static')          // static | predictive (set by the adult)
  const [category, setCategory] = useState(null)      // null = home board
  const [message, setMessage] = useState([])          // symbol keys in the strip
  const [predictor, setPredictor] = useState(null)
  const draft = useRef({ id: null, index: 0 })
  const profileId = 'demo'

  useEffect(() => { loadPredictor().then(setPredictor) }, [])

  async function ensureDraft() {
    if (!draft.current.id) {
      draft.current = { id: await startDraft(profileId, mode), index: 0 }
    }
    return draft.current
  }
  async function act(type, extra) {
    const d = await ensureDraft()
    await logAction(d.id, d.index++, type, extra)
  }

  const allowed = useMemo(() => new Set(symbols.map(s => s.symbol_id)), [symbols])
  const suggestions = mode === 'predictive' && predictor ? predictor.topK(message, 3, allowed) : []

  async function select(key, was_suggested = false) {
    await act('select', { symbol_key: key, was_suggested })
    setMessage(m => [...m, key])
  }
  async function navigate(cat) {
    await act('navigate', { context: cat ? `cat:${cat}` : 'home' })
    setCategory(cat)
  }
  async function correct() {
    if (!message.length) return
    await act('correct')
    setMessage(m => m.slice(0, -1))
  }
  async function speak() {
    if (!message.length) return
    await act('speak')
    // recorded clips are the primary output (FR5); play sequentially, fall back to TTS if missing
    for (const key of message) {
      const ok = await playClip(key)
      if (!ok && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(byKey[key]?.label_rw ?? key); u.lang = 'rw-RW'
        speechSynthesis.speak(u)
      }
    }
    await finaliseMessage(draft.current.id, draft.current.index)
    draft.current = { id: null, index: 0 }
    setMessage([]); setCategory(null)
  }

  const cells = category ? symbols.filter(s => s.category === category)
                         : HOME_KEYS.map(k => byKey[k]).filter(Boolean)

  return (
    <div className="app">
      <header>
        <div className="strip" aria-label="message">
          {message.map((k, i) => <span key={i} className="chip">{byKey[k]?.label_rw ?? k}</span>)}
        </div>
        <button className="btn correct" onClick={correct} aria-label="Siba">⌫</button>
        <button className="btn speak" onClick={speak} aria-label="Vuga">🔊 Vuga</button>
      </header>

      {mode === 'predictive' && (
        <div className="suggestions">
          {suggestions.map(k => (
            <button key={k} className="cell suggest" onClick={() => select(k, true)}>
              <span className="label">{byKey[k]?.label_rw ?? k}</span>
            </button>
          ))}
        </div>
      )}

      <nav className="categories">
        <button className={`tab ${category === null ? 'on' : ''}`} onClick={() => navigate(null)}>Urugo</button>
        {categories.map(c => (
          <button key={c} className={`tab ${category === c ? 'on' : ''}`} onClick={() => navigate(c)}>{c}</button>
        ))}
      </nav>

      <main className="grid">
        {cells.map(s => (
          <button key={s.symbol_id} className="cell" onClick={() => select(s.symbol_id)}>
            {s.image_path ? <img src={s.image_path} alt="" /> : <span className="glyph">▢</span>}
            <span className="label">{s.label_rw}</span>
          </button>
        ))}
      </main>

      <footer>
        <label>Uburyo: <select value={mode} onChange={e => setMode(e.target.value)}>
          <option value="static">static</option>
          <option value="predictive">predictive</option>
        </select></label>
        <span>{predictor ? 'model loaded' : 'no model (static only)'}</span>
      </footer>
    </div>
  )
}

async function playClip(key) {
  return new Promise(resolve => {
    const a = new Audio(`/audio/${key}.wav`)
    a.onended = () => resolve(true)
    a.onerror = () => resolve(false)
    a.play().catch(() => resolve(false))
  })
}
