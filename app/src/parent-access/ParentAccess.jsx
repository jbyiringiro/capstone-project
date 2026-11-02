import { useEffect, useRef, useState } from 'react'
import { Brand } from '../shared/ui.jsx'
import { api, getLinkedAccount } from '../server/api-client.js'
import { userError } from '../shared/errors-rw.js'
import {
  ParentAccessError, changeParentPin, getParentAccessStatus, recoverParentPin, renewRecoveryCode, resetParentPinWithAccount,
  setupParentPin, unlockParentAccess, validParentPin
} from './parent-access.js'
import './parent-access.css'

const MESSAGES = {
  format: 'Koresha imibare ine kugeza kuri itandatu gusa.',
  mismatch: 'Imibare wanditse ntihuye. Ongera uyandike.',
  configured: 'Umubare w’ibanga wamaze gushyirwaho. Subira ku kibaho, wongere winjire.',
  changed: 'Umubare w’ibanga wahindutse. Subira ku kibaho, wongere winjire.',
  unconfigured: 'Umubare w’ibanga nturashyirwaho. Subira ku kibaho, wongere winjire.',
  norecovery: 'Uyu mubare w’ibanga washyizweho nta kode yo kugarura. Koresha konti ya Vuga.',
  recoveryformat: 'Kode yo kugarura ifite inyuguti n’imibare 16, nka ABCD-EFGH-JKLM-NPQR.',
  crypto: 'Mushakisha ntishobora kubika umubare w’ibanga. Koresha urubuga rufite HTTPS cyangwa ufungurire porogaramu kuri iki gikoresho.',
  storage: 'Ntibyashobotse gusoma cyangwa kubika umubare w’ibanga. Reba niba mushakisha yemerewe kubika amakuru.'
}
const errorText = error => MESSAGES[error?.code] || userError(error, MESSAGES.storage)
const WRONG_PIN = 'Umubare w’ibanga si wo. Ongera ugerageze.'
const WRONG_CODE = 'Kode yo kugarura si yo. Ongera ugerageze.'
const masked = phone => (phone.length > 3 ? `${'•'.repeat(Math.min(phone.length - 3, 7))}${phone.slice(-3)}` : phone)

function PinField({ label, value, setValue, autoComplete, disabled, inputRef }) {
  return <label className="parent-pin-field">{label}<input ref={inputRef} type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6}
    value={value} onChange={event => setValue(event.target.value)} autoComplete={autoComplete} disabled={disabled} required
    onInput={event => event.currentTarget.setCustomValidity('')}
    onInvalid={event => event.currentTarget.setCustomValidity(MESSAGES.format)} />
  </label>
}

function TextField({ label, value, setValue, type = 'text', autoComplete = 'off', disabled, inputRef, className = '' }) {
  return <label className={`parent-pin-field ${className}`}>{label}<input ref={inputRef} type={type} value={value} onChange={event => setValue(event.target.value)}
    autoComplete={autoComplete} autoCapitalize="characters" spellCheck={false} disabled={disabled} required /></label>
}

// Shown once, right after it is made: the code is never stored and cannot be shown again.
export function RecoveryCode({ code, onDone, done = 'Nayanditse, komeza' }) {
  return <div className="parent-recovery">
    <p className="parent-eyebrow">Kode yo kugarura umubare w’ibanga</p>
    <p className="parent-recovery-code" aria-label={`Kode yo kugarura: ${code.split('').join(' ')}`}>{code}</p>
    <p>Iyandike ku rupapuro, uyibike ahantu umwana atayibona. Niwibagirwa umubare w’ibanga, iyi kode izagufasha gushyiraho undi utabuze amakuru y’abana. Ntizongera kugaragara.</p>
    <button type="button" className="button-primary parent-submit" onClick={onDone}>{done}</button>
  </div>
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
  function recordResult(result, wrong = WRONG_PIN) {
    if (result.ok) return true
    setPin('')
    setLockedUntil(result.retryAfterMs ? Date.now() + result.retryAfterMs : 0)
    setError(result.retryAfterMs ? '' : wrong)
    return false
  }
  // One submission at a time; `task` returns a result for recordResult, or throws a coded error.
  async function submit(event, task, onSuccess, wrong) {
    event.preventDefault()
    if (submitting.current || remaining) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const result = await task()
      if (mounted.current && recordResult(result, wrong)) onSuccess(result)
    } catch (failure) { if (mounted.current) setError(errorText(failure)) }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  return { pin, setPin, confirmation, setConfirmation, error, setError, busy, remaining, setLockedUntil, submit }
}

