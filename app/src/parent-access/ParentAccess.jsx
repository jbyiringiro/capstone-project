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
  // Email accounts are optional; the local caregiver gate always works without internet.
  const [withoutAccount, setWithoutAccount] = useState(false)
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
  useEffect(() => { if (configured !== null && view === 'pin' && (configured || withoutAccount)) input.current?.focus() }, [configured, view, withoutAccount])
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  const showCode = code => { setRecovery(code); setView('code') }
  // A verified email login and a separately chosen local PIN precede setup. Legacy phone accounts
  // keep their original PIN behavior; neither email passwords nor tokens enter local PIN storage.
  async function linked({ phone, email, pin }) {
    const result = await setupParentPin(pin, pin)
    const backup = await connectBackup(onDeviceRestored)
    setLinkNote(`Iki gikoresho gihujwe na konti ya ${email || displayPhone(phone)}. ${backup}`.trim())
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
  const byAccount = configured === false && !withoutAccount
  return <main className="parent-access" data-mode={mode}>
    <header className="parent-access-header"><Brand /><button className="button-outline" onClick={onClose}>Subira ku kibaho</button></header>
    <section className="parent-access-card" aria-labelledby="parent-access-title">
      <p className="parent-eyebrow">Ahagenewe umurezi</p>
      {view === 'code' ? <><h1 id="parent-access-title">Bika kode yo kugarura.</h1>{linkNote && <p role="status">{linkNote}</p>}<RecoveryCode code={recovery} onDone={onUnlock} /></>
        : view === 'forgot' ? <ForgotPin status={status} account={account} onRecovered={showCode} onBack={() => setView('pin')} /> : <>
          <h1 id="parent-access-title">{byAccount ? 'Konti y’umurezi' : configured === false ? 'Shyiraho umubare w’ibanga' : 'Injira nk’umurezi'}</h1>
          <p className="parent-access-intro">{byAccount ? 'Tegura ikibaho cy’umwana.' : 'Fungura igenamiterere ry’ikibaho cy’umwana.'}</p>
          {loadError ? <p role="alert" className="parent-form-error">{loadError}</p> : configured === null ? <p role="status">Birimo gupakira…</p> : byAccount ? <>
            <AccountLink onLinked={linked} onSkip={() => setWithoutAccount(true)} />
          </> : <>
            {!configured && <p className="parent-setup-note">Hitamo imibare 4–6. Ukoreshwa kuri iki gikoresho, no mu gihe nta interineti.</p>}
            <form onSubmit={submit}>
              <PinField label="Umubare w’ibanga" value={form.pin} setValue={form.setPin} inputRef={input} autoComplete={configured ? 'current-password' : 'new-password'} disabled={form.busy || !!form.remaining} />
              {!configured && <PinField label="Ongera wandike umubare w’ibanga" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy} />}
              {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
              <Cooldown form={form} />
              <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : configured ? 'Injira' : 'Bika kandi winjire'}</button>
            </form>
            {configured ? <button type="button" className="parent-text-button" onClick={() => setView('forgot')}>Nibagiwe umubare w’ibanga</button>
              : <button type="button" className="parent-text-button" onClick={() => setWithoutAccount(false)}>Koresha konti ya email</button>}
            {!configured && <p className="parent-access-note">Uzahabwa kode yo kuwugarura uramutse uwibagiwe.</p>}
          </>}
        </>}
      {!byAccount && view === 'pin' && configured !== null && <p className="parent-local-note">Umubare w’ibanga w’iki gikoresho utandukanye n’ijambo ry’ibanga rya email.</p>}
    </section>
  </main>
}
