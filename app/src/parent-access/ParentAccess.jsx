import { useEffect, useRef, useState } from 'react'
import { Brand } from '../shared/ui.jsx'
import { api, getLinkedAccount, signInQuietly } from '../server/api-client.js'
import { connectAccount } from '../server/account-backup.js'
import { displayPhone, normalisePhone } from '../server/phone.js'
import { usePhoneCode } from '../server/use-phone-code.js'
import { localizedError, userError } from '../shared/errors-rw.js'
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
  smscode: 'Andika kode y’imibare 6 twakoherereje muri SMS.',
  crypto: 'Mushakisha ntishobora kubika umubare w’ibanga. Koresha urubuga rufite HTTPS cyangwa ufungurire porogaramu kuri iki gikoresho.',
  storage: 'Ntibyashobotse gusoma cyangwa kubika umubare w’ibanga. Reba niba mushakisha yemerewe kubika amakuru.'
}
const errorText = error => MESSAGES[error?.code] || userError(error, MESSAGES.storage)
const WRONG_PIN = 'Umubare w’ibanga si wo. Ongera ugerageze.'
const WRONG_CODE = 'Kode yo kugarura si yo. Ongera ugerageze.'
const NO_PHONE = 'Andika nimero ya telefoni yawe.'
const WRONG_PHONE = 'Andika nimero ya telefoni igendanwa yo mu Rwanda, nka 0788 123 456.'
const masked = phone => (phone.length > 3 ? `${'•'.repeat(Math.min(phone.length - 3, 7))}${phone.slice(-3)}` : phone)

function PinField({ label, value, setValue, autoComplete, disabled, inputRef }) {
  return <label className="parent-pin-field">{label}<input ref={inputRef} type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6}
    value={value} onChange={event => setValue(event.target.value)} autoComplete={autoComplete} disabled={disabled} required
    onInput={event => event.currentTarget.setCustomValidity('')}
    onInvalid={event => event.currentTarget.setCustomValidity(MESSAGES.format)} />
  </label>
}

function TextField({ label, value, setValue, type = 'text', autoComplete = 'off', disabled, inputRef, className = '', ...input }) {
  return <label className={`parent-pin-field ${className}`}>{label}<input ref={inputRef} type={type} value={value} onChange={event => setValue(event.target.value)}
    autoComplete={autoComplete} autoCapitalize="characters" spellCheck={false} disabled={disabled} required {...input} /></label>
}

// The browser holds the form back until the number is a Rwandan mobile number.
function PhoneField({ value, setValue, disabled, inputRef }) {
  return <label className="parent-pin-field parent-phone-field">Nimero ya telefoni<small>Telefoni igendanwa yo mu Rwanda, nka 0788 123 456</small>
    <input ref={inputRef} type="tel" value={value} disabled={disabled} required inputMode="tel" autoComplete="tel"
      onChange={event => { setValue(event.target.value); event.target.setCustomValidity(event.target.value && !normalisePhone(event.target.value) ? WRONG_PHONE : '') }}
      onInvalid={event => { if (event.currentTarget.validity.valueMissing) event.currentTarget.setCustomValidity(NO_PHONE) }} /></label>
}

