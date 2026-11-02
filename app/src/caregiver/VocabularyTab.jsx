import { useEffect, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER } from '../symbols/categories.js'
import { getVocabulary, setVocabulary } from '../storage/vocabulary.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import { Heading } from './components.jsx'
import { useSerialTask } from './use-serial-task.js'
import VocabularyReview from './VocabularyReview.jsx'

export default function VocabularyTab({ symbols, byKey, activeProfile, setError, setWorking, onSaved, onNavigate, preferences }) {
  const [enabled, setEnabled] = useState(null), [filter, setFilter] = useState(''), [categoryFilter, setCategoryFilter] = useState('all')
  const [status, setStatus] = useState(''), [reviewing, setReviewing] = useState(false)
  const [busy, run] = useSerialTask(setError, setWorking)
  useEffect(() => { let current = true; setEnabled(null); setStatus(''); setFilter(''); setCategoryFilter('all'); if (activeProfile) getVocabulary(activeProfile.profile_id).then(keys => { if (current) setEnabled(new Set(keys ?? symbols.map(s => s.symbol_id))) }).catch(e => setError(userError(e))); return () => { current = false } }, [activeProfile, symbols])
  async function save(next) {
    const result = await run(async () => {
      setStatus('Birimo kubikwa…')
      await setVocabulary(activeProfile.profile_id, [...next]); setEnabled(next); await onSaved([...next])
    })
    if (result !== 'ignored') setStatus(result === 'done' ? 'Bibitswe kuri iki gikoresho' : 'Impinduka ntizashoboye kubikwa')
  }
  const toggle = key => { const next = new Set(enabled); next.has(key) ? next.delete(key) : next.add(key); save(next) }
  const category = (cat, on) => { const next = new Set(enabled); symbols.filter(s => s.category === cat).forEach(s => on ? next.add(s.symbol_id) : next.delete(s.symbol_id)); save(next) }
  const query = filter.trim().toLowerCase(), matches = s => !query || (s.label_rw ?? '').toLowerCase().includes(query)
  return <><Heading eyebrow={`Amashusho · ${activeProfile?.code ?? 'Igerageza'}`} title="Amagambo umwana akenera buri munsi.">Hitamo amashusho akwiriye iki kibaho. Harimo ayo guhitamo, kwanga, gusaba ubufasha no kuganira buri munsi.</Heading>
    <div className="dash-card review-card"><div><h2>Gusuzuma amagambo</h2><p>Erekana buri shusho uko igaragara ku kibaho, mu rutonde rumwe n’urupapuro rwo gusuzuma. Ibisubizo byandikwa ku rupapuro; nta na kimwe kibikwa hano.</p></div>
      <button type="button" className="button-outline" onClick={() => setReviewing(true)}>Suzuma amagambo rimwe rimwe</button></div>
    {reviewing && <VocabularyReview symbols={symbols} byKey={byKey} realistic={preferences.realisticImages !== false} onClose={() => setReviewing(false)} />}
    {!activeProfile ? <div className="dash-empty"><h2>Banza uhitemo umwirondoro</h2><p>Ikibaho cy’igerageza kirimo amashusho yose. Ongeramo cyangwa uhitemo umwirondoro kugira ngo uwuhitiremo amashusho.</p><button className="button-outline" onClick={() => onNavigate('children')}>Hitamo umwirondoro</button></div> : !enabled ? <p role="status">Amashusho arimo gupakira…</p> : <>
      <div className="dash-vocabulary-toolbar"><label className="dash-search"><input type="search" aria-label="Shakisha amashusho" placeholder="Shakisha ishusho…" value={filter} onChange={e => setFilter(e.target.value)} /></label><div><button className="dash-text-button" onClick={() => save(new Set(symbols.map(s => s.symbol_id)))} disabled={busy}>Hitamo yose</button><button className="dash-text-button" onClick={() => save(new Set())} disabled={busy}>Kuraho yose</button></div></div>
      <div className="dash-category-filters" aria-label="Hitamo icyiciro cy’amashusho"><button className={categoryFilter === 'all' ? 'active' : ''} aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>Amashusho yose</button>{CATEGORY_ORDER.filter(cat => symbols.some(s => s.category === cat)).map(cat => <button key={cat} className={categoryFilter === cat ? 'active' : ''} aria-pressed={categoryFilter === cat} onClick={() => setCategoryFilter(cat)}>{CATEGORIES[cat].rw}</button>)}</div>
      <div className="dash-section-title"><h2>Amashusho yatoranyijwe: {enabled.size}</h2><span>Ahari yose: {symbols.length}</span></div><p className="dash-save-note" role="status">{status || 'Impinduka zihita zibikwa kuri iki gikoresho.'}</p>{!enabled.size && <p className="dash-notice">Uyu mwirondoro nta mashusho watoranyirijwe. Toranya nibura rimwe kugira ngo umwana abashe gutegura ubutumwa.</p>}
      {CATEGORY_ORDER.filter(cat => categoryFilter === 'all' || categoryFilter === cat).map(cat => {
        const items = symbols.filter(s => s.category === cat && matches(s)); if (!items.length) return null; const meta = CATEGORIES[cat]
        return <section className="dash-vocab-category" key={cat}><div className="dash-category-heading"><h3>{meta.rw}</h3><div><button className="dash-text-button" aria-label={`Hitamo yose mu cyiciro ${meta.rw}`} onClick={() => category(cat, true)} disabled={busy}>Yose</button><button className="dash-text-button" aria-label={`Kuraho yose mu cyiciro ${meta.rw}`} onClick={() => category(cat, false)} disabled={busy}>Nta na rimwe</button></div></div>
          <div className="dash-vocab-grid">{items.map(s => <label key={s.symbol_id} className={`dash-vocab-tile ${enabled.has(s.symbol_id) ? 'enabled' : ''}`}><input type="checkbox" checked={enabled.has(s.symbol_id)} onChange={() => toggle(s.symbol_id)} disabled={busy} aria-label={`Hitamo ${s.label_rw}`} /><SymbolArtwork symbol={s} realistic={preferences.realisticImages} /><b>{s.label_rw}</b></label>)}</div></section>
      })}
      {!symbols.some(s => (categoryFilter === 'all' || s.category === categoryFilter) && matches(s)) && <p className="dash-support">Nta mashusho abonetse. Gerageza irindi jambo cyangwa ikindi cyiciro.</p>}
    </>}</>
}
