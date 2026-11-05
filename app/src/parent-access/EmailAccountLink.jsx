import { useEffect, useRef, useState } from 'react'
import { api } from '../server/api-client.js'
import { emailAuth } from '../server/email-auth.js'
import { localizedError } from '../shared/errors-rw.js'
import { ParentAccessError, unlockParentAccess, validParentPin } from './parent-access.js'
import { EmailField, NameField, PasswordField, PinField, WRONG_PIN, caregiverName, errorText } from './forms.jsx'

const RESET_NOTE = 'Niba iyi email ifite konti, izakira ihuza ryo guhindura ijambo ry’ibanga. Reba no muri spam.'
// A short UI cooldown discourages duplicate requests; Firebase enforces its own limits.
const RESEND_WAIT_MS = 60_000

export default function EmailAccountLink({ devicePin = false, onLinked, onSkip, onLegacy }) {
  const [step, setStep] = useState('register') // register | verify | login | reset
  const [email, setEmail] = useState(''), [name, setName] = useState('')
  const [password, setPassword] = useState(''), [repeatPassword, setRepeatPassword] = useState('')
  const [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('')
  const [needsName, setNeedsName] = useState(false), [resendOpen, setResendOpen] = useState(false)
  const [cooldown, setCooldown] = useState({ address: '', until: 0 }), [now, setNow] = useState(Date.now())
  const submitting = useRef(false), heading = useRef(null), firstRender = useRef(true)
  const configured = emailAuth.configured()
  const address = email.trim().toLowerCase()
  const remaining = cooldown.address === address ? Math.max(0, Math.ceil((cooldown.until - now) / 1000)) : 0

  useEffect(() => {
    if (cooldown.until <= Date.now()) return
    const timer = setInterval(() => {
      const time = Date.now(); setNow(time)
      if (time >= cooldown.until) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [cooldown.until])
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    heading.current?.focus()
  }, [step])

  function startCooldown(destination = address) {
    const time = Date.now()
    setNow(time); setCooldown({ address: destination.toLowerCase(), until: time + RESEND_WAIT_MS })
  }
  function clearCredentials() {
    setPassword(''); setRepeatPassword(''); setPin(''); setConfirmation('')
  }
  async function run(event, task) {
    event?.preventDefault()
    if (submitting.current) return
    submitting.current = true; setBusy(true); setError(''); setNote('')
    try { await task() } catch (failure) {
      if (failure?.code === 'email-unverified' || failure?.accountCreated) {
        setStep('verify'); setResendOpen(false); clearCredentials()
      }
      if (failure?.accountCreated) {
        setNote('Konti yakozwe. Saba indi email yo kwemeza hano.')
        if (failure.code === 'too-many-requests') startCooldown()
      }
      if (failure?.status === 422) setNeedsName(true)
      setError(errorText(failure))
    } finally { submitting.current = false; setBusy(false) }
  }
  function navigate(next) {
    setStep(next); setError(''); setNote(''); setName(''); clearCredentials(); setNeedsName(false); setResendOpen(false)
  }
  const register = event => run(event, async () => {
    const caregiver = caregiverName(name)
    if (!caregiver) throw new ParentAccessError('name')
    if (password.length < 8) throw new ParentAccessError('password')
    if (password !== repeatPassword) throw new ParentAccessError('passwordmismatch')
    const result = await api.registerEmail(address, password, caregiver)
    const destination = result.email || address
    setEmail(destination); clearCredentials(); setStep('verify'); startCooldown(destination)
    setNote('Email yo kwemeza yoherejwe.')
  })
  const signIn = event => run(event, async () => {
    if (!validParentPin(pin)) throw new ParentAccessError('format')
    if (devicePin) {
      // Linking a cloud account cannot bypass or replace an existing local gate.
      const local = await unlockParentAccess(pin)
      if (!local.ok) throw localizedError(local.retryAfterMs
        ? `Wagerageje kenshi. Tegereza amasegonda ${Math.ceil(local.retryAfterMs / 1000)}, wongere ugerageze.` : WRONG_PIN)
    } else if (pin !== confirmation) throw new ParentAccessError('mismatch')
    if (needsName && !caregiverName(name)) throw new ParentAccessError('name')
    const result = await api.loginEmail(address, password, caregiverName(name) || undefined)
    await onLinked({ email: result.user.email, user_id: result.user.user_id, pin, existing: true })
    clearCredentials()
  })
  const resend = event => run(event, async () => {
    if (cooldown.address === address && cooldown.until > Date.now()) return
    try {
      const result = await api.resendEmailVerification(address, password)
      setPassword(''); setResendOpen(false)
      if (result.alreadyVerified) { navigate('login'); setNote('Email yawe yemejwe. Injira muri konti.'); return }
      startCooldown(); setNote('Twongeye kohereza email yo kwemeza.')
    } catch (failure) {
      if (failure?.code === 'too-many-requests') startCooldown()
      throw failure
    }
  })
  const reset = event => run(event, async () => { await api.requestEmailPasswordReset(address); setNote(RESET_NOTE) })
  const feedback = <>
    {error && <p role="alert" className="parent-form-error">{error}</p>}
    {note && <p role="status" className="email-status">{note}</p>}
  </>
  const titles = { register: 'Fungura konti', login: 'Injira muri konti', verify: 'Emeza email yawe', reset: 'Hindura ijambo ry’ibanga' }

  return <div className="email-account" aria-busy={busy}>
    {!configured ? <p role="status" className="parent-setup-note">Konti za email ntiziraboneka ubu. Ushobora gukomeza nta konti.</p> : <>
      {(step === 'register' || step === 'login') && <div className="parent-ways email-tabs" role="group" aria-label="Konti ya email">
        <button type="button" aria-pressed={step === 'register'} disabled={busy} onClick={() => navigate('register')}>Fungura konti</button>
        <button type="button" aria-pressed={step === 'login'} disabled={busy} onClick={() => navigate('login')}>Mfite konti</button>
      </div>}
      <div className={step === 'register' || step === 'login' ? 'sr-only' : 'email-heading'}><h2 ref={heading} tabIndex={-1}>{titles[step]}</h2></div>
      {step === 'verify' ? <>
        <div className="email-verify-card">
          <span className="email-verify-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" />
          </svg></span>
          <p className="email-address">{address}</p>
          <p>Fungura email ya Vuga, ukande ihuza ryo kwemeza.</p>
        </div>
        {feedback}
        <button type="button" className="button-primary parent-submit" disabled={busy} onClick={() => navigate('login')}>Nemeje email, komeza</button>
        <p className="email-help">Ntibiragera? Reba muri spam. Email ishobora gutinda iminota mike.</p>
        {resendOpen ? <form className="email-resend-form" onSubmit={resend}>
          <PasswordField value={password} setValue={setPassword} disabled={busy} />
          <button className="button-outline parent-submit" disabled={busy || !!remaining}>{busy ? 'Birimo koherezwa…' : remaining ? `Ohereza indi email (${remaining}s)` : 'Ohereza indi email'}</button>
        </form> : <button type="button" className="parent-text-button" disabled={busy || !!remaining}
          onClick={() => { setResendOpen(true); setError(''); setNote('') }}>
          {remaining ? `Ongera wohereze email (${remaining}s)` : 'Ongera wohereze email'}
        </button>}
        <button type="button" className="parent-text-button" onClick={() => navigate('register')} disabled={busy}>Hindura email</button>
      </> : <>
        {step === 'reset' && <p className="email-help">Tuzohereza ihuza ryo guhindura ijambo ry’ibanga rya konti.</p>}
        <form onSubmit={step === 'register' ? register : step === 'reset' ? reset : signIn}>
          {(step === 'register' || (step === 'login' && needsName)) && <NameField value={name} setValue={setName} disabled={busy} hint={false} />}
          <EmailField value={email} setValue={setEmail} disabled={busy} />
          {step !== 'reset' && <PasswordField key={step} value={password} setValue={setPassword} creating={step === 'register'} disabled={busy}
            hint={step === 'register' ? 'Nibura inyuguti 8.' : undefined} />}
          {step === 'register' && <PasswordField label="Ongera wandike ijambo ry’ibanga rya konti" value={repeatPassword} setValue={setRepeatPassword} creating disabled={busy} />}
          {step === 'login' && <>
            <button type="button" className="parent-text-button email-forgot" disabled={busy} onClick={() => navigate('reset')}>Nibagiwe ijambo ry’ibanga</button>
            <fieldset className="email-pin-group">
              <legend>Umubare w’ibanga w’iki gikoresho</legend>
              <p className="email-help">{devicePin ? 'Koresha usanzwe ufungura ahagenewe umurezi.' : 'Hitamo imibare 4–6 yo kwinjira nta interineti.'}</p>
              <PinField label={devicePin ? 'Umubare usanzwe' : 'Hitamo umubare'} value={pin} setValue={setPin} autoComplete={devicePin ? 'current-password' : 'new-password'} disabled={busy} />
              {!devicePin && <PinField label="Ongera uwandike" value={confirmation} setValue={setConfirmation} autoComplete="new-password" disabled={busy} />}
            </fieldset>
          </>}
          {feedback}
          <button className="button-primary parent-submit" disabled={busy}>{busy ? (step === 'login' ? 'Birimo kwinjira…' : 'Birimo koherezwa…')
            : step === 'register' ? 'Fungura konti ukoresheje email' : step === 'reset' ? 'Ohereza ihuza' : 'Injira muri konti'}</button>
        </form>
        {step === 'reset' && <button type="button" className="parent-text-button" disabled={busy} onClick={() => navigate('login')}>Subira kwinjira</button>}
      </>}
    </>}
    <div className="email-footer">
      {onSkip && <button type="button" className="parent-text-button" onClick={onSkip} disabled={busy}>Komeza nta konti</button>}
      <a href="/privacy.html" target="_blank" rel="noreferrer">Uko Vuga ibika amakuru</a>
    </div>
    <details className="email-alternatives"><summary>Ubundi buryo bwo kwinjira</summary>
      <button type="button" className="parent-text-button" onClick={onLegacy} disabled={busy}>Koresha konti ya nimero ya telefoni</button>
    </details>
  </div>
}
