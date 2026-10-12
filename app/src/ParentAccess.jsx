import { useEffect, useRef, useState } from 'react'
import { Brand, Icon } from './ui.jsx'
import { changeParentPin, getParentAccessStatus, setupParentPin, unlockParentAccess, validParentPin } from './parent-access.js'
import './parent-access.css'

const MESSAGES = {
  format: 'Koresha imibare ine kugeza kuri itandatu gusa.',
  mismatch: 'Imibare wanditse ntihuye. Ongera uyandike.',
  configured: 'Umubare w’ibanga wamaze gushyirwaho. Subira ku kibaho, wongere winjire.',
  changed: 'Umubare w’ibanga wahindutse. Subira ku kibaho, wongere winjire.',
  unconfigured: 'Umubare w’ibanga nturashyirwaho. Subira ku kibaho, wongere winjire.',
  crypto: 'Mushakisha ntishobora kubika umubare w’ibanga. Koresha urubuga rufite HTTPS cyangwa ufungurire porogaramu kuri iki gikoresho.',
  storage: 'Ntibyashobotse gusoma cyangwa kubika umubare w’ibanga. Reba niba mushakisha yemerewe kubika amakuru.'
}
const errorText = error => MESSAGES[error?.code] || MESSAGES.storage

function PinField({ label, value, setValue, autoComplete, disabled, inputRef }) {
  return <label className="parent-pin-field">{label}<input ref={inputRef} type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6}
    value={value} onChange={event => setValue(event.target.value)} autoComplete={autoComplete} disabled={disabled} required
    onInput={event => event.currentTarget.setCustomValidity('')}
    onInvalid={event => event.currentTarget.setCustomValidity(MESSAGES.format)} />
  </label>
}

function usePinForm() {
  const [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [lockedUntil, setLockedUntil] = useState(0), [now, setNow] = useState(Date.now())
  const mounted = useRef(true), submitting = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!lockedUntil) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [lockedUntil])
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))
  function recordResult(result) {
    if (result.ok) return true
    setPin('')
    setLockedUntil(result.retryAfterMs ? Date.now() + result.retryAfterMs : 0)
    setError(result.retryAfterMs ? '' : 'Umubare w’ibanga si wo. Ongera ugerageze.')
    return false
  }
  return { pin, setPin, confirmation, setConfirmation, error, setError, busy, setBusy, remaining, setLockedUntil, mounted, submitting, recordResult }
}

export default function ParentAccess({ onUnlock, onClose }) {
  const [configured, setConfigured] = useState(null), [loadError, setLoadError] = useState('')
  const form = usePinForm(), input = useRef(null)
  useEffect(() => {
    let current = true
    getParentAccessStatus().then(status => {
      if (!current) return
      setConfigured(status.configured)
      form.setLockedUntil(status.retryAfterMs ? Date.now() + status.retryAfterMs : 0)
    }).catch(error => { if (current) setLoadError(errorText(error)) })
    return () => { current = false }
  }, [])
  useEffect(() => { if (configured !== null) input.current?.focus() }, [configured])
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  async function submit(event) {
    event.preventDefault()
    if (form.submitting.current || form.remaining) return
    form.submitting.current = true; form.setBusy(true); form.setError('')
    try {
      const result = configured ? await unlockParentAccess(form.pin) : await setupParentPin(form.pin, form.confirmation)
      if (form.mounted.current && form.recordResult(result)) onUnlock()
    } catch (error) { if (form.mounted.current) form.setError(errorText(error)) }
    finally { form.submitting.current = false; if (form.mounted.current) form.setBusy(false) }
  }
  return <main className="parent-access" data-mode={configured === null ? 'loading' : configured ? 'unlock' : 'setup'}>
    <header className="parent-access-header"><Brand /><button className="button-outline" onClick={onClose}><Icon name="back" size={18} />Subira ku kibaho</button></header>
    <section className="parent-access-card" aria-labelledby="parent-access-title">
      <div className="parent-access-mark"><Icon name="people" size={32} /></div>
      <p className="parent-eyebrow">Ahagenewe umubyeyi cyangwa umurezi</p>
      <h1 id="parent-access-title">{configured === false ? 'Shyiraho umubare w’ibanga.' : 'Injira nk’umurezi.'}</h1>
      <p>Umwana akoresha ikibaho kugira ngo avuge ibyo akeneye. Umubyeyi cyangwa umurezi ni we uhindura imyirondoro, amashusho, amajwi n’amakuru.</p>
      {loadError ? <p role="alert" className="parent-form-error">{loadError}</p> : configured === null ? <p role="status">Birimo gupakira…</p> : <>
        {!configured && <div className="parent-setup-note"><b>Umubyeyi cyangwa umurezi abanze abishyireho.</b><p>Hitamo imibare ine kugeza kuri itandatu kuri iki gikoresho. Uyu mubare uzajya usabwa mbere yo guhindura igenamiterere. Umwana ashobora gukoresha ikibaho utarawushyiraho.</p></div>}
        <form onSubmit={submit}>
          <PinField label="Umubare w’ibanga" value={form.pin} setValue={form.setPin} inputRef={input} autoComplete={configured ? 'current-password' : 'new-password'} disabled={form.busy || !!form.remaining} />
          {!configured && <PinField label="Ongera wandike umubare w’ibanga" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy} />}
          {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
          {!!form.remaining && <p role="status" className="parent-form-error">Wagerageje kenshi. Tegereza amasegonda {form.remaining}, wongere ugerageze.</p>}
          <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : configured ? 'Injira' : 'Bika kandi winjire'}</button>
        </form>
        <p className="parent-access-note">{configured ? 'Umubare w’ibanga ushyirwaho n’umubyeyi cyangwa umurezi kuri iki gikoresho. Uramutse uwibagiwe, saba uwawushyizeho agufashe.' : 'Bika uyu mubare ahantu umwana atawubona. Nta buryo bwo kuwerekana igihe uwibagiwe.'}</p>
      </>}
      <p className="parent-local-note">Ubu buryo burinda ko umwana ahindura igenamiterere ku bw’impanuka. Si konti yo kuri interineti. Gusiba amakuru ya mushakisha bisiba n’umubare w’ibanga.</p>
    </section>
  </main>
}

