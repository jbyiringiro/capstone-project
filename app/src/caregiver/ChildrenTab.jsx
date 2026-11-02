import { useEffect, useRef, useState } from 'react'
import { PROFILE_NAME_MAX, createLocalProfile, getProfiles } from '../storage/profiles.js'
import { getVocabulary } from '../storage/vocabulary.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import { Heading, clearValidation, requiredName } from './components.jsx'

export default function ChildrenTab({ symbols, byKey, activeProfile, onSelect, setError, working, onNavigate, preferences }) {
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
    <Heading eyebrow="Ikibaho kibereye umwana" title="Buri mwana afite icyo avuga.">Hitamo umwirondoro w’umwana, umushyirireho amashusho amufasha kuvuga ibyo akeneye.</Heading>
    <div className="dash-stats"><div><span><b>{profiles ? `Imyirondoro: ${profiles.length}` : 'Birimo gupakira…'}</b><small>Bibitswe kuri iki gikoresho</small></span></div><div><span><b>{enabledCount === null ? 'Birimo gupakira…' : `Amashusho: ${enabledCount}`}</b><small>Ku kibaho kiri gukoreshwa</small></span></div><div><span><b>{activeProfile?.code ?? 'Igerageza'}</b><small>Ikibaho kiri gukoreshwa</small></span></div></div>
    <div className="dash-section-title"><h2>Hitamo umwirondoro</h2><span>Izina cyangwa kode ya buri mwana</span></div>
    <div className="dash-profile-grid">{profiles?.map((p, index) => <button key={p.profile_id} className={`dash-profile-card ${activeProfile?.profile_id === p.profile_id ? 'current' : ''}`} onClick={() => onSelect(p)} disabled={working} aria-pressed={activeProfile?.profile_id === p.profile_id}>
      {activeProfile?.profile_id === p.profile_id && <span className="dash-current-badge">Uri gukoreshwa</span>}<h3>{p.code}</h3><p>Ikibaho cy’umwana cyo kuvugiraho</p><small>{p.local_only ? 'Kuri iki gikoresho' : 'Umwirondoro uri kuri seriveri'}{p.age_band ? ` · Imyaka: ${p.age_band}` : ''}</small></button>)}
      <button className="dash-add-profile" onClick={openForm} disabled={working || profiles === null}><b>Ongeramo umwirondoro</b><small>Aho umwana avugira ibyo akeneye</small></button></div>
    {profiles?.length === 0 && <p className="dash-support">Nta mwirondoro urimo. Gerageza ikibaho cy’igerageza cyangwa wongeremo umwirondoro.</p>}
    <button className="dash-demo-button" onClick={() => onSelect(null)} disabled={working} aria-pressed={!activeProfile}>Koresha ikibaho cy’igerageza <small>Amashusho yose · {activeProfile ? 'Gerageza nta mwirondoro' : 'Ni cyo cyatoranyijwe'}</small></button>
    <div className="dash-two dash-intro-cards"><section className="dash-card"><h2>Tangira ku magambo umwana amenyereye.</h2><p>Hitanyemo amashusho umwana yumva. Tangira kuri make, wongereho andi igihe bikenewe.</p><div className="dash-mini-board">{['I', 'WATER', 'HELP', 'YES'].filter(key => byKey[key]).map(key => <span key={key}><SymbolArtwork symbol={byKey[key]} realistic={preferences.realisticImages} /></span>)}</div><button className="dash-text-button" onClick={() => onNavigate('vocab')}>Hitamo amashusho</button></section><section className="dash-card"><h2>Ijwi umwana amenyereye.</h2><p>Kuvuga bisaba amajwi y’Ikinyarwanda yabitswe cyangwa ijwi ry’Ikinyarwanda riri kuri iki gikoresho. Ubutumwa bw’amashusho bushobora kwerekanwa igihe cyose.</p><button className="dash-text-button" onClick={() => onNavigate('board')}>Hindura ikibaho</button></section></div>
    <dialog ref={dialog} className="dash-profile-dialog" aria-labelledby="new-profile-title" onCancel={event => { if (busy) event.preventDefault() }}><button className="dash-dialog-close" onClick={() => dialog.current.close()} disabled={busy} aria-label="Funga aho wongerera umwirondoro">×</button><p className="dash-eyebrow">Aho umwana avugira ibyo akeneye</p><h2 id="new-profile-title">Ongeramo umwirondoro</h2><p>Andika izina umwana amenyereye cyangwa kode. Ntushyiremo andi makuru bwite nk’itariki y’amavuko.</p><form onSubmit={create}>
      <label className="dash-field">Izina cyangwa kode y’umwana<input ref={codeInput} value={code} onChange={e => setCode(e.target.value)} onInvalid={requiredName} onInput={clearValidation} placeholder="Keza cyangwa P-01" maxLength={PROFILE_NAME_MAX} required disabled={busy} autoComplete="off" /><small>Inyuguti ntizirenge {PROFILE_NAME_MAX}. Izina riguma kuri iki gikoresho no kuri konti yawe; ntiryoherezwa hamwe n’ubutumwa.</small></label>
      <label className="dash-field">Icyiciro cy’imyaka <span>(si ngombwa)</span><select value={age} onChange={e => setAge(e.target.value)} disabled={busy}><option value="">Nticyagaragajwe</option><option>4-6</option><option>7-9</option><option>10-12</option><option>13+</option></select></label>{formError && <p className="dash-form-error" role="alert">{formError}</p>}
      <div className="dash-dialog-actions"><button type="button" className="button-outline" onClick={() => dialog.current.close()} disabled={busy}>Reka</button><button className="button-primary" disabled={busy || working}>{busy ? 'Birimo kubikwa…' : 'Bika umwirondoro'}</button></div></form></dialog>
  </>
}
