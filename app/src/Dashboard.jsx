import { useEffect, useState } from 'react'
import { API_BASE, api, getToken } from './api.js'
import { CATEGORIES, CATEGORY_ORDER, categoryOf } from './categories.js'
import { db, syncPending } from './db.js'
import { fallbackGlyph } from './emoji.js'

// Adult area (teacher / caregiver): profiles, enabled vocabulary, board mode, sync, summary.
// Kinyarwanda first, English underneath, as in the board.

const TABS = [
  { id: 'children', rw: 'Abana', en: 'Children' },
  { id: 'vocab', rw: 'Amashusho', en: 'Vocabulary' },
  { id: 'board', rw: 'Ikibaho', en: 'Board' },
  { id: 'sync', rw: 'Ohereza', en: 'Sync' },
  { id: 'summary', rw: 'Incamake', en: 'Summary' }
]

export default function Dashboard({ symbols, onClose, onSelectProfile, activeProfile, mode, setMode, predictor, bench, runBench }) {
  const [authed, setAuthed] = useState(null)
  const [tab, setTab] = useState('children')
  const [online, setOnline] = useState(navigator.onLine)
  const [apiOk, setApiOk] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { getToken().then(t => setAuthed(!!t)) }, [])
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    api.health().then(() => setApiOk(true)).catch(() => setApiOk(false))
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  return (
    <div className="dash">
      <header className="dashbar">
        <button className="back" onClick={onClose}>‹ Ikibaho<small>Back to board</small></button>
        <h1>Vuga <span>Umwarimu / Umurezi</span></h1>
        <div className="status">
          <Pill ok={online} text={online ? 'Online' : 'Offline'} />
          <Pill ok={apiOk} text={apiOk === null ? 'API…' : apiOk ? 'API' : 'API ntiboneka'} />
          {activeProfile && <span className="pill profile">{activeProfile.code}</span>}
          <span className={`pill ${mode}`}>{mode}</span>
        </div>
      </header>

      {authed === null ? null : !authed ? (
        <Login onDone={() => setAuthed(true)} setError={setError} error={error} />
      ) : (
        <>
          <nav className="tabs">
            {TABS.map(t => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.rw}<small>{t.en}</small></button>)}
            <button className="logout" onClick={async () => { await api.logout(); setAuthed(false) }}>Sohoka<small>Log out</small></button>
          </nav>
          {error && <p className="err">{error}</p>}
          <section className="panel">
            {tab === 'children' && <Children activeProfile={activeProfile} onSelect={p => { onSelectProfile(p); setTab('vocab') }} setError={setError} />}
            {tab === 'vocab' && <Vocabulary symbols={symbols} activeProfile={activeProfile} setError={setError} />}
            {tab === 'board' && <BoardSettings mode={mode} setMode={setMode} predictor={predictor} bench={bench} runBench={runBench} />}
            {tab === 'sync' && <Sync online={online} setError={setError} />}
            {tab === 'summary' && <Summary activeProfile={activeProfile} setError={setError} />}
          </section>
        </>
      )}
    </div>
  )
}

function Pill({ ok, text }) { return <span className={`pill ${ok === null ? '' : ok ? 'ok' : 'bad'}`}>{text}</span> }

function Login({ onDone, setError, error }) {
  const [phone, setPhone] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('')
  const [registering, setRegistering] = useState(false); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setError(null); setBusy(true)
    try {
      if (registering) await api.register(name, phone, password)
      await api.login(phone, password); onDone()
    } catch (err) { setError(registering ? `Kwiyandikisha byanze: ${err.message}` : 'Telefoni cyangwa ijambobanga si byo · Wrong phone or password') }
    setBusy(false)
  }
  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h2>{registering ? 'Iyandikishe' : 'Injira'}<small>{registering ? 'Create a teacher account' : 'Sign in'}</small></h2>
        {registering && <label>Izina <small>Name</small><input value={name} onChange={e => setName(e.target.value)} required /></label>}
        <label>Telefoni <small>Phone</small><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" required /></label>
        <label>Ijambobanga <small>Password, 6+ characters</small><input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></label>
        {error && <p className="err">{error}</p>}
        <button className="primary" disabled={busy}>{registering ? 'Iyandikishe' : 'Injira'}</button>
        <button type="button" className="ghost" onClick={() => setRegistering(r => !r)}>{registering ? 'Mfite konti · I have an account' : 'Nta konti mfite · Create an account'}</button>
      </form>
    </div>
  )
}