export function ParentPinSettings() {
  const form = usePinForm(), [currentPin, setCurrentPin] = useState(''), [status, setStatus] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (form.submitting.current || form.remaining) return
    if (!validParentPin(currentPin)) { form.setError(MESSAGES.format); return }
    form.submitting.current = true; form.setBusy(true); form.setError(''); setStatus('')
    try {
      const result = await changeParentPin(currentPin, form.pin, form.confirmation)
      if (form.mounted.current && form.recordResult(result)) {
        setCurrentPin(''); form.setPin(''); form.setConfirmation('')
        setStatus('Umubare w’ibanga wahinduwe kuri iki gikoresho.')
      }
    } catch (error) { if (form.mounted.current) form.setError(errorText(error)) }
    finally { form.submitting.current = false; if (form.mounted.current) form.setBusy(false) }
  }
  return <section className="parent-settings"><p className="dash-eyebrow">Kwinjira kw’umurezi</p><h1>Umubare w’ibanga w’umurezi.</h1>
    <p>Iyo usubiye ku kibaho, ufunze porogaramu, cyangwa umaze iminota itanu ntacyo ukora, ahagenewe umurezi harafungwa. Kugira ngo wongere winjire bisaba umubare w’ibanga.</p>
    <form className="dash-card" onSubmit={submit}><h2>Hindura umubare w’ibanga</h2>
      <PinField label="Umubare w’ibanga usanzwe" value={currentPin} setValue={setCurrentPin} autoComplete="current-password" disabled={form.busy || !!form.remaining} />
      <PinField label="Umubare w’ibanga mushya" value={form.pin} setValue={form.setPin} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
      <PinField label="Ongera wandike umubare w’ibanga mushya" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
      {form.error && <p className="parent-form-error" role="alert">{form.error}</p>}
      {!!form.remaining && <p className="parent-form-error" role="status">Wagerageje kenshi. Tegereza amasegonda {form.remaining}, wongere ugerageze.</p>}
      {status && <p role="status">{status}</p>}
      <button className="button-primary" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kubikwa…' : 'Bika umubare mushya'}</button>
    </form><p className="parent-local-note">Uyu mubare ni uw’iki gikoresho gusa. Nturinda amakuru umuntu ufite uburenganzira bwo guhindura cyangwa gusiba ububiko bwa mushakisha. Ntukoreshwe nk’ijambo ry’ibanga rya konti yo kuri interineti.</p>
  </section>
}
