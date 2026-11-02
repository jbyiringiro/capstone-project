import { useState } from 'react'
import { ENVIRONMENTS, FRINGE_CATEGORIES, MAX_ENVIRONMENT_WORDS, environmentById, environmentWords } from '../symbols/environments.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { Heading } from './components.jsx'
import { useSerialTask } from './use-serial-task.js'
import WordListEditor from './WordListEditor.jsx'

// Where the child is: home, school, a meal… That place's naming words then come first on the board,
// other places' naming words leave it, and core words, actions, feelings and the body stay everywhere.
export default function EnvironmentTab({ symbols, byKey, activeProfile, preferences, setPreferences, setError, setWorking }) {
  const [status, setStatus] = useState('')
  const [busy, run] = useSerialTask(setError, setWorking)
  const realistic = preferences.realisticImages !== false
  const lists = preferences.environmentLists
  const current = environmentById(preferences.environment)
  const naming = symbols.filter(s => FRINGE_CATEGORIES.includes(s.category))
  async function update(patch, done) {
    const result = await run(() => setPreferences(patch))
    if (result === 'done') setStatus(done)
  }
  const choose = id => update({ environment: id }, id === 'all' ? 'Ikibaho cyerekana amashusho yose y’umwana.' : `Amashusho ya «${environmentById(id).rw}» aza mbere ku kibaho.`)
  const setWords = keys => update({ environmentLists: { ...lists, [current.id]: keys } }, `Amashusho ya «${current.rw}» yabitswe.`)
  function reset() {
    const { [current.id]: _, ...rest } = lists
    update({ environmentLists: rest }, `Amashusho ya «${current.rw}» yasubiye uko yari ameze.`)
  }
  return <section aria-label="Aho umwana ari">
    <Heading eyebrow={`Aho umwana ari · ${activeProfile?.code ?? 'Igerageza'}`} title="Amashusho ajyanye n’aho umwana ari.">Hitamo aho umwana ari ubu. Ikibaho kigaragaza abantu, ibiryo, ibintu, ahantu, imyenda n’inyamaswa bijyanye n’aho hantu gusa. Amashusho y’aho hantu aza mbere ku kibaho, akurikirwa n’amagambo y’ingenzi, ibikorwa, uko yumva, umubiri n’ibibazo, biguma hose.</Heading>
    <div className="word-list-choices">
      <button type="button" className={`word-list-choice ${!current ? 'active' : ''}`} aria-pressed={!current} disabled={busy} onClick={() => choose('all')}>
        <b>Ahantu hose</b><small>Amashusho yose</small>
      </button>
      {ENVIRONMENTS.map(place => <button key={place.id} type="button" className={`word-list-choice ${current?.id === place.id ? 'active' : ''}`}
        aria-pressed={current?.id === place.id} disabled={busy} onClick={() => choose(place.id)}>
        {byKey[place.symbol] && <SymbolArtwork symbol={byKey[place.symbol]} realistic={realistic} />}
        <b>{place.rw}</b><small>Amashusho {environmentWords(place.id, lists).filter(key => byKey[key]).length}</small>
      </button>)}
    </div>
    <p className="dash-save-note" role="status">{status || 'Ibyo uhisemo bibikwa kuri uyu mwirondoro.'}</p>
    {current && <>
      <div className="word-list-heading"><h2>Amashusho ya «{current.rw}»: {environmentWords(current.id, lists).filter(key => byKey[key]).length}</h2>
        {Object.hasOwn(lists, current.id) && <button type="button" className="dash-text-button" onClick={reset} disabled={busy}>Garura uko byari bimeze</button>}</div>
      <WordListEditor label={current.rw} keys={environmentWords(current.id, lists)} symbols={naming} byKey={byKey} realistic={realistic}
        max={MAX_ENVIRONMENT_WORDS} busy={busy} onChange={setWords} />
    </>}
  </section>
}