const Cooldown = ({ form }) => !!form.remaining && <p role="status" className="parent-form-error">Wagerageje kenshi. Tegereza amasegonda {form.remaining}, wongere ugerageze.</p>

// A forgotten PIN: the recovery code written down at setup, or the Vuga account linked to this
// device. Both set a new PIN and show a new recovery code; no child's data is touched.
function ForgotPin({ status, account, onRecovered, onBack }) {
  const ways = [status.recoverable && 'code', account && 'account'].filter(Boolean)
  const [way, setWay] = useState(ways[0] ?? null)
  const [secret, setSecret] = useState('')
  const form = usePinForm(), first = useRef(null)
  useEffect(() => { form.setLockedUntil(status.retryAfterMs ? Date.now() + status.retryAfterMs : 0) }, [])
  useEffect(() => { setSecret(''); form.setError(''); first.current?.focus() }, [way])
  const recover = event => form.submit(event, way === 'code'
    ? () => recoverParentPin(secret, form.pin, form.confirmation)
    : async () => {
      // Checked before signing in, so a typing slip does not cost a trip to the server.
      if (!validParentPin(form.pin)) throw new ParentAccessError('format')
      if (form.pin !== form.confirmation) throw new ParentAccessError('mismatch')
      await api.login(account.phone, secret)
      return resetParentPinWithAccount(form.pin, form.confirmation)
    }, result => onRecovered(result.recoveryCode), WRONG_CODE)
  return <>
    <h1 id="parent-access-title">Shyiraho umubare w’ibanga mushya.</h1>
    {!way ? <div className="parent-setup-note"><b>Nta buryo bwo kuwugarura buri kuri iki gikoresho.</b>
      <p>Nta kode yo kugarura cyangwa konti ya Vuga bihujwe n’iki gikoresho. Uwashyizeho umubare w’ibanga ni we wawuhindura. Gusiba amakuru ya mushakisha bisiba umubare w’ibanga n’amakuru yose y’abana ari kuri iki gikoresho, keretse ibyabitswe kuri konti ya Vuga.</p></div> : <>
      {ways.length > 1 && <div className="parent-ways" role="group" aria-label="Uburyo bwo kugarura">
        <button type="button" aria-pressed={way === 'code'} onClick={() => setWay('code')}>Kode yo kugarura</button>
        <button type="button" aria-pressed={way === 'account'} onClick={() => setWay('account')}>Konti ya Vuga</button>
      </div>}
      <p>{way === 'code' ? 'Andika kode wahawe igihe washyiragaho umubare w’ibanga.' : `Injira kuri konti ya Vuga ihujwe n’iki gikoresho (${masked(account.phone)}). Bisaba interineti.`}</p>
      <form onSubmit={recover}>
        {way === 'code'
          ? <TextField label="Kode yo kugarura" value={secret} setValue={setSecret} inputRef={first} disabled={form.busy || !!form.remaining} className="parent-code-field" />
          : <TextField label="Ijambobanga rya konti" type="password" autoComplete="current-password" value={secret} setValue={setSecret} inputRef={first} disabled={form.busy} />}
        <PinField label="Umubare w’ibanga mushya" value={form.pin} setValue={form.setPin} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
        <PinField label="Ongera wandike umubare w’ibanga mushya" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
        {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
        <Cooldown form={form} />
        <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : 'Shyiraho umubare mushya'}</button>
      </form>
    </>}
    <button type="button" className="parent-text-button" onClick={onBack}>Subira inyuma</button>
  </>
}

