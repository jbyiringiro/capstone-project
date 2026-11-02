import { useEffect, useRef, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER } from '../symbols/categories.js'
import { preparePicture } from '../symbols/picture.js'
import { addCustomSymbol, deleteCustomSymbol } from '../storage/custom-symbols.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import { Heading } from './components.jsx'
import { useRecordedKeys } from './use-recorded-keys.js'
import { useSerialTask } from './use-serial-task.js'
import './custom-words.css'

// FR3: a caregiver photographs a person, thing or place from the child's life, names it in
// Kinyarwanda and records it in a familiar voice. The word then behaves like any bundled word.
export default function CustomWordsTab({ catalogue, activeProfile, setError, setWorking, onNavigate, onVocabularyChanged }) {
  const [label, setLabel] = useState(''), [category, setCategory] = useState('people')
  const [picture, setPicture] = useState(null), [preparing, setPreparing] = useState(false)
  const [formError, setFormError] = useState(''), [saved, setSaved] = useState(null), [status, setStatus] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [saving, runSave] = useSerialTask(setFormError, setWorking)
  const [deleting, runDelete] = useSerialTask(setError, setWorking)
  const recorded = useRecordedKeys(cause => setError(userError(cause)))
  const fileInput = useRef(null)
  const custom = catalogue.custom
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url) }, [picture])

  async function choosePicture(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFormError(''); setPreparing(true)
    try {
      const blob = await preparePicture(file)
      setPicture({ blob, url: URL.createObjectURL(blob) })
    } catch (cause) { setFormError(userError(cause, 'Iyi foto ntifunguka. Gerageza indi foto.')) }
    finally { setPreparing(false) }
  }

  async function save(event) {
    event.preventDefault()
    setSaved(null); setStatus('')
    await runSave(async () => {
      const word = await addCustomSymbol({ label, category, image: picture?.blob },
        { existingLabels: catalogue.bundledLabels, profileId: activeProfile?.profile_id })
      await onVocabularyChanged()
      setSaved(word); setLabel(''); setPicture(null)
    })
  }

  async function remove(symbol) {
    const result = await runDelete(async () => { await deleteCustomSymbol(symbol.symbol_id); await onVocabularyChanged() })
    setConfirming(null)
    if (result === 'done') { setStatus(`Ijambo “${symbol.label_rw}” ryasibwe.`); if (saved?.symbol_id === symbol.symbol_id) setSaved(null) }
  }

  const busy = saving || deleting || preparing
  return <section className="custom-words" aria-label="Amagambo mashya">
    <Heading eyebrow={`Amagambo mashya · ${activeProfile?.code ?? 'Igerageza'}`} title="Ongeraho amagambo y’ubuzima bw’umwana.">Fata ifoto y’umuntu, ikintu cyangwa ahantu umwana azi, uyihe izina mu Kinyarwanda. Amagambo mashya aguma kuri iki gikoresho gusa: ntiyoherezwa kuri seriveri.</Heading>
    <form className="dash-card custom-word-form" onSubmit={save}>
      <h2>Ijambo rishya</h2>
      <div className="custom-word-picture">
        <span className="custom-word-preview" aria-hidden="true">{picture && <img src={picture.url} alt="" />}</span>
        <div>
          <button type="button" className="button-outline" onClick={() => fileInput.current?.click()} disabled={busy}>{preparing ? 'Ifoto iri gutegurwa…' : picture ? 'Hindura ifoto' : 'Fata ifoto cyangwa uhitemo ishusho'}</button>
          <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden aria-label="Ifoto y’ijambo" onChange={choosePicture} />
          <small>Ifoto ikatwa ikaba kare, kugira ngo ingane n’andi mashusho. Ntushyire ku ifoto amazina yanditse cyangwa andi makuru bwite atari ngombwa.</small>
        </div>
      </div>
      <label className="dash-field">Izina ry’ijambo<input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} required disabled={busy} autoComplete="off" placeholder="nyogokuru" /><small>Uko umwana n’umuryango we babyita, urugero: nyogokuru.</small></label>
      <label className="dash-field">Icyiciro<select value={category} onChange={e => setCategory(e.target.value)} disabled={busy}>{CATEGORY_ORDER.map(key => <option key={key} value={key}>{CATEGORIES[key].rw}</option>)}</select></label>
      {formError && <p className="dash-form-error" role="alert">{formError}</p>}
      <div className="dash-form-actions"><button className="button-primary" disabled={busy}>{saving ? 'Birimo kubikwa…' : 'Bika ijambo'}</button></div>
      {saved && <div className="custom-word-saved" role="status"><p>Ijambo “{saved.label_rw}” ryongewe ku kibaho mu cyiciro cy’{CATEGORIES[saved.category].rw}. Ongeraho ijwi ryaryo kugira ngo Vuga irivuge.</p><button type="button" className="button-outline" onClick={() => onNavigate('audio', { key: saved.symbol_id })}>Fata ijwi ryaryo</button></div>}
    </form>

    <div className="dash-section-title"><h2>Amagambo mashya: {custom.length}</h2><span>Kuri iki gikoresho</span></div>
    {status && <p className="dash-save-note" role="status">{status}</p>}
    {!custom.length ? <p className="dash-support">Nturongeraho ijambo rishya. Amagambo wongeraho agaragara ku kibaho mu cyiciro wahisemo.</p>
      : <div className="custom-word-list">{custom.map(symbol => <article key={symbol.symbol_id} className="custom-word-item">
        <SymbolArtwork symbol={symbol} />
        <div className="custom-word-copy"><b>{symbol.label_rw}</b><small>{CATEGORIES[symbol.category]?.rw} · {recorded?.has(symbol.symbol_id) ? 'Rifite ijwi' : 'Nta jwi rirabikwa'}</small></div>
        {confirming === symbol.symbol_id ? <div className="custom-word-confirm"><p>Gusiba “{symbol.label_rw}”? Rizavanwa ku kibaho cy’abana bose kuri iki gikoresho, hamwe n’ijwi ryaryo.</p>
          <button type="button" className="button-outline audio-delete" onClick={() => remove(symbol)} disabled={busy}>Siba ijambo</button><button type="button" className="button-outline" onClick={() => setConfirming(null)} disabled={busy}>Gumana ijambo</button></div>
          : <div className="custom-word-actions"><button type="button" className="button-outline" onClick={() => onNavigate('audio', { key: symbol.symbol_id })} disabled={busy} aria-label={`Fata ijwi rya ${symbol.label_rw}`}>Fata ijwi</button><button type="button" className="dash-text-button" onClick={() => setConfirming(symbol.symbol_id)} disabled={busy} aria-label={`Siba ${symbol.label_rw}`}>Siba</button></div>}
      </article>)}</div>}
  </section>
}
