import { useEffect, useRef, useState } from 'react'
import { API_BASE, api, getToken } from './api.js'
import { CATEGORIES, CATEGORY_ORDER } from './categories.js'
import { createLocalProfile, db, exportLocalData, getLocalSummary, getProfiles, getVocabulary, setVocabulary, syncPending } from './db.js'
import { Brand, Icon, SymbolArtwork } from './ui.jsx'
import VoiceSettings from './VoiceSettings.jsx'
import AudioSettings from './AudioSettings.jsx'
import { ParentPinSettings } from './ParentAccess.jsx'
import { userError } from './errors-rw.js'
import './dashboard.css'

const TABS = [
  { id: 'children', rw: 'Abana', icon: 'people' },
  { id: 'vocab', rw: 'Amashusho', icon: 'more' },
  { id: 'board', rw: 'Ikibaho', icon: 'settings' },
  { id: 'audio', rw: 'Ijwi', icon: 'speaker' },
  { id: 'summary', rw: 'Incamake', icon: 'leaf' },
  { id: 'sync', rw: 'Ohereza', icon: 'offline' },
  { id: 'access', rw: 'Kwinjira', icon: 'settings' }
]
const DEFAULT_APPEARANCE = { motion: true, largeTiles: false, realisticImages: true }
const clearValidation = event => event.currentTarget.setCustomValidity('')
const requiredCode = event => event.currentTarget.setCustomValidity('Andika inyuguti imwe, akanyerezo n’imibare ibiri cyangwa itatu, urugero: P-01.')
function Heading({ eyebrow, title, children, art = false }) {
  return <div className="dash-heading"><div><p className="dash-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></div>{art && <Icon name="leaf" size={64} />}</div>
}