const smsDigits = value => value.replace(/\D/g, '').slice(0, 6)
function SmsCodeField({ value, setValue, disabled, inputRef }) {
  return <TextField label="Kode twakoherereje" value={value} setValue={next => setValue(smsDigits(next))} inputRef={inputRef} disabled={disabled}
    className="parent-code-field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" />
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

// Brings the account's copy onto this device, or saves this device to the account, and says what
// happened. Without internet the copy simply waits for the next time.
async function connectBackup(onDeviceRestored) {
  try {
    const result = await connectAccount()
    if (result.action === 'restored') {
      await onDeviceRestored?.()
      return `Ibyo wabitse kuri konti byagarutse kuri iki gikoresho: igenamiterere ry’ikibaho, imyirondoro ${result.profiles}, amagambo mashya ${result.words}, amajwi ${result.recordings}.`
    }
    if (result.action === 'saved') return 'Ibyo washyizeho kuri iki gikoresho byabitswe kuri konti yawe.'
    if (result.action === 'choose') return 'Konti yawe n’iki gikoresho byombi bifite ibyo mwashyizeho: hitamo ibyo ugumana muri «Ohereza».'
    return ''
  } catch { return 'Ibyo kuri konti bizahuzwa n’iki gikoresho ubutaha hari interineti.' }
}

// Links this device to a caregiver's Vuga account by mobile number. A new number gets a code by SMS
// and a PIN: the one chosen here, or the device's own when it already has one (`devicePin`). A
// number that has an account signs in with its PIN, and a forgotten PIN is replaced with a new code.
// `onLinked` gets the number, the PIN and whether the account already existed.
export function AccountLink({ devicePin = false, onLinked, onSkip }) {
  const [step, setStep] = useState('number') // number | new | existing | reset
  const [phone, setPhone] = useState(''), [code, setCode] = useState('')
  const [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const sms = usePhoneCode(), first = useRef(null)
  const number = sms.sentTo ?? normalisePhone(phone)
  useEffect(() => { setCode(''); setPin(''); setConfirmation(''); setError(''); if (step !== 'number') first.current?.focus() }, [step])
  async function run(event, task) {
    event?.preventDefault(); setBusy(true); setError('')
    try { await task() } catch (failure) {
      // A request that never reached the server leaves the way without a number open.
      const unreachable = failure?.localized && !failure.status
      setError(errorText(failure) + (unreachable && onSkip ? ' Ushobora no gukomeza nta nimero.' : ''))
    } finally { setBusy(false) }
  }
  const newPin = () => {
    if (!validParentPin(pin)) throw new ParentAccessError('format')
    if (pin !== confirmation) throw new ParentAccessError('mismatch')
  }
  const askCode = event => run(event, async () => {
    try { await sms.send(number, 'register'); setStep('new') }
    catch (failure) { if (failure.status === 409) setStep('existing'); else throw failure }
  })
  const create = event => run(event, async () => {
    if (devicePin) {
      const local = await unlockParentAccess(pin)
      if (!local.ok) throw localizedError(local.retryAfterMs ? `Wagerageje kenshi. Tegereza amasegonda ${Math.ceil(local.retryAfterMs / 1000)}, wongere ugerageze.` : WRONG_PIN)
    } else newPin()
    if (!/^\d{6}$/.test(code)) throw new ParentAccessError('smscode')
    await api.register(sms.sentTo, code, pin)
    await api.login(sms.sentTo, pin)
    await onLinked({ phone: sms.sentTo, pin, existing: false })
  })
  const signIn = event => run(event, async () => {
    if (!validParentPin(pin)) throw new ParentAccessError('format')
    await api.login(number, pin)
    await onLinked({ phone: number, pin, existing: true })
  })
  const reset = event => run(event, async () => {
    newPin()
    if (!/^\d{6}$/.test(code)) throw new ParentAccessError('smscode')
    await api.resetPin(sms.sentTo, code, pin)
    await api.login(sms.sentTo, pin)
    await onLinked({ phone: sms.sentTo, pin, existing: true })
  })
  const restart = () => { sms.forget(); setStep('number') }
  const alert = error && <p role="alert" className="parent-form-error">{error}</p>
  const other = <button type="button" className="parent-text-button" onClick={restart} disabled={busy}>Hindura nimero</button>

  if (step === 'number') return <>
    <form onSubmit={askCode}>
      <PhoneField value={phone} setValue={setPhone} inputRef={first} disabled={busy} />
      {alert}
      <button className="button-primary parent-submit" disabled={busy}>{busy ? 'Birimo kohereza…' : 'Ohereza kode'}</button>
    </form>
    {onSkip && <button type="button" className="parent-text-button" onClick={onSkip} disabled={busy}>Komeza nta nimero</button>}
  </>

  if (step === 'existing') return <>
    <p role="status">Nimero {displayPhone(number)} isanzwe ifite konti ya Vuga. Andika umubare w’ibanga wayo kugira ngo iki gikoresho kiyihuze.</p>
    <form onSubmit={signIn}>
      <PinField label="Umubare w’ibanga wa konti" value={pin} setValue={setPin} inputRef={first} autoComplete="current-password" disabled={busy} />
      {alert}
      <button className="button-primary parent-submit" disabled={busy}>{busy ? 'Birimo kugenzurwa…' : 'Injira'}</button>
    </form>
    <button type="button" className="parent-text-button" disabled={busy} onClick={() => run(null, async () => { await sms.send(number, 'reset'); setStep('reset') })}>Nibagiwe umubare w’ibanga</button>
    {other}
  </>

  const creating = step === 'new'
  return <>
    <p role="status">Twohereje kode y’imibare 6 kuri {displayPhone(sms.sentTo)}. Imara iminota 10.</p>
    <form onSubmit={creating ? create : reset}>
      <SmsCodeField value={code} setValue={setCode} inputRef={first} disabled={busy} />
      {creating && devicePin
        ? <PinField label="Umubare w’ibanga usanzwe" value={pin} setValue={setPin} autoComplete="current-password" disabled={busy} />
        : <>
          <PinField label={creating ? 'Hitamo umubare w’ibanga' : 'Umubare w’ibanga mushya'} value={pin} setValue={setPin} autoComplete="new-password" disabled={busy} />
          <PinField label={creating ? 'Ongera wandike umubare w’ibanga' : 'Ongera wandike umubare w’ibanga mushya'} value={confirmation} setValue={setConfirmation} autoComplete="new-password" disabled={busy} />
        </>}
      {creating && devicePin && <p className="parent-access-note">Umubare w’ibanga w’iki gikoresho ni wo uzaba n’uwa konti yawe.</p>}
      {alert}
      <button className="button-primary parent-submit" disabled={busy}>{busy ? 'Birimo guhuza…' : creating ? 'Fungura konti' : 'Shyiraho umubare mushya'}</button>
    </form>
    <button type="button" className="parent-text-button" disabled={busy || !!sms.wait} onClick={() => run(null, () => sms.send(sms.sentTo, creating ? 'register' : 'reset'))}>
      {sms.wait ? `Saba indi kode (${sms.wait})` : 'Saba indi kode'}</button>
    {other}
  </>
}

// A forgotten PIN: the recovery code written down at setup, or a code texted to the number of the
// Vuga account linked to this device. Both set a new PIN and show a new recovery code; no child's
// data is touched. Through the account, the new PIN is the account's too.
function ForgotPin({ status, account, onRecovered, onBack }) {
  const ways = [status.recoverable && 'code', account && 'account'].filter(Boolean)
  const [way, setWay] = useState(ways[0] ?? null)
  const [secret, setSecret] = useState(''), [sending, setSending] = useState(false)
  const form = usePinForm(), first = useRef(null), sms = usePhoneCode()
  const phone = account ? normalisePhone(account.phone) ?? account.phone : null
  useEffect(() => { form.setLockedUntil(status.retryAfterMs ? Date.now() + status.retryAfterMs : 0) }, [])
  useEffect(() => { setSecret(''); form.setError(''); first.current?.focus() }, [way, sms.sentTo])
  async function sendCode() {
    setSending(true); form.setError('')
    try { await sms.send(phone, 'reset') } catch (failure) { form.setError(errorText(failure)) } finally { setSending(false) }
  }
  const recover = event => form.submit(event, way === 'code'
    ? () => recoverParentPin(secret, form.pin, form.confirmation)
    : async () => {
      // Checked before the server is asked, so a typing slip does not cost a trip to it.
      if (!validParentPin(form.pin)) throw new ParentAccessError('format')
      if (form.pin !== form.confirmation) throw new ParentAccessError('mismatch')
      if (!/^\d{6}$/.test(secret)) throw new ParentAccessError('smscode')
      await api.resetPin(phone, secret, form.pin)
      await api.login(phone, form.pin)
      return resetParentPinWithAccount(form.pin, form.confirmation)
    }, result => onRecovered(result.recoveryCode), WRONG_CODE)
  const accountText = way !== 'account' ? ''
    : sms.sentTo ? `Twohereje kode y’imibare 6 kuri ${masked(phone)}. Imara iminota 10.`
      : `Tuzohereza kode muri SMS kuri ${masked(phone)}, nimero ya konti ya Vuga ihujwe n’iki gikoresho. Umubare w’ibanga mushya uzaba n’uwa konti yawe. Bisaba interineti.`
  return <>
    <h1 id="parent-access-title">Shyiraho umubare w’ibanga mushya.</h1>
    {!way ? <div className="parent-setup-note"><b>Nta buryo bwo kuwugarura buri kuri iki gikoresho.</b>
      <p>Nta kode yo kugarura cyangwa konti ya Vuga bihujwe n’iki gikoresho. Uwashyizeho umubare w’ibanga ni we wawuhindura. Gusiba amakuru ya mushakisha bisiba umubare w’ibanga n’amakuru yose y’abana ari kuri iki gikoresho, keretse ibyabitswe kuri konti ya Vuga.</p></div> : <>
      {ways.length > 1 && <div className="parent-ways" role="group" aria-label="Uburyo bwo kugarura">
        <button type="button" aria-pressed={way === 'code'} onClick={() => setWay('code')}>Kode yo kugarura</button>
        <button type="button" aria-pressed={way === 'account'} onClick={() => setWay('account')}>Konti ya Vuga</button>
      </div>}
      <p>{way === 'code' ? 'Andika kode wahawe igihe washyiragaho umubare w’ibanga.' : accountText}</p>
      {way === 'account' && !sms.sentTo ? <>
        {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
        <button ref={first} type="button" className="button-primary parent-submit" disabled={sending} onClick={sendCode}>{sending ? 'Birimo kohereza…' : 'Ohereza kode'}</button>
      </> : <form onSubmit={recover}>
        {way === 'code'
          ? <TextField label="Kode yo kugarura" value={secret} setValue={setSecret} inputRef={first} disabled={form.busy || !!form.remaining} className="parent-code-field" />
          : <SmsCodeField value={secret} setValue={setSecret} inputRef={first} disabled={form.busy} />}
        <PinField label="Umubare w’ibanga mushya" value={form.pin} setValue={form.setPin} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
        <PinField label="Ongera wandike umubare w’ibanga mushya" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
        {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
        <Cooldown form={form} />
        <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : 'Shyiraho umubare mushya'}</button>
      </form>}
      {way === 'account' && sms.sentTo && <button type="button" className="parent-text-button" disabled={!!sms.wait || sending || form.busy} onClick={sendCode}>
        {sms.wait ? `Saba indi kode (${sms.wait})` : 'Saba indi kode'}</button>}
    </>}
    <button type="button" className="parent-text-button" onClick={onBack}>Subira inyuma</button>
  </>
}

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

const ACCOUNT_PIN_DIFFERS = 'Konti yawe ntiyemeye umubare w’ibanga usanzwe: ushobora kuba warawuhinduye ku kindi gikoresho. Subira ku kibaho, ukande «Nibagiwe umubare w’ibanga».'

export function ParentPinSettings({ onDeviceRestored }) {
  const form = usePinForm(), [currentPin, setCurrentPin] = useState(''), [status, setStatus] = useState('')
  const codeForm = usePinForm(), [recovery, setRecovery] = useState(''), [recoverable, setRecoverable] = useState(null)
  const [account, setAccount] = useState(undefined), [linkNote, setLinkNote] = useState(''), [linkRecovery, setLinkRecovery] = useState('')
  useEffect(() => {
    getParentAccessStatus().then(next => setRecoverable(next.recoverable)).catch(() => setRecoverable(null))
    getLinkedAccount().then(setAccount).catch(() => setAccount(null))
  }, [])
  const change = event => {
    if (!validParentPin(currentPin)) { event.preventDefault(); form.setError(MESSAGES.format); return }
    setStatus('')
    return form.submit(event, async () => {
      if (!validParentPin(form.pin)) throw new ParentAccessError('format')
      if (form.pin !== form.confirmation) throw new ParentAccessError('mismatch')
      if (account?.phone) {
        // The PIN is the account's too. The device checks it first and the account changes next, so a
        // refused change leaves both as they were.
        const local = await unlockParentAccess(currentPin)
        if (!local.ok) return local
        try { await api.changePin(account.phone, currentPin, form.pin) }
        catch (failure) { throw failure.status === 401 ? localizedError(ACCOUNT_PIN_DIFFERS) : failure }
      }
      return changeParentPin(currentPin, form.pin, form.confirmation)
    }, () => {
      setCurrentPin(''); form.setPin(''); form.setConfirmation('')
      setStatus(account?.phone ? 'Umubare w’ibanga wahinduwe kuri iki gikoresho no kuri konti yawe. Kode yo kugarura wanditse iracyakora.' : 'Umubare w’ibanga wahinduwe kuri iki gikoresho. Kode yo kugarura wanditse iracyakora.')
    })
  }
  const renew = event => codeForm.submit(event, () => renewRecoveryCode(codeForm.pin), result => {
    codeForm.setPin(''); setRecovery(result.recoveryCode); setRecoverable(true)
  })
  // A number that already had an account brings its PIN, which becomes this device's PIN too.
  async function linked({ phone, pin, existing }) {
    const replaced = existing ? await resetParentPinWithAccount(pin, pin) : null
    const backup = await connectBackup(onDeviceRestored)
    setAccount({ phone })
    setLinkNote(`Iki gikoresho gihujwe na konti ya ${displayPhone(phone)}.${existing ? ' Umubare w’ibanga wa konti ni wo ukoreshwa no kuri iki gikoresho.' : ''} ${backup}`.trim())
    if (replaced) { setLinkRecovery(replaced.recoveryCode); setRecoverable(true) }
  }
  return <section className="parent-settings"><p className="dash-eyebrow">Kwinjira kw’umurezi</p><h1>Umubare w’ibanga w’umurezi.</h1>
    <p>Iyo usubiye ku kibaho, ufunze porogaramu, cyangwa umaze iminota itanu ntacyo ukora, ahagenewe umurezi harafungwa. Kugira ngo wongere winjire bisaba umubare w’ibanga.</p>
    <section className="dash-card" aria-label="Nimero ya telefoni"><h2>Nimero ya telefoni</h2>
      {linkRecovery ? <><p role="status">{linkNote}</p><RecoveryCode code={linkRecovery} onDone={() => setLinkRecovery('')} done="Nayibitse" /></>
        : account?.phone ? <>
          <p>Iki gikoresho gihujwe na konti ya Vuga ya <b>{displayPhone(account.phone)}</b>. Umubare w’ibanga wawe ni wo winjiza kuri iyo konti ku bindi bikoresho, kandi niwawibagirwa, uwuhindura ukoresheje SMS.</p>
          {linkNote && <p role="status">{linkNote}</p>}
        </> : account === null && <>
          <p>Ongeraho nimero yawe kugira ngo ibyo washyizeho bibikwe kuri konti yawe, ubibone no ku bindi bikoresho, kandi niwibagirwa umubare w’ibanga, uwuhindure ukoresheje SMS.</p>
          <AccountLink devicePin onLinked={linked} />
        </>}
    </section>
    <form className="dash-card" onSubmit={change} aria-label="Hindura umubare w’ibanga"><h2>Hindura umubare w’ibanga</h2>
      {account?.phone && <p>Umubare mushya uzaba n’uwa konti yawe, bityo bisaba interineti.</p>}
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
    <p className="parent-local-note">Uyu mubare urinda ahagenewe umurezi kuri iki gikoresho. Nturinda amakuru umuntu ufite uburenganzira bwo guhindura cyangwa gusiba ububiko bwa mushakisha. Iyo iki gikoresho gihujwe na nimero yawe, ni na wo winjiza kuri konti yawe.</p>
  </section>
}
