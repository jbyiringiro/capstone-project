import { useEffect, useState } from 'react'
import { CHILD_PRESETS, MAX_CHILD_BOARD, presetById } from '../child/child-boards.js'
import { gameProgress, listGameSessions } from '../storage/game-sessions.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import { Heading, Setting } from './components.jsx'
import { useSerialTask } from './use-serial-task.js'
import './child-mode.css'

const GAME_LENGTHS = [5, 10]

// Child mode is set up entirely here: which pictures the child sees, and when to play the game.
export default function ChildModeTab({ symbols, byKey, activeProfile, preferences, setPreferences, setError, setWorking, onStartGame }) {
  const [status, setStatus] = useState(''), [query, setQuery] = useState('')
  const [rounds, setRounds] = useState(5), [progress, setProgress] = useState(null)
  const [busy, run] = useSerialTask(setError, setWorking)
  const profileId = activeProfile?.profile_id ?? 'demo'
  const board = preferences.childBoard.filter(key => byKey[key])
  const realistic = preferences.realisticImages !== false
  const full = board.length >= MAX_CHILD_BOARD

  useEffect(() => {
    let current = true
    listGameSessions(profileId).then(sessions => { if (current) setProgress(gameProgress(sessions)) }).catch(e => setError(userError(e)))
    return () => { current = false }
  }, [profileId])

  async function update(patch, done = 'Byabitswe kuri uyu mwirondoro.') {
    const result = await run(() => setPreferences(patch))
    if (result === 'done') setStatus(done)
  }
  const choosePreset = preset => update({ childPreset: preset.id, childBoard: [...preset.keys] }, `Ikibaho “${preset.rw}” cyatoranyijwe.`)
  const remove = key => board.length > 1 && update({ childPreset: 'custom', childBoard: board.filter(k => k !== key) })
  async function add(key) {
    if (full || board.includes(key)) return
    await update({ childPreset: 'custom', childBoard: [...board, key] })
    setQuery('')
  }
  const filter = query.trim().toLocaleLowerCase()
  const choices = filter ? symbols.filter(s => s.label_rw.toLocaleLowerCase().includes(filter) && !board.includes(s.symbol_id)).slice(0, 24) : []

  return <section className="child-mode" aria-label="Uburyo bw’umwana">
    <Heading eyebrow={`Uburyo bw’umwana · ${activeProfile?.code ?? 'Igerageza'}`} title="Ikibaho cyoroshye n’umukino.">Umwana abona amashusho wahisemo gusa. Iyo akanze ku ishusho, Vuga ihita ivuga ijambo ryayo. Ni wowe uhitamo amashusho, ukanatangiza umukino.</Heading>
    <div className="dash-settings-card">
      <Setting id="child-mode" title="Uburyo bw’umwana" checked={preferences.childMode} disabled={busy}
        onChange={childMode => update({ childMode }, childMode ? 'Uburyo bw’umwana burafunguye. Subira ku kibaho urebe uko umwana abibona.' : 'Ikibaho cyuzuye cyagarutse.')}>
        Ikibaho cy’umwana kigaragaza amashusho kugeza kuri {MAX_CHILD_BOARD} gusa, nta byiciro, nta butumwa bwo gutegura. Bihagarike kugira ngo usubire ku kibaho cyuzuye.
      </Setting>
    </div>
    <p className="dash-save-note" role="status">{status || 'Ibyo uhisemo bibikwa kuri uyu mwirondoro.'}</p>

    <div className="dash-section-title"><h2>Ibibaho biteguye</h2><span>Hitamo kimwe, ushobora kugihindura nyuma</span></div>
    <div className="child-presets">{CHILD_PRESETS.map(preset => <button key={preset.id} type="button" disabled={busy}
      className={`child-preset ${preferences.childPreset === preset.id ? 'active' : ''}`} aria-pressed={preferences.childPreset === preset.id} onClick={() => choosePreset(preset)}>
      <span className="child-preset-pictures">{preset.keys.slice(0, 4).filter(key => byKey[key]).map(key => <SymbolArtwork key={key} symbol={byKey[key]} realistic={realistic} />)}</span>
      <b>{preset.rw}</b><small>Amashusho {preset.keys.length}</small>
    </button>)}</div>

    <div className="dash-section-title"><h2>Amashusho umwana abona: {board.length}</h2><span>{preferences.childPreset === 'custom' ? 'Ayo wahisemo' : presetById(preferences.childPreset)?.rw}</span></div>
    <div className="child-chosen">{board.map(key => <div key={key} className="child-chosen-item">
      <SymbolArtwork symbol={byKey[key]} realistic={realistic} /><b>{byKey[key].label_rw}</b>
      <button type="button" className="child-chosen-remove" onClick={() => remove(key)} disabled={busy || board.length <= 1} aria-label={`Kuraho ${byKey[key].label_rw}`}>×</button>
    </div>)}</div>
    <label className="dash-search child-add-search"><input type="search" value={query} onChange={e => setQuery(e.target.value)}
      placeholder={full ? `Wageze ku mashusho ${MAX_CHILD_BOARD}` : 'Shakisha ishusho wongeraho…'} aria-label="Shakisha ishusho wongeraho" disabled={full || busy} /></label>
    {choices.length > 0 && <div className="child-add-results">{choices.map(s => <button key={s.symbol_id} type="button" onClick={() => add(s.symbol_id)} disabled={busy}>
      <SymbolArtwork symbol={s} realistic={realistic} /><span>{s.label_rw}</span><span aria-hidden="true">+</span>
    </button>)}</div>}

    <div className="dash-card child-game-card">
      <h2>Umukino wo gushakisha amashusho</h2>
      <p>Vuga ivuga ijambo, umwana agashakisha ishusho yaryo ku kibaho cye. Bimufasha kumenya aho buri shusho iri. Ishusho abonye imuhesha inyenyeri. Umukino ntubarwa nk’ubutumwa.</p>
      <div className="child-game-start">
        <span>Inshuro:</span>{GAME_LENGTHS.map(n => <button key={n} type="button" className={rounds === n ? 'active' : ''} aria-pressed={rounds === n} onClick={() => setRounds(n)}>{n}</button>)}
        <button type="button" className="button-primary" disabled={busy || board.length < 2} onClick={() => onStartGame(rounds)}>Tangiza umukino</button>
      </div>
      {board.length < 2 && <p className="dash-notice">Umukino ukenera nibura amashusho abiri.</p>}
    </div>

    <div className="dash-card child-progress-card">
      <h2>Iterambere mu mukino</h2>
      {!progress ? <p role="status">Birimo gupakira…</p> : !progress.games.length ? <p className="muted">Nta mukino urakinwa kuri uyu mwirondoro.</p> : <>
        <p>Inyenyeri zose: <b>{progress.totalStars}</b></p>
        <div className="table-scroll"><table><thead><tr><th>Itariki</th><th>Inyenyeri</th><th>Ku nshuro ya mbere</th><th>Ubufasha</th></tr></thead>
          <tbody>{progress.games.map(game => <tr key={game.finished_at}><td>{new Date(game.finished_at).toLocaleDateString('rw-RW')}</td><td>{game.stars}</td><td>{game.firstTry}</td><td>{game.hints}</td></tr>)}</tbody></table></div>
        {progress.practice.length > 0 && <p>Amagambo akeneye imyitozo: {progress.practice.map(p => byKey[p.key]?.label_rw ?? p.key).join(', ')}</p>}
      </>}
      <p className="muted">Iyi mibare yerekana aho umwana amenyereye amashusho, si ubushobozi bwe bwo kuvuga.</p>
    </div>
  </section>
}