export default function ParentAccess({ onUnlock, onClose }) {
  const [status, setStatus] = useState(null), [account, setAccount] = useState(null), [loadError, setLoadError] = useState('')
  const [view, setView] = useState('pin'), [recovery, setRecovery] = useState('')
  const form = usePinForm(), input = useRef(null)
  const configured = status?.configured ?? null
  useEffect(() => {
    let current = true
    Promise.all([getParentAccessStatus(), getLinkedAccount()]).then(([next, linked]) => {
      if (!current) return
      setStatus(next)
      setAccount(linked)
      form.setLockedUntil(next.retryAfterMs ? Date.now() + next.retryAfterMs : 0)
    }).catch(error => { if (current) setLoadError(errorText(error)) })
    return () => { current = false }
  }, [])
  useEffect(() => { if (configured !== null && view === 'pin') input.current?.focus() }, [configured, view])
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  const showCode = code => { setRecovery(code); setView('code') }
  const submit = event => form.submit(event, () => (configured ? unlockParentAccess(form.pin) : setupParentPin(form.pin, form.confirmation)),
    result => (result.recoveryCode ? showCode(result.recoveryCode) : onUnlock()))
  const mode = configured === null ? 'loading' : view === 'code' ? 'recovery-code' : view === 'forgot' ? 'forgot' : configured ? 'unlock' : 'setup'
  return <main className="parent-access" data-mode={mode}>
    <header className="parent-access-header"><Brand /><button className="button-outline" onClick={onClose}>Subira ku kibaho</button></header>
    <section className="parent-access-card" aria-labelledby="parent-access-title">
      <p className="parent-eyebrow">Ahagenewe umubyeyi cyangwa umurezi</p>
      {view === 'code' ? <><h1 id="parent-access-title">Bika kode yo kugarura.</h1><RecoveryCode code={recovery} onDone={onUnlock} /></>
        : view === 'forgot' ? <ForgotPin status={status} account={account} onRecovered={showCode} onBack={() => setView('pin')} /> : <>
          <h1 id="parent-access-title">{configured === false ? 'Shyiraho umubare w’ibanga.' : 'Injira nk’umurezi.'}</h1>
          <p>Umwana akoresha ikibaho kugira ngo avuge ibyo akeneye. Umubyeyi cyangwa umurezi ni we uhindura imyirondoro, amashusho, amajwi n’amakuru.</p>
          {loadError ? <p role="alert" className="parent-form-error">{loadError}</p> : configured === null ? <p role="status">Birimo gupakira…</p> : <>
            {!configured && <div className="parent-setup-note"><b>Umubyeyi cyangwa umurezi abanze abishyireho.</b><p>Hitamo imibare ine kugeza kuri itandatu kuri iki gikoresho. Uyu mubare uzajya usabwa mbere yo guhindura igenamiterere. Umwana ashobora gukoresha ikibaho utarawushyiraho.</p></div>}
            <form onSubmit={submit}>
              <PinField label="Umubare w’ibanga" value={form.pin} setValue={form.setPin} inputRef={input} autoComplete={configured ? 'current-password' : 'new-password'} disabled={form.busy || !!form.remaining} />
              {!configured && <PinField label="Ongera wandike umubare w’ibanga" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy} />}
              {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
              <Cooldown form={form} />
              <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : configured ? 'Injira' : 'Bika kandi winjire'}</button>
            </form>
            {configured && <button type="button" className="parent-text-button" onClick={() => setView('forgot')}>Nibagiwe umubare w’ibanga</button>}
            <p className="parent-access-note">{configured ? 'Umubare w’ibanga ushyirwaho n’umubyeyi cyangwa umurezi kuri iki gikoresho. Uramutse uwibagiwe, kanda «Nibagiwe umubare w’ibanga».' : 'Bika uyu mubare ahantu umwana atawubona. Nyuma yo kuwushyiraho, uzahabwa kode yo kuwugarura uramutse uwibagiwe.'}</p>
          </>}
        </>}
      <p className="parent-local-note">Ubu buryo burinda ko umwana ahindura igenamiterere ku bw’impanuka. Umubare w’ibanga ni uw’iki gikoresho gusa, si ijambobanga rya konti yo kuri interineti.</p>
    </section>
  </main>
}

