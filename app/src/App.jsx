import { useEffect, useMemo, useRef, useState } from 'react'
import Dashboard from './Dashboard.jsx'
import { benchPredictor } from './bench.js'
import { db, finaliseMessage, logAction, startDraft } from './db.js'
import { loadPredictor } from './predictor.js'
import symbolsCsv from '../../vocab/symbols.csv?raw'

// Child-facing board: fixed category grid, message strip, correction, Speak, and the complete
// all-action log (select | navigate | correct | speak). Suggestions (FR6) appear only in
// predictive mode, restricted to the profile's enabled vocabulary, and bypass navigation.

function parseSymbols(csv) {
  const [head, ...rows] = csv.trim().split(/\r?\n/)
  const cols = head.split(',')
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])))
}

const HOME_KEYS = ['I', 'YOU', 'WANT', 'NOT', 'YES', 'NO', 'HELP', 'THANK_YOU', 'EAT', 'DRINK', 'PLAY', 'GO']

export default function App() {
  const symbols = useMemo(() => parseSymbols(symbolsCsv), [])
  const byKey = useMemo(() => Object.fromEntries(symbols.map(s => [s.symbol_id, s])), [symbols])
  const categories = useMemo(() => [...new Set(symbols.map(s => s.category))], [symbols])

  const [view, setView] = useState('board')
  const [mode, setMode] = useState('static')
  const [profile, setProfile] = useState(null)
  const [enabledKeys, setEnabledKeys] = useState(null)   // null = whole vocabulary
  const [category, setCategory] = useState(null)
  const [message, setMessage] = useState([])
  const [predictor, setPredictor] = useState(null)
  const [bench, setBench] = useState(null)
  const draft = useRef({ id: null, index: 0 })
  const profileId = profile?.profile_id ?? 'demo'

  useEffect(() => { loadPredictor().then(setPredictor) }, [])
  useEffect(() => {
    db.settings.get('mode').then(m => m && setMode(m.value))
    db.settings.get('profile').then(p => p && setProfile(p.value))
  }, [])
  useEffect(() => { db.settings.put({ key: 'mode', value: mode }) }, [mode])
  useEffect(() => {
    db.settings.put({ key: 'profile', value: profile })
    if (!profile) { setEnabledKeys(null); return }
    db.vocabulary.where('profile_id').equals(profile.profile_id).toArray()
      .then(rows => setEnabledKeys(rows.length ? new Set(rows.map(r => r.key)) : null))
  }, [profile])

  async function ensureDraft() {
    if (!draft.current.id) draft.current = { id: await startDraft(profileId, mode), index: 0 }
    return draft.current
  }
  async function act(type, extra) { const d = await ensureDraft(); await logAction(d.id, d.index++, type, extra) }

  const allowed = enabledKeys ?? new Set(symbols.map(s => s.symbol_id))
  const suggestions = mode === 'predictive' && predictor ? predictor.topK(message, 3, allowed) : []

  async function select(key, was_suggested = false) { await act('select', { symbol_key: key, was_suggested }); setMessage(m => [...m, key]) }
  async function navigate(cat) { await act('navigate', { context: cat ? `cat:${cat}` : 'home' }); setCategory(cat) }
  async function correct() { if (!message.length) return; await act('correct'); setMessage(m => m.slice(0, -1)) }
  async function speak() {
    if (!message.length) return
    await act('speak')
    for (const key of message) {
      const ok = await playClip(key)
      if (!ok && 'speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(byKey[key]?.label_rw ?? key); u.lang = 'rw-RW'; speechSynthesis.speak(u)
      }
    }
    await finaliseMessage(draft.current.id, draft.current.index)
    draft.current = { id: null, index: 0 }
    setMessage([]); setCategory(null)
  }

  const visible = s => allowed.has(s.symbol_id)
  const cells = (category ? symbols.filter(s => s.category === category) : HOME_KEYS.map(k => byKey[k]).filter(Boolean)).filter(visible)

  if (view === 'dashboard') return (
    <Dashboard onClose={() => setView('board')} onSelectProfile={setProfile} activeProfile={profile} mode={mode} setMode={setMode} />
  )

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
        <span>{profile ? profile.code : 'demo'} · {mode} · {predictor ? 'model loaded' : 'no model'}</span>
        <span>
          <button className="link" onClick={async () => setBench(await benchPredictor(predictor, [[], ['I'], ['I', 'WANT'], ['YOU', 'NOT']]))}>bench</button>
          {bench && <small> median {bench.median_ms} ms, p95 {bench.p95_ms} ms</small>}
          {' '}<button className="link" onClick={() => setView('dashboard')}>Umwarimu</button>
        </span>
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
