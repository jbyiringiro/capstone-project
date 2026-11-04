import { useEffect, useRef, useState } from 'react'
import { Brand } from '../shared/ui.jsx'
import { getLinkedAccount, signInQuietly } from '../server/api-client.js'
import { displayPhone } from '../server/phone.js'
import { getParentAccessStatus, setupParentPin, unlockParentAccess } from './parent-access.js'
import AccountLink, { connectBackup } from './AccountLink.jsx'
import ForgotPin from './ForgotPin.jsx'
import RecoveryCode from './RecoveryCode.jsx'
import { Cooldown, PinField, errorText, usePinForm } from './forms.jsx'
import './parent-access.css'

export default function ParentAccess({ onUnlock, onClose, onDeviceRestored }) {
  const [status, setStatus] = useState(null), [account, setAccount] = useState(null), [loadError, setLoadError] = useState('')
  const [view, setView] = useState('pin'), [recovery, setRecovery] = useState(''), [linkNote, setLinkNote] = useState('')
  // A first setup starts with the caregiver's number; without internet it can go on without one.
  const [withoutNumber, setWithoutNumber] = useState(false)
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
  useEffect(() => { if (configured !== null && view === 'pin' && (configured || withoutNumber)) input.current?.focus() }, [configured, view, withoutNumber])
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  const showCode = code => { setRecovery(code); setView('code') }
  // The account's PIN becomes this device's, with a recovery code for when there is no internet, and
  // the account's copy comes onto the device.
  async function linked({ phone, pin }) {
    const result = await setupParentPin(pin, pin)
    const backup = await connectBackup(onDeviceRestored)
    setLinkNote(`Iki gikoresho gihujwe na konti ya ${displayPhone(phone)}. ${backup}`.trim())
    showCode(result.recoveryCode)
  }
  const submit = event => {
    const pin = form.pin
    return form.submit(event, () => (configured ? unlockParentAccess(pin) : setupParentPin(pin, form.confirmation)), result => {
      if (result.recoveryCode) return showCode(result.recoveryCode)
      signInQuietly(pin)
      onUnlock()
    })
  }
  const mode = configured === null ? 'loading' : view === 'code' ? 'recovery-code' : view === 'forgot' ? 'forgot' : configured ? 'unlock' : 'setup'
  const byNumber = configured === false && !withoutNumber
  return <main className="parent-access" data-mode={mode}>
    <header className="parent-access-header"><Brand /><button className="button-outline" onClick={onClose}>Subira ku kibaho</button></header>
    <section className="parent-access-card" aria-labelledby="parent-access-title">
      <p className="parent-eyebrow">Ahagenewe umubyeyi cyangwa umurezi</p>
      {view === 'code' ? <><h1 id="parent-access-title">Bika kode yo kugarura.</h1>{linkNote && <p role="status">{linkNote}</p>}<RecoveryCode code={recovery} onDone={onUnlock} /></>
        : view === 'forgot' ? <ForgotPin status={status} account={account} onRecovered={showCode} onBack={() => setView('pin')} /> : <>
          <h1 id="parent-access-title">{byNumber ? 'Shyiraho konti y’umurezi.' : configured === false ? 'Shyiraho umubare w’ibanga.' : 'Injira nk’umurezi.'}</h1>
          <p>Umwana akoresha ikibaho kugira ngo avuge ibyo akeneye. Umubyeyi cyangwa umurezi ni we uhindura imyirondoro, amashusho, amajwi n’amakuru.</p>
          {loadError ? <p role="alert" className="parent-form-error">{loadError}</p> : configured === null ? <p role="status">Birimo gupakira…</p> : byNumber ? <>
            <div className="parent-setup-note"><b>Umubyeyi cyangwa umurezi abanze abishyireho.</b><p>Andika nimero ya telefoni yawe. Tuzakoherereza kode muri SMS, hanyuma uhitemo umubare w’ibanga w’imibare ine kugeza kuri itandatu. Uwo mubare ni wo uzajya ukoresha hano no ku bindi bikoresho, kandi niwawibagirwa, uzawuhindura ukoresheje SMS. Umwana ashobora gukoresha ikibaho utarabishyiraho.</p></div>
            <AccountLink onLinked={linked} onSkip={() => setWithoutNumber(true)} />
          </> : <>
            {!configured && <div className="parent-setup-note"><b>Umubare w’ibanga w’iki gikoresho gusa.</b><p>Hitamo imibare ine kugeza kuri itandatu. Uyu mubare uzajya usabwa mbere yo guhindura igenamiterere. Ushobora kongeraho nimero yawe nyuma muri «Kwinjira».</p></div>}
            <form onSubmit={submit}>
              <PinField label="Umubare w’ibanga" value={form.pin} setValue={form.setPin} inputRef={input} autoComplete={configured ? 'current-password' : 'new-password'} disabled={form.busy || !!form.remaining} />
              {!configured && <PinField label="Ongera wandike umubare w’ibanga" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy} />}
              {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
              <Cooldown form={form} />
              <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : configured ? 'Injira' : 'Bika kandi winjire'}</button>
            </form>
            {configured ? <button type="button" className="parent-text-button" onClick={() => setView('forgot')}>Nibagiwe umubare w’ibanga</button>
              : <button type="button" className="parent-text-button" onClick={() => setWithoutNumber(false)}>Koresha nimero ya telefoni</button>}
            <p className="parent-access-note">{configured ? 'Umubare w’ibanga ushyirwaho n’umubyeyi cyangwa umurezi. Uramutse uwibagiwe, kanda «Nibagiwe umubare w’ibanga».' : 'Bika uyu mubare ahantu umwana atawubona. Nyuma yo kuwushyiraho, uzahabwa kode yo kuwugarura uramutse uwibagiwe.'}</p>
          </>}
        </>}
      <p className="parent-local-note">Ubu buryo burinda ko umwana ahindura igenamiterere ku bw’impanuka. Iyo iki gikoresho gihujwe na nimero yawe, umubare w’ibanga ni na wo winjiza kuri konti yawe.</p>
    </section>
  </main>
}