function Children({ activeProfile, onSelect, setError }) {
  const [profiles, setProfiles] = useState([]); const [code, setCode] = useState(''); const [age, setAge] = useState('')
  const load = () => api.profiles().then(setProfiles).catch(e => setError(String(e.message)))
  useEffect(() => { load() }, [])
  async function create(e) {
    e.preventDefault()
    try { const p = await api.createProfile(code.toUpperCase(), age || null); setCode(''); setAge(''); await load(); onSelect(p) }
    catch (err) { setError(/409/.test(err.message) ? 'Iyi kode isanzwe ikoreshwa · Code already used' : 'Kode igomba kuba nka P-01 · Code must look like P-01') }
  }
  return (
    <div className="two">
      <div className="card">
        <h2>Abana<small>Pseudonymous profiles only: no names, no photos</small></h2>
        {profiles.length === 0 && <p className="muted">Nta mwana urashyirwamo. · No profiles yet.</p>}
        <div className="chips">
          {profiles.map(p => (
            <button key={p.profile_id} className={`chipbtn ${activeProfile?.profile_id === p.profile_id ? 'on' : ''}`} onClick={() => onSelect(p)}>
              {p.code}{p.age_band && <small>{p.age_band}</small>}
            </button>
          ))}
        </div>
      </div>
      <form className="card" onSubmit={create}>
        <h2>Ongeraho umwana<small>Add a profile</small></h2>
        <label>Kode <small>e.g. P-01</small><input value={code} onChange={e => setCode(e.target.value)} placeholder="P-01" required /></label>
        <label>Imyaka <small>Age band, optional</small>
          <select value={age} onChange={e => setAge(e.target.value)}><option value="">—</option><option>4-6</option><option>7-9</option><option>10-12</option><option>13+</option></select>
        </label>
        <button className="primary">Ongeraho</button>
      </form>
    </div>
  )
}

