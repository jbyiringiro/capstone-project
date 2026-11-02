import { useState } from 'react'
import { MAX_RELATED, RELATED_WORDS, relatedTriggers, relatedWords } from '../symbols/related-words.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { Heading, Setting } from './components.jsx'
import { useSerialTask } from './use-serial-task.js'
import WordListEditor from './WordListEditor.jsx'

// Next words after a picture: tapping "kunywa" opens amazi, amata, umutobe, igikombe… on the board.
// The caregiver turns this on for one child and decides which pictures follow which.
export default function RelatedWordsTab({ symbols, byKey, activeProfile, preferences, setPreferences, setError, setWorking }) {
  const [status, setStatus] = useState('')
  const [chosen, setChosen] = useState('DRINK')
  const [query, setQuery] = useState('')
  const [busy, run] = useSerialTask(setError, setWorking)
  const realistic = preferences.realisticImages !== false
  const lists = preferences.relatedLists
  const triggers = relatedTriggers(lists).filter(key => byKey[key])
  const count = key => relatedWords(key, lists).filter(next => byKey[next]).length
  const filter = query.trim().toLocaleLowerCase()
  const newTriggers = filter ? symbols.filter(s => s.label_rw.toLocaleLowerCase().includes(filter) && !triggers.includes(s.symbol_id)).slice(0, 12) : []
  async function update(patch, done) {
    const result = await run(() => setPreferences(patch))
    if (result === 'done') setStatus(done)
    return result
  }
  const setWords = keys => update({ relatedLists: { ...lists, [chosen]: keys } }, `Amashusho akurikira «${byKey[chosen].label_rw}» yabitswe.`)
  async function addTrigger(key) {
    if (await update({ relatedLists: { ...lists, [key]: [] } }, `Ongeraho amashusho akurikira «${byKey[key].label_rw}».`) === 'done') {
      setChosen(key)
      setQuery('')
    }
  }
  function reset() {
    const { [chosen]: _, ...rest } = lists
    const custom = !RELATED_WORDS[chosen]
    update({ relatedLists: rest }, custom ? `Amashusho akurikira «${byKey[chosen].label_rw}» yakuweho.` : `Amashusho akurikira «${byKey[chosen].label_rw}» yasubiye uko yari ameze.`)
    if (custom) setChosen('DRINK')
  }
  return <section aria-label="Amagambo akurikira">
    <Heading eyebrow={`Amagambo akurikira · ${activeProfile?.code ?? 'Igerageza'}`} title="Amashusho akurikira ishusho.">Iyo umwana akanze ku ishusho nka «kunywa», ikibaho gihita kimwereka amashusho akunze kuyikurikira: amazi, amata, umutobe, igikombe… Ahisemo rimwe, asubira aho yari ari. Ni wowe uhitamo ayo mashusho.</Heading>
    <div className="dash-settings-card">
      <Setting id="related-words" title="Erekana amashusho akurikira" checked={preferences.relatedWords} disabled={busy}
        onChange={relatedWords => update({ relatedWords }, relatedWords ? 'Amashusho akurikira arafunguye kuri iki kibaho.' : 'Amashusho akurikira arafunze.')}>
        Bifunguye, ishusho ifite amashusho ayikurikira ifungura urupapuro rwayo ku kibaho, ahantu hamwe buri gihe. Bifunze, umwana ashakira amashusho mu byiciro.
      </Setting>
    </div>
    <p className="dash-save-note" role="status">{status || 'Ibyo uhisemo bibikwa kuri uyu mwirondoro.'}</p>

    <div className="word-list-heading"><h2>Amashusho afite ayakurikira</h2><span className="muted">Hitamo imwe kugira ngo uhindure ayayikurikira</span></div>
    <div className="word-list-choices">{triggers.map(key => <button key={key} type="button" className={`word-list-choice ${chosen === key ? 'active' : ''}`}
      aria-pressed={chosen === key} onClick={() => setChosen(key)}>
      <SymbolArtwork symbol={byKey[key]} realistic={realistic} /><b>{byKey[key].label_rw}</b><small>Amashusho {count(key)}</small>
    </button>)}</div>
    <div className="word-list-add">
      <label className="dash-search"><input type="search" value={query} onChange={e => setQuery(e.target.value)} disabled={busy}
        placeholder="Indi shusho ifite ayayikurikira…" aria-label="Shakisha indi shusho ifite amashusho ayikurikira" /></label>
      {newTriggers.length > 0 && <div className="word-list-results">{newTriggers.map(s => <button key={s.symbol_id} type="button" onClick={() => addTrigger(s.symbol_id)} disabled={busy}>
        <SymbolArtwork symbol={s} realistic={realistic} /><span>{s.label_rw}</span><span aria-hidden="true">+</span>
      </button>)}</div>}
    </div>

    {byKey[chosen] && <>
      <div className="word-list-heading"><h2>Nyuma ya «{byKey[chosen].label_rw}»: {count(chosen)}</h2>
        {Object.hasOwn(lists, chosen) && <button type="button" className="dash-text-button" onClick={reset} disabled={busy}>{RELATED_WORDS[chosen] ? 'Garura uko byari bimeze' : 'Kuraho iyi shusho'}</button>}</div>
      <WordListEditor label={byKey[chosen].label_rw} keys={relatedWords(chosen, lists)} symbols={symbols} byKey={byKey} realistic={realistic}
        max={MAX_RELATED} busy={busy} onChange={setWords} />
    </>}
  </section>
}
