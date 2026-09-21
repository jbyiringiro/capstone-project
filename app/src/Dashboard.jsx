import { useEffect, useState } from 'react'
import { api, getToken } from './api.js'
import { db, syncPending } from './db.js'
import { API_BASE } from './api.js'

// Teacher / caregiver area (FR1, FR2, FR7, FR8): login, pseudonymous profiles, enabled vocabulary,
// explicit Sync (only when online), and the summary that keeps selection frequency apart from
// all-action tap totals.
export default function Dashboard({ onClose, onSelectProfile, activeProfile, mode, setMode }) {
  const [authed, setAuthed] = useState(false)
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [code, setCode] = useState('')
  const [symbols, setSymbols] = useState([])
  const [enabled, setEnabled] = useState(new Set())
  const [summary, setSummary] = useState(null)
  const [syncMsg, setSyncMsg] = useState(null)
  const [pending, setPending] = useState(0)

  useEffect(() => { getToken().then(t => setAuthed(!!t)) }, [])
  useEffect(() => { if (authed) refresh() }, [authed])
  useEffect(() => { db.messages.where('synced').equals(0).and(m => m.spoken_at).count().then(setPending) }, [syncMsg, authed])

  async function refresh() {
    try {
      setProfiles(await api.profiles()); setSymbols(await api.symbols())
      if (activeProfile) { setEnabled(new Set((await api.vocabulary(activeProfile.profile_id)).map(s => s.symbol_id))); setSummary(await api.summary(activeProfile.profile_id)) }
    } catch (e) { setError(String(e.message)) }
  }
  async function login(e) { e.preventDefault(); setError(null); try { await api.login(phone, password); setAuthed(true) } catch (err) { setError('Login failed') } }
  async function register(e) { e.preventDefault(); setError(null); try { await api.register(name, phone, password); await api.login(phone, password); setAuthed(true) } catch (err) { setError(String(err.message)) } }
  async function createProfile(e) { e.preventDefault(); try { await api.createProfile(code); setCode(''); refresh() } catch (err) { setError(String(err.message)) } }
  async function toggle(id) {
    const next = new Set(enabled); next.has(id) ? next.delete(id) : next.add(id); setEnabled(next)
    await api.setVocabulary(activeProfile.profile_id, [...next])
    await db.vocabulary.where('profile_id').equals(activeProfile.profile_id).delete()
    await db.vocabulary.bulkPut(symbols.filter(s => next.has(s.symbol_id)).map(s => ({ profile_id: activeProfile.profile_id, key: s.key })))
  }
  async function sync() {
    setSyncMsg(null)
    if (!navigator.onLine) { setSyncMsg('Offline: nothing uploaded'); return }
    try { const r = await syncPending(API_BASE, await getToken()); setSyncMsg(`Uploaded ${r.accepted_messages ?? 0} messages (${r.duplicates ?? 0} duplicates)`); refresh() }
    catch (e) { setSyncMsg(`Sync failed: ${e.message}`) }
  }

  if (!authed) return (
    <div className="dash">
      <h2>Umwarimu / Umurezi</h2>
      <form onSubmit={login} className="form">
        <input placeholder="Telefoni" value={phone} onChange={e => setPhone(e.target.value)} />
        <input placeholder="Ijambobanga" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="btn">Injira</button>
      </form>
      <details><summary>Iyandikishe</summary>
        <form onSubmit={register} className="form">
          <input placeholder="Izina" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn">Iyandikishe (teacher)</button>
        </form>
      </details>
      {error && <p className="err">{error}</p>}
      <button className="btn" onClick={onClose}>Subira ku kibaho</button>
    </div>
  )

  return (
    <div className="dash">
      <div className="row"><h2>Dashboard</h2><button className="btn" onClick={onClose}>Subira ku kibaho</button></div>
      {error && <p className="err">{error}</p>}
      <section>
        <h3>Abana (pseudonymous codes)</h3>
        <div className="row wrap">
          {profiles.map(p => <button key={p.profile_id} className={`tab ${activeProfile?.profile_id === p.profile_id ? 'on' : ''}`} onClick={() => { onSelectProfile(p); setSummary(null); setTimeout(refresh, 0) }}>{p.code}</button>)}
        </div>
        <form onSubmit={createProfile} className="row"><input placeholder="P-01" value={code} onChange={e => setCode(e.target.value.toUpperCase())} /><button className="btn">Ongeraho</button></form>
      </section>
      <section>
        <h3>Uburyo bw'ikibaho</h3>
        <label><input type="radio" checked={mode === 'static'} onChange={() => setMode('static')} /> static</label>{' '}
        <label><input type="radio" checked={mode === 'predictive'} onChange={() => setMode('predictive')} /> predictive</label>
      </section>
      <section>
        <h3>Sync</h3>
        <p>{pending} ubutumwa butarohererezwa. {navigator.onLine ? 'Online' : 'Offline'}</p>
        <button className="btn" onClick={sync} disabled={!navigator.onLine}>Ohereza ubu</button>
        {syncMsg && <p>{syncMsg}</p>}
      </section>
      {activeProfile && (
        <>
          <section>
            <h3>Amashusho yemewe kuri {activeProfile.code} ({enabled.size})</h3>
            <div className="symgrid">
              {symbols.map(s => <label key={s.symbol_id} className={enabled.has(s.symbol_id) ? 'on' : ''}><input type="checkbox" checked={enabled.has(s.symbol_id)} onChange={() => toggle(s.symbol_id)} /> {s.label_rw}</label>)}
            </div>
          </section>
          {summary && (
            <section>
              <h3>Incamake</h3>
              <table><thead><tr><th>Board mode</th><th>Messages</th><th>Taps / message (all actions)</th><th>Seconds / message</th></tr></thead>
                <tbody>{Object.entries(summary.by_board_mode).map(([m, v]) => <tr key={m}><td>{m}</td><td>{v.messages}</td><td>{v.taps_per_message.toFixed(2)}</td><td>{v.seconds_per_message.toFixed(1)}</td></tr>)}</tbody></table>
              <h4>Symbol selections (frequency, selections only)</h4>
              <ol>{Object.entries(summary.symbol_frequency).slice(0, 20).map(([k, n]) => <li key={k}>{k}: {n}</li>)}</ol>
            </section>
          )}
        </>
      )}
    </div>
  )
}
