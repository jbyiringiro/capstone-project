import { useEffect, useRef, useState } from 'react'
import { api } from '../server/api-client.js'
import { emailAuth } from '../server/email-auth.js'
import { ParentAccessError } from './parent-access.js'
import { EmailCodeField, EmailField, NameField, PasswordField, PinField, caregiverName, errorText } from './forms.jsx'
import EmailPasswordReset from './EmailPasswordReset.jsx'
import { normalizeEmailAddress, validNewPassword } from '../shared/account-validation.js'

const RESET_NOTE = 'Niba iyi email ifite konti, izakira ihuza ryo guhindura ijambo ry’ibanga. Reba no muri spam.'
// A short UI cooldown discourages duplicate requests; the server enforces its own limits.
const RESEND_WAIT_MS = 60_000
const UNCERTAIN_CODE_REQUEST = new Set(['too-many-requests', 'verification-send-failed', 'network', 'timeout', 'unavailable', 'invalid-response'])

export default function EmailAccountLink({ devicePin = false, onLinked, onSkip, onLegacy }) {
  const [step, setStep] = useState('register') // register | verify | login | pin | reset
  const [email, setEmail] = useState(''), [name, setName] = useState('')
  const [password, setPassword] = useState(''), [repeatPassword, setRepeatPassword] = useState('')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('')
  const [needsName, setNeedsName] = useState(false), [resendOpen, setResendOpen] = useState(false)
  const [pendingLogin, setPendingLogin] = useState(null)
  const [cooldown, setCooldown] = useState({ address: '', until: 0 }), [now, setNow] = useState(Date.now())
  const submitting = useRef(false), heading = useRef(null), firstRender = useRef(true)
  const lifecycle = useRef({ mounted: true, version: 0 }), loginAbort = useRef(null), pendingHandle = useRef(null)
  const configured = emailAuth.configured()
  const usesCode = emailAuth.verificationMethod === 'code'
  const address = normalizeEmailAddress(email) || email.trim()
  const remaining = cooldown.address === address ? Math.max(0, Math.ceil((cooldown.until - now) / 1000)) : 0

  useEffect(() => {
    lifecycle.current.mounted = true
    return () => {
      lifecycle.current.mounted = false; lifecycle.current.version += 1
      loginAbort.current?.abort()
      void api.cancelEmailLogin(pendingHandle.current)
    }
  }, [])
  useEffect(() => {
    if (!pendingLogin) return
    const timer = setTimeout(() => {
      navigate('login')
      setError('Igihe cyo kurangiza kwinjira cyarangiye. Ongera wandike email n’ijambo ry’ibanga.')
    }, Math.max(0, pendingLogin.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [pendingLogin])

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
    setNow(time); setCooldown({ address: normalizeEmailAddress(destination) || destination.trim(), until: time + RESEND_WAIT_MS })
  }
  function clearCredentials() {
    setPassword(''); setRepeatPassword(''); setPin(''); setConfirmation(''); setCode('')
  }
  function discardLogin() {
    loginAbort.current?.abort(); loginAbort.current = null
    void api.cancelEmailLogin(pendingHandle.current)
    pendingHandle.current = null; setPendingLogin(null)
  }
  async function run(event, task) {
    event?.preventDefault()
    if (submitting.current) return
    const version = lifecycle.current.version
    const current = () => lifecycle.current.mounted && lifecycle.current.version === version
    submitting.current = true; setBusy(true); setError(''); setNote('')
    try { await task(current) } catch (failure) {
      if (!current()) return
      if (['email-login-expired', 'email-login-changed'].includes(failure?.code) || (step === 'pin' && [401, 403].includes(failure?.status))) navigate('login')
      if (failure?.code === 'email-unverified' || failure?.accountCreated || failure?.verificationRequired) {
        setStep('verify'); setResendOpen(false); clearCredentials()
      }
      if (failure?.verificationRequired) {
        setNote('Kwemeza email ntibirarangira. Niba kode itaragera, tegereza gato uyisabe hano.')
        if (UNCERTAIN_CODE_REQUEST.has(failure.code)) startCooldown()
      } else if (failure?.accountCreated && emailAuth.provider !== 'neon') {
        setNote('Konti yakozwe. Saba indi email yo kwemeza hano.')
        if (failure.code === 'too-many-requests') startCooldown()
      }
      if (failure?.status === 422) setNeedsName(true)
      setError(errorText(failure))
    } finally { if (current()) { submitting.current = false; setBusy(false) } }
  }
  function navigate(next) {
    lifecycle.current.version += 1; submitting.current = false; setBusy(false); discardLogin()
    setStep(next); setError(''); setNote(''); setName(''); clearCredentials(); setNeedsName(false); setResendOpen(false)
  }
  const register = event => run(event, async () => {
    const caregiver = caregiverName(name)
    if (!caregiver) throw new ParentAccessError('name')
    if (!validNewPassword(password)) throw new ParentAccessError('password')
    if (password !== repeatPassword) throw new ParentAccessError('passwordmismatch')
    const result = await api.registerEmail(address, password, caregiver)
    const destination = result.email || address
    setEmail(destination); clearCredentials(); setStep('verify'); startCooldown(destination)
    setNote(usesCode ? 'Twasabye kode yo kwemeza. Reba email yawe na spam.' : 'Twasabye email yo kwemeza. Reba email yawe na spam.')
  })
  const signIn = event => run(event, async current => {
    if (needsName && !caregiverName(name)) throw new ParentAccessError('name')
    discardLogin()
    const controller = new AbortController()
    loginAbort.current = controller
    const prepared = await api.prepareEmailLogin(address, password, caregiverName(name) || undefined, { signal: controller.signal })
    if (!current()) { void api.cancelEmailLogin(prepared); return }
    pendingHandle.current = prepared; setPendingLogin(prepared)
    clearCredentials(); setStep('pin')
  })
  const finishSignIn = event => run(event, async current => {
    const result = await api.completeEmailLogin(pendingHandle.current, { pin, confirmation })
    if (!current()) return
    // Completion detached the abort listener; unmount cannot revoke a committed session.
    pendingHandle.current = null; loginAbort.current = null; setPendingLogin(null)
    await onLinked({ email: result.user.email, user_id: result.user.user_id, auth_provider: result.user.auth_provider, pin, existing: true, recoveryCode: result.recoveryCode })
    if (!current()) return
    clearCredentials()
  })
  const verify = event => run(event, async () => {
    if (!/^\d{6}$/.test(code)) throw new ParentAccessError('emailcode')
    await api.verifyEmailCode(address, code)
    navigate('login'); setNote('Email yawe yemejwe. Injira muri konti.')
  })
  const resend = event => run(event, async () => {
    if (cooldown.address === address && cooldown.until > Date.now()) return
    try {
      const result = await api.resendEmailVerification(address, password)
      setPassword(''); setResendOpen(false)
      if (result.alreadyVerified) { navigate('login'); setNote('Email yawe yemejwe. Injira muri konti.'); return }
      startCooldown(); setNote(usesCode ? 'Twasabye indi kode yo kwemeza. Reba email yawe na spam.' : 'Twasabye indi email yo kwemeza. Reba email yawe na spam.')
    } catch (failure) {
      if (UNCERTAIN_CODE_REQUEST.has(failure?.code)) startCooldown()
      throw failure
    }
  })
  const reset = event => run(event, async () => { await api.requestEmailPasswordReset(address); setNote(RESET_NOTE) })
  const feedback = <>
    {error && <p role="alert" className="parent-form-error">{error}</p>}
    {note && <p role="status" className="email-status">{note}</p>}
  </>
  const titles = { register: 'Fungura konti', login: 'Injira muri konti', pin: 'Umubare w’ibanga w’iki gikoresho', verify: 'Emeza email yawe', reset: 'Hindura ijambo ry’ibanga' }
  const existingDevicePin = pendingLogin?.devicePin ?? devicePin

  return <div className="email-account" aria-busy={busy}>
    {!configured ? <p role="status" className="parent-setup-note">Konti za email ntiziraboneka ubu. Ushobora gukomeza nta konti.</p> : <>
      {(step === 'register' || step === 'login') && <div className="parent-ways email-tabs" role="group" aria-label="Konti ya email">
        <button type="button" aria-pressed={step === 'register'} disabled={busy} onClick={() => navigate('register')}>Fungura konti</button>
        <button type="button" aria-pressed={step === 'login'} disabled={busy} onClick={() => navigate('login')}>Mfite konti</button>
      </div>}
      <div className={step === 'register' || step === 'login' ? 'sr-only' : 'email-heading'}><h2 ref={heading} tabIndex={-1}>{titles[step]}</h2></div>
      {step === 'pin' ? <div className="email-pin-stage">
        <p className="email-help">Imibare 4–6 ifungura igenamiterere kuri iki gikoresho, no mu gihe nta interineti. Itandukanye n’ijambo ry’ibanga rya konti ya email.</p>
        <form onSubmit={finishSignIn}>
          <PinField label={existingDevicePin ? 'Umubare usanzwe' : 'Hitamo umubare'} value={pin} setValue={setPin} autoComplete={existingDevicePin ? 'current-password' : 'new-password'} disabled={busy} />
          {!existingDevicePin && <PinField label="Ongera uwandike" value={confirmation} setValue={setConfirmation} autoComplete="new-password" disabled={busy} />}
          {feedback}
          <button className="button-primary parent-submit" disabled={busy}>{busy ? 'Birimo kurangiza…' : existingDevicePin ? 'Komeza' : 'Bika kandi ukomeze'}</button>
        </form>
        <button type="button" className="parent-text-button" onClick={() => navigate('login')} disabled={busy}>Subira kwinjira</button>
      </div> : step === 'verify' ? <>
        <div className="email-verify-card">
          <span className="email-verify-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" />
          </svg></span>
          <p className="email-address">{address}</p>
          <p>{usesCode ? 'Niba wakiriye kode y’imibare 6 ya Vuga, yandike hano.' : 'Fungura email ya Vuga, ukande ihuza ryo kwemeza.'}</p>
        </div>
        {feedback}
        {usesCode ? <form onSubmit={verify}>
          <EmailCodeField value={code} setValue={setCode} disabled={busy} />
          <button className="button-primary parent-submit" disabled={busy}>{busy ? 'Birimo kugenzurwa…' : 'Emeza email'}</button>
        </form> : <button type="button" className="button-primary parent-submit" disabled={busy} onClick={() => navigate('login')}>Nemeje email, komeza</button>}
        <p className="email-help">Ntibiragera? Reba muri spam. Email ishobora gutinda iminota mike.</p>
        {usesCode ? <button type="button" className="parent-text-button" disabled={busy || !!remaining} onClick={resend}>
          {remaining ? `Saba indi kode (${remaining}s)` : 'Saba indi kode'}
        </button> : resendOpen ? <form className="email-resend-form" onSubmit={resend}>
          <PasswordField value={password} setValue={setPassword} disabled={busy} />
          <button className="button-outline parent-submit" disabled={busy || !!remaining}>{busy ? 'Birimo koherezwa…' : remaining ? `Ohereza indi email (${remaining}s)` : 'Ohereza indi email'}</button>
        </form> : <button type="button" className="parent-text-button" disabled={busy || !!remaining}
          onClick={() => { setResendOpen(true); setError(''); setNote('') }}>
          {remaining ? `Ongera wohereze email (${remaining}s)` : 'Ongera wohereze email'}
        </button>}
        {usesCode && <button type="button" className="parent-text-button" onClick={() => navigate('login')} disabled={busy}>Mfite konti, injira</button>}
        <button type="button" className="parent-text-button" onClick={() => navigate('register')} disabled={busy}>Hindura email</button>
      </> : step === 'reset' && usesCode ? <EmailPasswordReset initialEmail={email} onBusyChange={setBusy}
        onBack={() => navigate('login')} onDone={destination => { navigate('login'); setEmail(destination); setNote('Ijambo ry’ibanga ryahinduwe. Injira muri konti.') }} /> : <>
        {step === 'reset' && <p className="email-help">Tuzohereza ihuza ryo guhindura ijambo ry’ibanga rya konti.</p>}
        <form onSubmit={step === 'register' ? register : step === 'reset' ? reset : signIn}>
          {(step === 'register' || (step === 'login' && needsName)) && <NameField value={name} setValue={setName} disabled={busy} hint={false} />}
          <EmailField value={email} setValue={setEmail} disabled={busy} />
          {step === 'register' && normalizeEmailAddress(email) && <button type="button" className="parent-text-button" disabled={busy} onClick={() => navigate('login')}>Mfite konti, injira</button>}
          {step !== 'reset' && <PasswordField key={step} value={password} setValue={setPassword} creating={step === 'register'} disabled={busy} />}
          {step === 'register' && <PasswordField label="Ongera wandike ijambo ry’ibanga rya konti" value={repeatPassword} setValue={setRepeatPassword} creating showRequirements={false} disabled={busy} />}
          {step === 'login' && <button type="button" className="parent-text-button email-forgot" disabled={busy} onClick={() => navigate('reset')}>Nibagiwe ijambo ry’ibanga</button>}
          {feedback}
          <button className="button-primary parent-submit" disabled={busy}>{busy ? (step === 'login' ? 'Birimo kwinjira…' : 'Birimo koherezwa…')
            : step === 'register' ? 'Fungura konti ukoresheje email' : step === 'reset' ? 'Ohereza ihuza' : 'Injira muri konti'}</button>
        </form>
        {step === 'reset' && <button type="button" className="parent-text-button" disabled={busy} onClick={() => navigate('login')}>Subira kwinjira</button>}
      </>}
    </>}
    <div className="email-footer">
      {onSkip && <button type="button" className="parent-text-button" onClick={() => { navigate('login'); onSkip() }} disabled={busy}>Komeza nta konti</button>}
      <a href="/privacy.html" target="_blank" rel="noreferrer">Uko Vuga ibika amakuru</a>
    </div>
    {emailAuth.provider !== 'neon' && <details className="email-alternatives"><summary>Ubundi buryo bwo kwinjira</summary>
      <button type="button" className="parent-text-button" onClick={() => { navigate('login'); onLegacy?.() }} disabled={busy}>Koresha konti ya nimero ya telefoni</button>
    </details>}
  </div>
}