export function ParentPinSettings() {
  const form = usePinForm(), [currentPin, setCurrentPin] = useState(''), [status, setStatus] = useState('')
  const codeForm = usePinForm(), [recovery, setRecovery] = useState(''), [recoverable, setRecoverable] = useState(null)
  useEffect(() => { getParentAccessStatus().then(next => setRecoverable(next.recoverable)).catch(() => setRecoverable(null)) }, [])
  const change = event => {
    if (!validParentPin(currentPin)) { event.preventDefault(); form.setError(MESSAGES.format); return }
    setStatus('')
    return form.submit(event, () => changeParentPin(currentPin, form.pin, form.confirmation), () => {
      setCurrentPin(''); form.setPin(''); form.setConfirmation('')
      setStatus('Umubare w’ibanga wahinduwe kuri iki gikoresho. Kode yo kugarura wanditse iracyakora.')
    })
  }
  const renew = event => codeForm.submit(event, () => renewRecoveryCode(codeForm.pin), result => {
    codeForm.setPin(''); setRecovery(result.recoveryCode); setRecoverable(true)
  })
  return <section className="parent-settings"><p className="dash-eyebrow">Kwinjira kw’umurezi</p><h1>Umubare w’ibanga w’umurezi.</h1>
    <p>Iyo usubiye ku kibaho, ufunze porogaramu, cyangwa umaze iminota itanu ntacyo ukora, ahagenewe umurezi harafungwa. Kugira ngo wongere winjire bisaba umubare w’ibanga.</p>
    <form className="dash-card" onSubmit={change} aria-label="Hindura umubare w’ibanga"><h2>Hindura umubare w’ibanga</h2>
      <PinField label="Umubare w’ibanga usanzwe" value={currentPin} setValue={setCurrentPin} autoComplete="current-password" disabled={form.busy || !!form.remaining} />
      <PinField label="Umubare w’ibanga mushya" value={form.pin} setValue={form.setPin} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
      <PinField label="Ongera wandike umubare w’ibanga mushya" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
      {form.error && <p className="parent-form-error" role="alert">{form.error}</p>}
      <Cooldown form={form} />
      {status && <p role="status">{status}</p>}
      <button className="button-primary" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kubikwa…' : 'Bika umubare mushya'}</button>
    </form>
    <form className="dash-card" onSubmit={renew} aria-label="Kode yo kugarura"><h2>Kode yo kugarura</h2>
      {recovery ? <RecoveryCode code={recovery} onDone={() => setRecovery('')} done="Nayibitse" /> : <>
        <p>{recoverable === false ? 'Uyu mubare w’ibanga nta kode yo kugarura ufite. Kora imwe, uyandike, kugira ngo utazabura uko winjira.' : 'Niba warataye kode yawe, kora indi. Iya mbere ntiba igikora.'}</p>
        <PinField label="Umubare w’ibanga usanzwe" value={codeForm.pin} setValue={codeForm.setPin} autoComplete="current-password" disabled={codeForm.busy || !!codeForm.remaining} />
        {codeForm.error && <p className="parent-form-error" role="alert">{codeForm.error}</p>}
        <Cooldown form={codeForm} />
        <button className="button-primary" disabled={codeForm.busy || !!codeForm.remaining}>{codeForm.busy ? 'Birimo gukorwa…' : 'Kora kode nshya'}</button>
      </>}
    </form>
    <p className="parent-local-note">Uyu mubare ni uw’iki gikoresho gusa. Nturinda amakuru umuntu ufite uburenganzira bwo guhindura cyangwa gusiba ububiko bwa mushakisha. Ntukoreshwe nk’ijambo ry’ibanga rya konti yo kuri interineti.</p>
  </section>
}