function Vocabulary({ symbols, activeProfile, setError }) {
  const [enabled, setEnabled] = useState(null); const [serverIds, setServerIds] = useState({}); const [filter, setFilter] = useState('')
  useEffect(() => {
    if (!activeProfile) return
    api.symbols().then(list => setServerIds(Object.fromEntries(list.map(s => [s.key, s.symbol_id])))).catch(() => {})
    api.vocabulary(activeProfile.profile_id).then(list => setEnabled(new Set(list.map(s => s.key)))).catch(e => setError(String(e.message)))
  }, [activeProfile])
  if (!activeProfile) return <p className="muted">Banza uhitemo umwana muri "Abana". · Choose a child first.</p>
  if (!enabled) return <p className="muted">Birimo gupakira… · Loading…</p>
  async function save(next) {
    setEnabled(next)
    const ids = [...next].map(k => serverIds[k]).filter(Boolean)
    try {
      await api.setVocabulary(activeProfile.profile_id, ids)
      await db.vocabulary.where('profile_id').equals(activeProfile.profile_id).delete()
      await db.vocabulary.bulkPut([...next].map(k => ({ profile_id: activeProfile.profile_id, key: k })))
    } catch (e) { setError(String(e.message)) }
  }
  const toggle = k => { const n = new Set(enabled); n.has(k) ? n.delete(k) : n.add(k); save(n) }
  const setCat = (cat, on) => { const n = new Set(enabled); symbols.filter(s => s.category === cat).forEach(s => on ? n.add(s.symbol_id) : n.delete(s.symbol_id)); save(n) }
  const q = filter.trim().toLowerCase()
  return (
    <div>
      <div className="toolbar">
        <h2>Amashusho ya {activeProfile.code}<small>{enabled.size} / {symbols.length} enabled. Symbols not enabled are hidden on the board and never suggested.</small></h2>
        <input placeholder="Shakisha… · Search" value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="ghost" onClick={() => save(new Set(symbols.map(s => s.symbol_id)))}>Byose</button>
        <button className="ghost" onClick={() => save(new Set())}>Nta na kimwe</button>
      </div>
      {CATEGORY_ORDER.filter(c => c !== 'core').map(cat => {
        const items = symbols.filter(s => s.category === cat && (!q || s.label_rw.includes(q) || s.label_en.includes(q)))
        if (!items.length) return null
        const meta = CATEGORIES[cat]
        return (
          <div className="catblock" key={cat} style={{ '--cat': meta.colour }}>
            <div className="cathead">
              <span>{meta.icon} {meta.rw} <small>{meta.en}</small></span>
              <span><button className="ghost" onClick={() => setCat(cat, true)}>byose</button><button className="ghost" onClick={() => setCat(cat, false)}>ntacyo</button></span>
            </div>
            <div className="symgrid">
              {items.map(s => (
                <label key={s.symbol_id} className={enabled.has(s.symbol_id) ? 'on' : ''}>
                  <input type="checkbox" checked={enabled.has(s.symbol_id)} onChange={() => toggle(s.symbol_id)} />
                  {s.image_path ? <img src={s.image_path} alt="" /> : <span className="glyph">{fallbackGlyph(s)}</span>}
                  <span>{s.label_rw}<small>{s.label_en}</small></span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BoardSettings({ mode, setMode, predictor, bench, runBench }) {
  return (
    <div className="two">
      <div className="card">
        <h2>Uburyo bw'ikibaho<small>Board mode used for the next messages</small></h2>
        <div className="modes">
          <button className={`modebtn ${mode === 'static' ? 'on' : ''}`} onClick={() => setMode('static')}>Static<small>Ibyiciro gusa · categories only</small></button>
          <button className={`modebtn ${mode === 'predictive' ? 'on' : ''}`} onClick={() => setMode('predictive')} disabled={!predictor}>Predictive<small>Ibyifuzo 3 · three suggestions</small></button>
        </div>
        {!predictor && <p className="muted">Nta model iboneka · No prediction model loaded (run export_artifacts.py).</p>}
      </div>
      <div className="card">
        <h2>Umuvuduko<small>Prediction latency on this device</small></h2>
        <button className="ghost" onClick={runBench} disabled={!predictor}>Gerageza · Run benchmark</button>
        {bench && !bench.error && <p>median <b>{bench.median_ms} ms</b>, p95 <b>{bench.p95_ms} ms</b><br /><small>{bench.cores} cores · {bench.memory_gb ?? '?'} GB · {bench.at}</small></p>}
      </div>
    </div>
  )
}

function Sync({ online, setError }) {
  const [pending, setPending] = useState(0); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false)
  const count = () => db.messages.where('synced').equals(0).and(m => m.spoken_at).count().then(setPending)
  useEffect(() => { count() }, [msg])
  async function sync() {
    setBusy(true); setMsg(null)
    try { const r = await syncPending(API_BASE, await getToken()); setMsg(r.skipped ? 'Nta murongo · Offline, nothing uploaded' : `Byoherejwe: ${r.accepted_messages ?? 0} messages (${r.duplicates ?? 0} duplicates)`) }
    catch (e) { setMsg(`Byanze · Failed: ${e.message}`) }
    setBusy(false)
  }
  return (
    <div className="card narrow">
      <h2>Ohereza amakuru<small>Upload finished messages to the server</small></h2>
      <p className="big">{pending}<small>ubutumwa butegereje · messages waiting on this device</small></p>
      <p className="muted">Amakuru yoherezwa gusa iyo ukanze hano kandi hari umurongo. · Data leaves the device only when you press this button while online.</p>
      <button className="primary" onClick={sync} disabled={!online || busy || pending === 0}>{online ? 'Ohereza ubu · Upload now' : 'Nta murongo · Offline'}</button>
      {msg && <p>{msg}</p>}
    </div>
  )
}

function Summary({ activeProfile, setError }) {
  const [s, setS] = useState(null)
  useEffect(() => { if (activeProfile) api.summary(activeProfile.profile_id).then(setS).catch(e => setError(String(e.message))) }, [activeProfile])
  if (!activeProfile) return <p className="muted">Banza uhitemo umwana. · Choose a child first.</p>
  if (!s) return <p className="muted">Birimo gupakira…</p>
  const modes = Object.entries(s.by_board_mode)
  const freq = Object.entries(s.symbol_frequency)
  const max = freq[0]?.[1] ?? 1
  return (
    <div className="two">
      <div className="card">
        <h2>Ubutumwa bwarangiye<small>Completed messages by board mode. Taps count every action, including Speak.</small></h2>
        {modes.length === 0 ? <p className="muted">Nta butumwa buroherezwa. · Nothing synced yet.</p> : (
          <table><thead><tr><th>Mode</th><th>Messages</th><th>Taps / message</th><th>Seconds / message</th></tr></thead>
            <tbody>{modes.map(([m, v]) => <tr key={m}><td><span className={`pill ${m}`}>{m}</span></td><td>{v.messages}</td><td>{v.taps_per_message.toFixed(2)}</td><td>{v.seconds_per_message.toFixed(1)}</td></tr>)}</tbody></table>
        )}
      </div>
      <div className="card">
        <h2>Amashusho akunze gukoreshwa<small>Symbol selections only (navigation and corrections excluded)</small></h2>
        {freq.slice(0, 15).map(([k, n]) => (
          <div className="bar" key={k}><span>{k}</span><i style={{ width: `${(n / max) * 100}%` }} /><b>{n}</b></div>
        ))}
      </div>
    </div>
  )
}
