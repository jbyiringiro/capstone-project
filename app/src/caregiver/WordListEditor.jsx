import { useState } from 'react'
import { SymbolArtwork } from '../shared/ui.jsx'
import './word-lists.css'

// The pictures in one list (the words for a place, or the next words after a picture) with a
// search to add more. The tab that owns the list saves every change at once.
export default function WordListEditor({ label, keys, symbols, byKey, realistic, max, busy, onChange }) {
  const [query, setQuery] = useState('')
  const words = keys.filter(key => byKey[key])
  const full = words.length >= max
  const filter = query.trim().toLocaleLowerCase()
  const choices = filter ? symbols.filter(s => s.label_rw.toLocaleLowerCase().includes(filter) && !words.includes(s.symbol_id)).slice(0, 24) : []
  async function add(key) {
    await onChange([...words, key])
    setQuery('')
  }
  return <div className="word-list">
    <div className="word-list-items">
      {words.map(key => <div key={key} className="word-list-item">
        <SymbolArtwork symbol={byKey[key]} realistic={realistic} /><b>{byKey[key].label_rw}</b>
        <button type="button" className="word-list-remove" onClick={() => onChange(words.filter(k => k !== key))} disabled={busy} aria-label={`Kuraho ${byKey[key].label_rw}`}>×</button>
      </div>)}
      {!words.length && <p className="word-list-empty">Nta shusho iri kuri uru rutonde.</p>}
    </div>
    <label className="dash-search word-list-search"><input type="search" value={query} onChange={e => setQuery(e.target.value)} disabled={full || busy}
      placeholder={full ? `Wageze ku mashusho ${max}` : 'Shakisha ishusho wongeraho…'} aria-label={`Shakisha ishusho wongera kuri ${label}`} /></label>
    {choices.length > 0 && <div className="word-list-results">{choices.map(s => <button key={s.symbol_id} type="button" onClick={() => add(s.symbol_id)} disabled={busy}>
      <SymbolArtwork symbol={s} realistic={realistic} /><span>{s.label_rw}</span><span aria-hidden="true">+</span>
    </button>)}</div>}
  </div>
}
