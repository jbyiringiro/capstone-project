import { useEffect, useRef, useState } from 'react'
import { PROFILE_CODE, PROFILE_NAME_MAX, createLocalProfile, deleteProfile, getProfiles, prepareProfileEdit, updateProfile } from '../storage/profiles.js'
import { getVocabulary } from '../storage/vocabulary.js'
import { api, getToken } from '../server/api-client.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { localizedError, userError } from '../shared/errors-rw.js'
import { Heading, clearValidation, requiredName } from './components.jsx'

const AGE_BANDS = ['4-6', '7-9', '10-12', '13+']
const SIGN_IN_FIRST = 'Uyu mwirondoro uri no kuri seriveri: banza winjire kuri konti yawe muri «Ohereza», ufite interineti.'

// A child kept on the server is changed or deleted there first, with the signed-in account; a
// refusal leaves this device as it was.
async function serverReady(profile) {
  if (profile.local_only !== false) return false
  if (globalThis.navigator?.onLine === false || !(await getToken())) throw localizedError(SIGN_IN_FIRST)
  return true
}

export default function ChildrenTab({ symbols, byKey, activeProfile, onSelect, onProfilesChanged, setError, working, onNavigate, preferences }) {
  const [profiles, setProfiles] = useState(null), [enabledCount, setEnabledCount] = useState(null)
  const [code, setCode] = useState(''), [age, setAge] = useState('')
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState(''), [status, setStatus] = useState('')
  // The child being edited (null while adding one) and the child the caregiver may delete.
  const [editing, setEditing] = useState(null), [deleting, setDeleting] = useState(null)
  const dialog = useRef(null), codeInput = useRef(null), confirm = useRef(null), keep = useRef(null)
  useEffect(() => { let current = true; getProfiles().then(rows => { if (current) setProfiles(rows) }).catch(e => setError(userError(e))); return () => { current = false } }, [])
  useEffect(() => {
    let current = true; setEnabledCount(null)
    const task = activeProfile ? getVocabulary(activeProfile.profile_id) : Promise.resolve(null)
    task.then(keys => { if (current) setEnabledCount(keys?.length ?? symbols.length) }).catch(e => setError(userError(e)))
    return () => { current = false }
  }, [activeProfile, symbols])
  function openForm(profile = null) {
    setEditing(profile); setCode(profile?.code ?? ''); setAge(profile?.age_band ?? ''); setFormError(''); setStatus('')
    dialog.current.showModal(); codeInput.current?.focus()
  }
  function openDelete(profile) { setDeleting(profile); setFormError(''); setStatus(''); confirm.current.showModal(); keep.current?.focus() }
  // The confirmation opens on Reka, so Enter or a slip of the finger keeps the child; on first
  // opening its buttons appear only once the child is set.
  useEffect(() => { if (deleting && confirm.current?.open) keep.current?.focus() }, [deleting])
  // The list and the open child are read again, so the board and every tab show the change.
  async function refresh() { setProfiles(await getProfiles()); await onProfilesChanged?.() }
  async function act(event, task) {
    event?.preventDefault(); if (busy) return; setBusy(true); setFormError(''); setError('')
    try { await task() } catch (e) { setFormError(userError(e)) } finally { setBusy(false) }
  }
  const save = event => act(event, async () => {
    if (!editing) {
      const profile = await createLocalProfile(code, age || null); setProfiles(await getProfiles()); dialog.current.close(); await onSelect(profile)
      return
    }
    const changes = { code, age_band: age || null }
    const next = await prepareProfileEdit(editing.profile_id, changes)
    if (await serverReady(editing)) await api.updateProfile(editing.profile_id, { code: next.code, age_band: next.age_band })
    await updateProfile(editing.profile_id, changes)
    dialog.current.close()
    await refresh()
    setStatus(next.code === editing.code ? `Umwirondoro wa ${next.code} wahinduwe.` : `Umwirondoro wa ${editing.code} ubu witwa ${next.code}. Amashusho, igenamiterere n’ubutumwa byawo byagumyeho.`)
  })
  const remove = event => act(event, async () => {
    let serverNote = ''
    if (await serverReady(deleting)) {
      // Already gone from this account on the server: only this device still has the child.
      try { await api.deleteProfile(deleting.profile_id) } catch (e) { if (e.status !== 404) throw e; serverNote = ' Kuri seriveri nta mwirondoro wabonetse kuri iyi konti.' }
    }
    const wasOpen = await deleteProfile(deleting.profile_id)
    confirm.current.close()
    await refresh()
    setStatus(`Umwirondoro wa ${deleting.code} wasibwe.${serverNote}${wasOpen ? ' Ikibaho cy’igerageza ni cyo gikoreshwa ubu.' : ''}`)
    setDeleting(null)
  })
  const coded = editing && PROFILE_CODE.test(editing.code)
  const ages = age && !AGE_BANDS.includes(age) ? [age, ...AGE_BANDS] : AGE_BANDS
  return <>
    <Heading eyebrow="Ikibaho kibereye umwana" title="Buri mwana afite icyo avuga.">Hitamo umwirondoro w’umwana, umushyirireho amashusho amufasha kuvuga ibyo akeneye.</Heading>
    <div className="dash-stats"><div><span><b>{profiles ? `Imyirondoro: ${profiles.length}` : 'Birimo gupakira…'}</b><small>Bibitswe kuri iki gikoresho</small></span></div><div><span><b>{enabledCount === null ? 'Birimo gupakira…' : `Amashusho: ${enabledCount}`}</b><small>Ku kibaho kiri gukoreshwa</small></span></div><div><span><b>{activeProfile?.code ?? 'Igerageza'}</b><small>Ikibaho kiri gukoreshwa</small></span></div></div>
    <div className="dash-section-title"><h2>Hitamo umwirondoro</h2><span>Izina cyangwa kode ya buri mwana</span></div>
    {status && <p className="dash-notice" role="status">{status}</p>}
    <div className="dash-profile-grid">{profiles?.map(p => <div key={p.profile_id} className="dash-profile-item">
      <button className={`dash-profile-card ${activeProfile?.profile_id === p.profile_id ? 'current' : ''}`} onClick={() => onSelect(p)} disabled={working || busy} aria-pressed={activeProfile?.profile_id === p.profile_id}>
        {activeProfile?.profile_id === p.profile_id && <span className="dash-current-badge">Uri gukoreshwa</span>}<h3>{p.code}</h3><p>Ikibaho cy’umwana cyo kuvugiraho</p><small>{p.local_only ? 'Kuri iki gikoresho' : 'Umwirondoro uri kuri seriveri'}{p.age_band ? ` · Imyaka: ${p.age_band}` : ''}</small></button>
      <div className="dash-profile-actions">
        <button type="button" className="button-outline" onClick={() => openForm(p)} disabled={working || busy} aria-label={`Hindura umwirondoro wa ${p.code}`}>Hindura</button>
        <button type="button" className="button-outline dash-danger" onClick={() => openDelete(p)} disabled={working || busy} aria-label={`Siba umwirondoro wa ${p.code}`}>Siba</button>
      </div>
    </div>)}
      <button className="dash-add-profile" onClick={() => openForm()} disabled={working || profiles === null}><b>Ongeramo umwirondoro</b><small>Aho umwana avugira ibyo akeneye</small></button></div>
    {profiles?.length === 0 && <p className="dash-support">Nta mwirondoro urimo. Gerageza ikibaho cy’igerageza cyangwa wongeremo umwirondoro.</p>}
    <button className="dash-demo-button" onClick={() => onSelect(null)} disabled={working} aria-pressed={!activeProfile}>Koresha ikibaho cy’igerageza <small>Amashusho yose · {activeProfile ? 'Gerageza nta mwirondoro' : 'Ni cyo cyatoranyijwe'}</small></button>
    <div className="dash-two dash-intro-cards"><section className="dash-card"><h2>Tangira ku magambo umwana amenyereye.</h2><p>Hitanyemo amashusho umwana yumva. Tangira kuri make, wongereho andi igihe bikenewe.</p><div className="dash-mini-board">{['I', 'WATER', 'HELP', 'YES'].filter(key => byKey[key]).map(key => <span key={key}><SymbolArtwork symbol={byKey[key]} realistic={preferences.realisticImages} /></span>)}</div><button className="dash-text-button" onClick={() => onNavigate('vocab')}>Hitamo amashusho</button></section><section className="dash-card"><h2>Ijwi umwana amenyereye.</h2><p>Kuvuga bisaba amajwi y’Ikinyarwanda yabitswe cyangwa ijwi ry’Ikinyarwanda riri kuri iki gikoresho. Ubutumwa bw’amashusho bushobora kwerekanwa igihe cyose.</p><button className="dash-text-button" onClick={() => onNavigate('board')}>Hindura ikibaho</button></section></div>
    <dialog ref={dialog} className="dash-profile-dialog" aria-labelledby="profile-form-title" onCancel={event => { if (busy) event.preventDefault() }}><button className="dash-dialog-close" onClick={() => dialog.current.close()} disabled={busy} aria-label={editing ? 'Funga aho uhindurira umwirondoro' : 'Funga aho wongerera umwirondoro'}>×</button><p className="dash-eyebrow">Aho umwana avugira ibyo akeneye</p><h2 id="profile-form-title">{editing ? 'Hindura umwirondoro' : 'Ongeramo umwirondoro'}</h2>
      <p>{editing ? `Amashusho, igenamiterere, ubutumwa n’amajwi bya ${editing.code} biguma ari ibye.${coded ? ' Umwana ufite kode ahindurirwa kode gusa, kuko ari yo ibikwa kuri konti yawe.' : ''}` : 'Andika izina umwana amenyereye cyangwa kode. Ntushyiremo andi makuru bwite nk’itariki y’amavuko.'}</p><form onSubmit={save}>
      <label className="dash-field">{coded ? 'Kode y’umwana' : 'Izina cyangwa kode y’umwana'}<input ref={codeInput} value={code} onChange={e => setCode(e.target.value)} onInvalid={requiredName} onInput={clearValidation} placeholder={coded ? 'P-02' : 'Keza cyangwa P-01'} maxLength={PROFILE_NAME_MAX} required disabled={busy} autoComplete="off" /><small>Inyuguti ntizirenge {PROFILE_NAME_MAX}. Izina riguma kuri iki gikoresho gusa; ntiryoherezwa kuri seriveri. Umwana ufite kode nka P-01 ni we ubikwa no kuri konti yawe.</small></label>
      <label className="dash-field">Icyiciro cy’imyaka <span>(si ngombwa)</span><select value={age} onChange={e => setAge(e.target.value)} disabled={busy}><option value="">Nticyagaragajwe</option>{ages.map(band => <option key={band}>{band}</option>)}</select></label>{formError && <p className="dash-form-error" role="alert">{formError}</p>}
      <div className="dash-dialog-actions"><button type="button" className="button-outline" onClick={() => dialog.current.close()} disabled={busy}>Reka</button><button className="button-primary" disabled={busy || working}>{busy ? 'Birimo kubikwa…' : editing ? 'Bika impinduka' : 'Bika umwirondoro'}</button></div></form></dialog>
    <dialog ref={confirm} className="dash-profile-dialog" aria-labelledby="profile-delete-title" onCancel={event => { if (busy) event.preventDefault() }} onClose={() => { if (!busy) setFormError('') }}>
      {deleting && <><p className="dash-eyebrow">Gusiba umwirondoro</p><h2 id="profile-delete-title">Gusiba umwirondoro wa {deleting.code}?</h2>
        <p>Bisiba kuri iki gikoresho umwirondoro wa {deleting.code}, amashusho yamutoranyirijwe, igenamiterere ry’ikibaho cye n’uburyo bw’umwana, ubutumwa bwe n’ibyo yakanze (n’ubutaroherezwa), n’amanota y’imikino ye.</p>
        <p>Ibiguma: abandi bana n’ibyabo, amagambo mashya n’amajwi wafashe, kuko abana bose babisangira.{deleting.local_only === false ? ' Uyu mwirondoro uri no kuri seriveri: na ho urasibwa, hamwe n’ubutumwa bwoherejwe; bisaba interineti no kuba winjiye kuri konti.' : PROFILE_CODE.test(deleting.code) ? ' Niba iki gikoresho kibika kuri konti yawe, uyu mwana azavanwa no kuri konti, kandi ntazagaruka ku bindi bikoresho.' : ''} Ntibishobora gusubizwa inyuma.</p>
        {formError && <p className="dash-form-error" role="alert">{formError}</p>}
        <form onSubmit={remove} className="dash-dialog-actions"><button ref={keep} type="button" className="button-outline" onClick={() => confirm.current.close()} disabled={busy}>Reka</button><button className="button-primary dash-danger" disabled={busy || working}>{busy ? 'Birimo gusiba…' : `Siba ${deleting.code} burundu`}</button></form></>}
    </dialog>
  </>
}