export default function Dashboard({ symbols, byKey, onClose, onSelectProfile, activeProfile, mode, setMode, onVocabularySaved, predictor, bench, runBench, appearance = DEFAULT_APPEARANCE, setAppearance, initialTab = 'children' }) {
  const [tab, setTab] = useState(initialTab)
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState(''), [working, setWorking] = useState(false)
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  async function select(profile) {
    setWorking(true); setError('')
    try { await onSelectProfile(profile); if (profile) setTab('vocab') }
    catch (e) { setError(userError(e)) }
    finally { setWorking(false) }
  }
  function navigate(next) { setTab(next); setError('') }
  return <div className={`dash ${appearance.motion ? '' : 'dash-still'}`}>
    <header className="app-header dash-header"><Brand onClick={onClose} disabled={working} />
      <div className="app-title"><b>Umubyeyi / Umurezi</b><small>Dufashe buri mwana kuvuga icyo ashaka.</small></div>
      <div className="header-actions"><span className="dash-device-status"><i />{activeProfile?.code ?? 'Igerageza'} · {online ? 'Interineti irahari' : 'Nta interineti'}</span><button className="button-outline" onClick={onClose} disabled={working}><Icon name="back" size={18} />Subira ku kibaho</button></div>
    </header>
    <div className="dash-layout"><aside className="dash-sidebar"><p className="dash-eyebrow">Ahagenewe umurezi</p>
      <nav aria-label="Ibyiciro by’umurezi">{TABS.map(t => <button key={t.id} className={`dash-nav-button ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} disabled={working} onClick={() => navigate(t.id)}><Icon name={t.icon} size={22} /><span>{t.rw}</span></button>)}</nav>
      <div className="dash-device-note"><Icon name="offline" size={25} /><b>Ikibaho umwana amenyereye, aho ari hose.</b><p>Imyirondoro n’amashusho bibikwa kuri iki gikoresho. Konti si ngombwa.</p></div>
    </aside><main className="dash-main" aria-label={TABS.find(t => t.id === tab)?.rw}>
      {error && <div className="dash-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Funga ubutumwa bw’ikibazo">×</button></div>}
      {tab === 'children' && <Children symbols={symbols} byKey={byKey} activeProfile={activeProfile} onSelect={select} setError={setError} working={working} onNavigate={navigate} appearance={appearance} />}
      {tab === 'vocab' && <Vocabulary symbols={symbols} activeProfile={activeProfile} setError={setError} setWorking={setWorking} onSaved={onVocabularySaved} onNavigate={navigate} appearance={appearance} />}
      {tab === 'board' && <BoardSettings mode={mode} setMode={setMode} predictor={predictor} bench={bench} runBench={runBench} setError={setError} setWorking={setWorking} activeProfile={activeProfile} appearance={appearance} setAppearance={setAppearance} onClose={onClose} />}
      {tab === 'audio' && <><Heading eyebrow="Ijwi" title="Ha amashusho ijwi.">Gerageza amajwi cyangwa wongeremo amajwi y’Ikinyarwanda umwana amenyereye.</Heading><VoiceSettings /><AudioSettings symbols={symbols} appearance={appearance} /></>}
      {tab === 'summary' && <Summary activeProfile={activeProfile} byKey={byKey} setError={setError} onClose={onClose} />}
      {tab === 'sync' && <><Heading eyebrow="Ohereza" title="Ni wowe uhitamo uko amakuru akoreshwa.">Ubutumwa buguma kuri iki gikoresho kugeza igihe uhisemo kubukuramo cyangwa kohereza ubwa konti yawe kuri seriveri.</Heading><Sync online={online} setError={setError} /></>}
      {tab === 'access' && <ParentPinSettings />}
    </main></div>
    <footer className="dash-footer"><p><b>Bibitswe kuri iki gikoresho.</b> Gusiba amakuru ya mushakisha bisiba ibibitswe kuri iki gikoresho. Banza ukuremo ubutumwa mbere yo guhindura igikoresho.</p><p>Porogaramu y’igerageza · Ururimi, amashusho n’amajwi biracyakeneye gusuzumwa n’abazabikoresha. Amafoto yaturutse kuri interineti kandi afite uruhushya rwo gukoreshwa. Abantu bari ku mafoto si abana bakoresha Vuga. Hitamo amashusho umwana yumva kandi amenyereye. <a href="/photos/credits.html" target="_blank" rel="noreferrer">Abafashe amafoto n’uburenganzira bwo kuyakoresha</a>.</p><p>Ibishushanyo bisanzwe ushobora guhitamo: Sergio Palao / Government of Aragon, <a href="https://arasaac.org" target="_blank" rel="noreferrer">ARASAAC</a>, <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>. <a href="/symbols/ATTRIBUTION.txt">Abakoze amashusho</a>.</p></footer>
  </div>
}

function Children({ symbols, byKey, activeProfile, onSelect, setError, working, onNavigate, appearance }) {
  const [profiles, setProfiles] = useState(null), [enabledCount, setEnabledCount] = useState(null)
  const [code, setCode] = useState(''), [age, setAge] = useState('')
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState('')
  const dialog = useRef(null), codeInput = useRef(null)
  useEffect(() => { let current = true; getProfiles().then(rows => { if (current) setProfiles(rows) }).catch(e => setError(userError(e))); return () => { current = false } }, [])
  useEffect(() => {
    let current = true; setEnabledCount(null)
    const task = activeProfile ? getVocabulary(activeProfile.profile_id) : Promise.resolve(null)
    task.then(keys => { if (current) setEnabledCount(keys?.length ?? symbols.length) }).catch(e => setError(userError(e)))
    return () => { current = false }
  }, [activeProfile, symbols])
  function openForm() { setCode(''); setAge(''); setFormError(''); dialog.current.showModal(); codeInput.current?.focus() }
  async function create(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setFormError(''); setError('')
    try { const profile = await createLocalProfile(code, age || null); setProfiles(await getProfiles()); dialog.current.close(); await onSelect(profile) }
    catch (e) { setFormError(userError(e)) } finally { setBusy(false) }
  }
  return <>
    <Heading eyebrow="Ikibaho kibereye umwana" title="Buri mwana afite icyo avuga." art>Hitamo umwirondoro w’umwana, umushyirireho amashusho amufasha kuvuga ibyo akeneye.</Heading>
    <div className="dash-stats"><div><Icon name="people" size={35} /><span><b>{profiles ? `Imyirondoro: ${profiles.length}` : 'Birimo gupakira…'}</b><small>Bibitswe kuri iki gikoresho</small></span></div><div><Icon name="more" size={35} /><span><b>{enabledCount === null ? 'Birimo gupakira…' : `Amashusho: ${enabledCount}`}</b><small>Ku kibaho kiri gukoreshwa</small></span></div><div><Icon name="offline" size={35} /><span><b>{activeProfile?.code ?? 'Igerageza'}</b><small>Ikibaho kiri gukoreshwa</small></span></div></div>
    <div className="dash-section-title"><h2>Hitamo umwirondoro</h2><span>Koresha kode z’abana gusa</span></div>
    <div className="dash-profile-grid">{profiles?.map((p, index) => <button key={p.profile_id} className={`dash-profile-card ${activeProfile?.profile_id === p.profile_id ? 'current' : ''}`} onClick={() => onSelect(p)} disabled={working} aria-pressed={activeProfile?.profile_id === p.profile_id}>
      {activeProfile?.profile_id === p.profile_id && <span className="dash-current-badge">Uri gukoreshwa</span>}<span className={`dash-avatar ${index % 2 ? 'sunny' : ''}`}><Icon name={index % 2 ? 'happy' : 'leaf'} size={28} /></span><h3>{p.code}</h3><p>Ikibaho cy’umwana cyo kuvugiraho</p><small>{p.local_only ? 'Kuri iki gikoresho' : 'Umwirondoro uri kuri seriveri'}{p.age_band ? ` · Imyaka: ${p.age_band}` : ''}</small></button>)}
      <button className="dash-add-profile" onClick={openForm} disabled={working || profiles === null}><span aria-hidden="true">+</span><b>Ongeramo umwirondoro</b><small>Aho umwana avugira ibyo akeneye</small></button></div>
    {profiles?.length === 0 && <p className="dash-support">Nta mwirondoro urimo. Gerageza ikibaho cy’igerageza cyangwa wongeremo umwirondoro.</p>}
    <button className="dash-demo-button" onClick={() => onSelect(null)} disabled={working} aria-pressed={!activeProfile}><Icon name="more" size={20} />Koresha ikibaho cy’igerageza <small>Amashusho yose · {activeProfile ? 'Gerageza nta mwirondoro' : 'Ni cyo cyatoranyijwe'}</small></button>
    <div className="dash-two dash-intro-cards"><section className="dash-card"><h2>Tangira ku magambo umwana amenyereye.</h2><p>Hitanyemo amashusho umwana yumva. Tangira kuri make, wongereho andi igihe bikenewe.</p><div className="dash-mini-board">{['I', 'WATER', 'HELP', 'YES'].filter(key => byKey[key]).map(key => <span key={key}><SymbolArtwork symbol={byKey[key]} realistic={appearance.realisticImages} /></span>)}</div><button className="dash-text-button" onClick={() => onNavigate('vocab')}>Hitamo amashusho <span aria-hidden="true">→</span></button></section><section className="dash-card dash-warm-card"><Icon name="speaker" size={31} /><h2>Ijwi umwana amenyereye.</h2><p>Kuvuga bisaba amajwi y’Ikinyarwanda yabitswe cyangwa ijwi ry’Ikinyarwanda riri kuri iki gikoresho. Ubutumwa bw’amashusho bushobora kwerekanwa igihe cyose.</p><button className="dash-text-button" onClick={() => onNavigate('board')}>Hindura ikibaho <span aria-hidden="true">→</span></button></section></div>
    <dialog ref={dialog} className="dash-profile-dialog" aria-labelledby="new-profile-title" onCancel={event => { if (busy) event.preventDefault() }}><button className="dash-dialog-close" onClick={() => dialog.current.close()} disabled={busy} aria-label="Funga aho wongerera umwirondoro">×</button><p className="dash-eyebrow">Aho umwana avugira ibyo akeneye</p><h2 id="new-profile-title">Ongeramo umwirondoro</h2><p>Koresha kode y’umwana. Ntushyire amazina n’andi makuru bwite ku kibaho.</p><form onSubmit={create}>
      <label className="dash-field">Kode y’umwana<input ref={codeInput} value={code} onChange={e => setCode(e.target.value)} onInvalid={requiredCode} onInput={clearValidation} placeholder="P-01" maxLength={5} pattern="[A-Za-z]-[0-9]{2,3}" required disabled={busy} autoComplete="off" /><small>Inyuguti imwe, akanyerezo n’imibare ibiri cyangwa itatu, urugero: P-01.</small></label>
      <label className="dash-field">Icyiciro cy’imyaka <span>(si ngombwa)</span><select value={age} onChange={e => setAge(e.target.value)} disabled={busy}><option value="">Nticyagaragajwe</option><option>4-6</option><option>7-9</option><option>10-12</option><option>13+</option></select></label>{formError && <p className="dash-form-error" role="alert">{formError}</p>}
      <div className="dash-dialog-actions"><button type="button" className="button-outline" onClick={() => dialog.current.close()} disabled={busy}>Reka</button><button className="button-primary" disabled={busy || working}>{busy ? 'Birimo kubikwa…' : 'Bika umwirondoro'} <span aria-hidden="true">→</span></button></div></form></dialog>
  </>
}

function Vocabulary({ symbols, activeProfile, setError, setWorking, onSaved, onNavigate, appearance }) {
  const [enabled, setEnabled] = useState(null), [filter, setFilter] = useState(''), [categoryFilter, setCategoryFilter] = useState('all')
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const saving = useRef(false)
  useEffect(() => { let current = true; setEnabled(null); setStatus(''); setFilter(''); setCategoryFilter('all'); if (activeProfile) getVocabulary(activeProfile.profile_id).then(keys => { if (current) setEnabled(new Set(keys ?? symbols.map(s => s.symbol_id))) }).catch(e => setError(userError(e))); return () => { current = false } }, [activeProfile, symbols])
  async function save(next) {
    if (saving.current) return
    saving.current = true; setBusy(true); setWorking(true); setError(''); setStatus('Birimo kubikwa…')
    try { await setVocabulary(activeProfile.profile_id, [...next]); setEnabled(next); await onSaved([...next]); setStatus('Bibitswe kuri iki gikoresho') }
    catch (e) { setError(userError(e)); setStatus('Impinduka ntizashoboye kubikwa') } finally { saving.current = false; setBusy(false); setWorking(false) }
  }
  const toggle = key => { const next = new Set(enabled); next.has(key) ? next.delete(key) : next.add(key); save(next) }
  const category = (cat, on) => { const next = new Set(enabled); symbols.filter(s => s.category === cat).forEach(s => on ? next.add(s.symbol_id) : next.delete(s.symbol_id)); save(next) }
  const query = filter.trim().toLowerCase(), matches = s => !query || (s.label_rw ?? '').toLowerCase().includes(query)
  return <><Heading eyebrow={`Amashusho · ${activeProfile?.code ?? 'Igerageza'}`} title="Amagambo umwana akenera buri munsi.">Hitamo amashusho akwiriye iki kibaho. Harimo ayo guhitamo, kwanga, gusaba ubufasha no kuganira buri munsi.</Heading>
    {!activeProfile ? <div className="dash-empty"><Icon name="more" size={60} /><h2>Banza uhitemo umwirondoro</h2><p>Ikibaho cy’igerageza kirimo amashusho yose. Ongeramo cyangwa uhitemo umwirondoro kugira ngo uwuhitiremo amashusho.</p><button className="button-outline" onClick={() => onNavigate('children')}>Hitamo umwirondoro</button></div> : !enabled ? <p role="status">Amashusho arimo gupakira…</p> : <>
      <div className="dash-vocabulary-toolbar"><label className="dash-search"><Icon name="eye" size={22} /><input type="search" aria-label="Shakisha amashusho" placeholder="Shakisha ishusho…" value={filter} onChange={e => setFilter(e.target.value)} /></label><div><button className="dash-text-button" onClick={() => save(new Set(symbols.map(s => s.symbol_id)))} disabled={busy}>Hitamo yose</button><button className="dash-text-button" onClick={() => save(new Set())} disabled={busy}>Kuraho yose</button></div></div>
      <div className="dash-category-filters" aria-label="Hitamo icyiciro cy’amashusho"><button className={categoryFilter === 'all' ? 'active' : ''} aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>Amashusho yose</button>{CATEGORY_ORDER.filter(cat => symbols.some(s => s.category === cat)).map(cat => <button key={cat} className={categoryFilter === cat ? 'active' : ''} aria-pressed={categoryFilter === cat} onClick={() => setCategoryFilter(cat)}>{CATEGORIES[cat].rw}</button>)}</div>
      <div className="dash-section-title"><h2>Amashusho yatoranyijwe: {enabled.size}</h2><span>Ahari yose: {symbols.length}</span></div><p className="dash-save-note" role="status"><Icon name="yes" size={17} />{status || 'Impinduka zihita zibikwa kuri iki gikoresho.'}</p>{!enabled.size && <p className="dash-notice">Uyu mwirondoro nta mashusho watoranyirijwe. Toranya nibura rimwe kugira ngo umwana abashe gutegura ubutumwa.</p>}
      {CATEGORY_ORDER.filter(cat => categoryFilter === 'all' || categoryFilter === cat).map(cat => {
        const items = symbols.filter(s => s.category === cat && matches(s)); if (!items.length) return null; const meta = CATEGORIES[cat]
        return <section className="dash-vocab-category" key={cat}><div className="dash-category-heading"><h3><Icon name={meta.icon} size={23} />{meta.rw}</h3><div><button className="dash-text-button" aria-label={`Hitamo yose mu cyiciro ${meta.rw}`} onClick={() => category(cat, true)} disabled={busy}>Yose</button><button className="dash-text-button" aria-label={`Kuraho yose mu cyiciro ${meta.rw}`} onClick={() => category(cat, false)} disabled={busy}>Nta na rimwe</button></div></div>
          <div className="dash-vocab-grid">{items.map(s => <label key={s.symbol_id} className={`dash-vocab-tile ${enabled.has(s.symbol_id) ? 'enabled' : ''}`}><input type="checkbox" checked={enabled.has(s.symbol_id)} onChange={() => toggle(s.symbol_id)} disabled={busy} aria-label={`Hitamo ${s.label_rw}`} /><SymbolArtwork symbol={s} realistic={appearance.realisticImages} /><b>{s.label_rw}</b></label>)}</div></section>
      })}
      {!symbols.some(s => (categoryFilter === 'all' || s.category === categoryFilter) && matches(s)) && <p className="dash-support">Nta mashusho abonetse. Gerageza irindi jambo cyangwa ikindi cyiciro.</p>}
    </>}</>
}

function Setting({ id, icon, title, children, checked, disabled, onChange }) {
  return <div className="dash-setting"><span className="dash-setting-icon"><Icon name={icon} size={25} /></span><div className="dash-setting-copy"><b id={`${id}-label`}>{title}</b><p id={`${id}-description`}>{children}</p></div><label className="dash-switch"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} /><span /></label></div>
}
function BoardSettings({ mode, setMode, predictor, bench, runBench, setError, setWorking, activeProfile, appearance, setAppearance, onClose }) {
  const [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [status, setStatus] = useState('')
  const changing = useRef(false)
  async function change(task) {
    if (changing.current) return; changing.current = true; setBusy(true); setWorking(true); setError(''); setStatus('Birimo kubikwa…')
    try { await task(); setStatus('Ibyatoranyijwe byabitswe kuri iki gikoresho') } catch (e) { setError(userError(e)); setStatus('Ibyatoranyijwe ntibyashoboye kubikwa') } finally { changing.current = false; setBusy(false); setWorking(false) }
  }
  const update = patch => change(() => setAppearance(patch))
  async function benchmark() { setRunning(true); setError(''); try { await runBench() } catch (e) { setError(userError(e)) } finally { setRunning(false) } }
  return <><Heading eyebrow={`Ikibaho · ${activeProfile?.code ?? 'Igerageza'}`} title="Ikibaho cyorohereza umwana kuvuga.">Hitamo uko ikibaho kigaragara kugira ngo cyorohere umwana kureba no gukoraho. Hindura ikintu kimwe icyarimwe, mugeragereze hamwe.</Heading>
    <div className="dash-settings-card"><Setting id="word-suggestions" icon="leaf" title="Amagambo afasha" checked={mode === 'predictive'} disabled={busy || (!predictor && mode !== 'predictive')} onChange={checked => change(() => setMode(checked ? 'predictive' : 'static'))}>Amagambo atatu afasha umwana agaragara hejuru y’ikibaho. Amashusho asanzwe aguma mu myanya yayo. Guhindura ibi bitangira ubutumwa bushya. {!predictor && 'Uburyo bwo gutanga amagambo afasha ntiburaboneka.'}</Setting>
      <Setting id="gentle-motion" icon="play" title="Amashusho anyeganyega buhoro" checked={appearance.motion} disabled={busy} onChange={motion => update({ motion })}>Kunyeganyega gake kw’ishusho byerekana ko yatoranyijwe. Bihagarike niba ushaka ikibaho kidanyeganyega.</Setting>
      <Setting id="large-tiles" icon="more" title="Amashusho manini cyane" checked={appearance.largeTiles} disabled={busy} onChange={largeTiles => update({ largeTiles })}>Shyira amashusho make kandi manini kuri buri murongo, kugira ngo yorohe kureba no gukoraho.</Setting>
      <Setting id="realistic-images" icon="eye" title="Amafoto afatika" checked={appearance.realisticImages} disabled={busy} onChange={realisticImages => update({ realisticImages })}>Koresha amafoto yo kuri interineti afite uruhushya rwo gukoreshwa. Bihagarike kugira ngo ukoreshe ibishushanyo bisanzwe. Murebere hamwe niba umwana ayumva.</Setting></div>
    <p className="dash-save-note" role="status">{status || 'Uko ikibaho kigaragara bibikwa kuri uyu mwirondoro. Niba igikoresho cyashyizweho kutanyeganyeza amashusho, hano na ho ntanyeganyega.'}</p>
    <div className="dash-audio-note"><Icon name="speaker" size={35} /><div><h2>Koresha ijwi umwana amenyereye.</h2><p>Kuvuga bisaba amajwi y’Ikinyarwanda yagenzuwe cyangwa ijwi ry’Ikinyarwanda riri kuri iki gikoresho. Kanda Erekana kugira ngo werekane ubutumwa nta jwi.</p></div></div>
    <details className="dash-benchmark"><summary>Umuvuduko wo gutanga amagambo afasha</summary><p>Pima igihe porogaramu imara itanga igisubizo. Iyi mibare ntipima iterambere ry’umwana mu kuvuga.</p><button className="button-outline" onClick={benchmark} disabled={!predictor || running}>{running ? 'Birimo gupimwa…' : 'Pima umuvuduko'}</button>{bench && !bench.error && <p role="status">Agaciro ko hagati <b>{bench.median_ms} ms</b> · 95 ku ijana by’ibisubizo biri munsi ya <b>{bench.p95_ms} ms</b><br /><small>Ibipimo {bench.n} · Byapimwe kuri iki gikoresho</small></p>}{bench?.error && <p role="status">{userError(bench.error)}</p>}</details>
    <div className="dash-bottom-actions"><span>Gerageza ikibaho nyuma ya buri mpinduka.</span><button className="button-primary" onClick={onClose} disabled={busy}><Icon name="back" size={18} />Subira ku kibaho</button></div>
  </>
}

function Login({ onDone, setError }) {
  const [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState('')
  const [registering, setRegistering] = useState(false), [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { if (registering) await api.register(name, phone, password); await api.login(phone, password); await onDone() }
    catch { setError('Kwinjira ntibyashobotse. Reba ko seriveri iboneka kandi amakuru ya konti ari yo. Ushobora gukomeza gukoresha ibiri kuri iki gikoresho.') }
    finally { setBusy(false) }
  }
  return <form className="card" onSubmit={submit}>
    <h2>{registering ? 'Iyandikishe' : 'Injira'}<small>Konti yo kuri seriveri si ngombwa</small></h2>
    <p className="muted">Injira kugira ngo ubone imyirondoro ya konti yawe kandi wohereze ubutumwa bwayo bwarangiye.</p>
    {registering && <label>Izina <small>Izina ry’umuntu mukuru</small><input value={name} onChange={e => setName(e.target.value)} onInvalid={e => e.currentTarget.setCustomValidity('Andika izina ry’umuntu mukuru.')} onInput={clearValidation} autoComplete="name" required /></label>}
    <label>Telefoni <input value={phone} onChange={e => setPhone(e.target.value)} onInvalid={e => e.currentTarget.setCustomValidity('Andika nimero ya telefoni yawe.')} onInput={clearValidation} inputMode="tel" autoComplete="username" required /></label>
    <label>Ijambobanga <small>Nibura inyuguti cyangwa ibimenyetso 6</small><input type="password" value={password} onChange={e => setPassword(e.target.value)} onInvalid={e => e.currentTarget.setCustomValidity('Andika ijambobanga rifite nibura inyuguti cyangwa ibimenyetso 6.')} onInput={clearValidation} autoComplete={registering ? 'new-password' : 'current-password'} minLength={6} required /></label>
    <button className="primary" disabled={busy}>{busy ? 'Birimo guhuza…' : registering ? 'Fungura konti' : 'Injira'}</button>
    <button type="button" className="ghost" disabled={busy} onClick={() => setRegistering(!registering)}>{registering ? 'Mfite konti' : 'Fungura konti y’umuntu mukuru'}</button>
  </form>
}

function Sync({ online, setError }) {
  const [authed, setAuthed] = useState(false)
  const [pending, setPending] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverCode, setServerCode] = useState('')
  useEffect(() => { getToken().then(token => setAuthed(!!token)).catch(e => setError(userError(e))); count() }, [])
  const count = () => db.messages.where('synced').equals(0).and(m => !!m.spoken_at).count().then(setPending).catch(e => setError(userError(e)))
  async function importProfiles() {
    const profiles = await api.profiles()
    for (const profile of profiles) {
      if (await getVocabulary(profile.profile_id) === null) {
        const vocabulary = await api.vocabulary(profile.profile_id)
        await setVocabulary(profile.profile_id, vocabulary.map(symbol => symbol.key))
      }
    }
    await db.profiles.bulkPut(profiles.map(profile => ({ ...profile, local_only: false })))
    setMessage(`Imyirondoro ${profiles.length} ya seriveri iraboneka mu gice cy’Abana. Amashusho yari yaratoranyijwe kuri iki gikoresho yagumishijweho.`)
  }
  async function fetchProfiles() {
    setBusy(true); setError('')
    try {
      await importProfiles()
    } catch (e) { setError(userError(e)) }
    finally { setBusy(false) }
  }
  async function createServerProfile(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api.createProfile(serverCode.trim().toUpperCase(), null); setServerCode(''); await importProfiles() }
    catch (e) { setError(userError(e)) }
    finally { setBusy(false) }
  }
  async function upload() {
    setBusy(true); setError('')
    try {
      const result = await syncPending(API_BASE, await getToken())
      setMessage(result.skipped ? 'Nta interineti: nta butumwa bwoherejwe.' : `Ubutumwa bwoherejwe: ${result.accepted_messages ?? 0}; ubwabanje kwakirwa: ${result.duplicates ?? 0}; ubwagumye kuri iki gikoresho: ${result.skipped_local ?? 0}.${result.remaining ? ` Haracyasigaye ubutumwa ${result.remaining} bwo kohereza; ongera ukande Ohereza ubu.` : ''}`)
      await count()
    } catch (e) { setError(userError(e)) }
    finally { setBusy(false) }
  }
  async function download() {
    try {
      const data = await exportLocalData()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `vuga-ubutumwa-${new Date().toISOString().slice(0, 10)}.json`
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Ubutumwa bwakuwe kuri iki gikoresho. Bika neza dosiye wabonye.')
    } catch (e) { setError(userError(e)) }
  }
  return <div className="two">
    <div className="card">
      <h2>Amakuru yo kuri iki gikoresho</h2>
      <p className="big">{pending}<small>ubutumwa bwarangiye butaroherezwa</small></p>
      <p className="muted">Imyirondoro y’igerageza n’iyakozwe kuri iki gikoresho biguma hano. Iyo ukanze kohereza, hoherezwa gusa ubutumwa bw’imyirondoro yo kuri seriveri iri muri konti winjiyemo.</p>
      <button className="primary" onClick={upload} disabled={!online || !authed || busy || !pending}>Ohereza ubu</button>
      <button className="ghost" onClick={download} disabled={busy}>Kuramo ubutumwa bwo kuri iki gikoresho</button>
      <p className="muted">Dosiye ikubiyemo kode z’abana n’ibikorwa byo gutegura ubutumwa. Nta magambobanga cyangwa amajwi yafashwe birimo.</p>
      {message && <p role="status">{message}</p>}
    </div>
    {!authed ? <Login setError={setError} onDone={async () => { setAuthed(true); await fetchProfiles() }} /> : <div className="card">
      <h2>Konti yo kuri seriveri<small>Winjiye kuri iki gikoresho</small></h2>
      <button className="ghost" disabled={busy || !online} onClick={fetchProfiles}>Zana imyirondoro ya konti yanjye</button>
      <button className="ghost" disabled={busy} onClick={async () => { try { await api.logout(); setAuthed(false) } catch (e) { setError(userError(e)) } }}>Sohoka</button>
      <form onSubmit={createServerProfile}>
        <label>Kora umwirondoro kuri seriveri<small>Kode y’umwana gusa; iyi kode yoherezwa kuri konti yawe yo kuri seriveri.</small><input value={serverCode} onChange={e => setServerCode(e.target.value)} onInvalid={requiredCode} onInput={clearValidation} placeholder="P-01" maxLength={5} pattern="[A-Za-z]-[0-9]{2,3}" required /></label>
        <button className="primary" disabled={busy || !online}>Bika umwirondoro kuri seriveri</button>
      </form>
    </div>}
  </div>
}

function Summary({ activeProfile, byKey, setError, onClose }) {
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let current = true
    setSummary(null)
    getLocalSummary(activeProfile?.profile_id ?? 'demo').then(value => { if (current) setSummary(value) }).catch(e => setError(userError(e)))
    return () => { current = false }
  }, [activeProfile])
  if (!summary) return <p role="status">Incamake irimo gupakira…</p>
  const modes = Object.entries(summary.by_board_mode)
  const frequency = Object.entries(summary.symbol_frequency).sort((a, b) => b[1] - a[1])
  const max = frequency[0]?.[1] ?? 1
  return <>
    <Heading eyebrow={`Incamake · ${activeProfile?.code ?? 'Igerageza'}`} title="Reba ubutumwa bw’umwana.">Incamake y’ubutumwa bwarangije kuvugwa kuri iki gikoresho. Nta manota cyangwa intego zihabwa umwana, kandi nta kugereranya abana.</Heading>
    {!modes.length ? <div className="dash-empty"><Icon name="leaf" size={62} /><h2>Buri kiganiro kigira aho gitangirira.</h2><p>Nta butumwa burarangiza kuvugwa. Kwerekana ubutumwa bw’amashusho na byo ni uburyo bwo kuganira; ntibibarwa nk’ubutumwa bwavuzwe.</p><button className="button-outline" onClick={onClose}><Icon name="back" size={18} />Subira ku kibaho</button></div> : <div className="two">
    <div className="card">
      <h2>Ubutumwa bwarangiye · {activeProfile?.code ?? 'Igerageza'}<small>Ubutumwa bwarangije kuvugwa bukabikwa kuri iki gikoresho. Gukanda bibarirwamo guhindura ibyiciro, gukosora no gukanda Vuga.</small></h2>
      {!modes.length ? <p className="muted">Nta butumwa burarangiza kuvugwa. Ubwerekanwe nta jwi ntibubarwa nk’ubwavuzwe.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Uburyo</th><th>Ubutumwa</th><th>Gukanda kuri buri butumwa</th><th>Amasegonda kuri buri butumwa</th></tr></thead>
        <tbody>{modes.map(([mode, values]) => <tr key={mode}><td>{mode === 'predictive' ? 'Amagambo afasha' : mode === 'static' ? 'Ikibaho gisanzwe' : 'Uburyo butazwi'}</td><td>{values.messages}</td><td>{values.taps_per_message.toFixed(2)}</td><td>{values.seconds_per_message.toFixed(1)}</td></tr>)}</tbody>
      </table></div>}
      <p className="muted">Iyi mibare ntigaragaza ubushobozi bw’umwana bwo kuvuga cyangwa impinduka mu buzima bwe.</p>
    </div>
    <div className="card">
      <h2>Amashusho akunze gukoreshwa<small>Amashusho yatoranyijwe mu butumwa bwarangiye, harimo n’ayaje gukosorwa</small></h2>
      {!frequency.length && <p className="muted">Amashusho yakoreshejwe azagaragara ubutumwa bumaze kuvugwa.</p>}
      {frequency.slice(0, 15).map(([key, n]) => <div className="bar" key={key}><span>{byKey[key]?.label_rw ?? 'Ijambo ritazwi'}</span><i style={{ width: `${n / max * 100}%` }} /><b>{n}</b></div>)}
    </div>
    </div>}
    <p className="dash-summary-note">Iyi mibare ntipima ubushobozi bw’umwana, iterambere rye mu kuvuga cyangwa impinduka mu buzima bwe. Ubutumwa bwerekanwe nta jwi ntibubarwa nk’ubwavuzwe.</p>
  </>
}
