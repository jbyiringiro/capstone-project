import { useEffect, useId, useRef, useState } from 'react'
import { normalisePhone } from '../server/phone.js'
import { userError } from '../shared/errors-rw.js'

// The pieces every parent-access form shares: its messages, fields, the cooldown notice and usePinForm.
const NAME_MAX = 120 // users.name on the server
export const MESSAGES = {
  format: 'Koresha imibare ine kugeza kuri itandatu gusa.',
  mismatch: 'Imibare wanditse ntihuye. Ongera uyandike.',
  configured: 'Umubare w’ibanga wamaze gushyirwaho. Subira ku kibaho, wongere winjire.',
  changed: 'Umubare w’ibanga wahindutse. Subira ku kibaho, wongere winjire.',
  unconfigured: 'Umubare w’ibanga nturashyirwaho. Subira ku kibaho, wongere winjire.',
  norecovery: 'Uyu mubare w’ibanga washyizweho nta kode yo kugarura. Koresha konti ya Vuga.',
  recoveryformat: 'Kode yo kugarura ifite inyuguti n’imibare 16, nka ABCD-EFGH-JKLM-NPQR.',
  smscode: 'Andika kode y’imibare 6 twakoherereje muri SMS.',
  emailcode: 'Andika kode y’imibare 6 twakoherereje muri email.',
  name: `Andika izina ryawe nk’umurezi, inyuguti zitarenze ${NAME_MAX}.`,
  password: 'Hitamo ijambo ry’ibanga rya konti rifite nibura inyuguti 8.',
  passwordmismatch: 'Amagambo y’ibanga wanditse ntahuye. Ongera uyandike.',
  'email-unverified': 'Banza ufungure email twakoherereje, wemeze aderesi yawe, hanyuma wongere winjire.',
  'email-unavailable': 'Konti za email ntiziraboneka ubu. Ushobora gukomeza ukoresheje iki gikoresho gusa.',
  crypto: 'Mushakisha ntishobora kubika umubare w’ibanga. Koresha urubuga rufite HTTPS cyangwa ufungurire porogaramu kuri iki gikoresho.',
  storage: 'Ntibyashobotse gusoma cyangwa kubika umubare w’ibanga. Reba niba mushakisha yemerewe kubika amakuru.'
}
export const errorText = error => MESSAGES[error?.code] || userError(error, MESSAGES.storage)
export const WRONG_PIN = 'Umubare w’ibanga si wo. Ongera ugerageze.'
export const WRONG_CODE = 'Kode yo kugarura si yo. Ongera ugerageze.'
const NO_PHONE = 'Andika nimero ya telefoni yawe.'
const WRONG_PHONE = 'Andika nimero ya telefoni igendanwa yo mu Rwanda, nka 0788 123 456.'

export function PinField({ label, value, setValue, autoComplete, disabled, inputRef }) {
  return <label className="parent-pin-field">{label}<input ref={inputRef} type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6}
    value={value} onChange={event => setValue(event.target.value)} autoComplete={autoComplete} disabled={disabled} required
    onInput={event => event.currentTarget.setCustomValidity('')}
    onInvalid={event => event.currentTarget.setCustomValidity(MESSAGES.format)} />
  </label>
}

export function TextField({ label, value, setValue, type = 'text', autoComplete = 'off', disabled, inputRef, className = '', ...input }) {
  return <label className={`parent-pin-field ${className}`}>{label}<input ref={inputRef} type={type} value={value} onChange={event => setValue(event.target.value)}
    autoComplete={autoComplete} autoCapitalize="characters" spellCheck={false} disabled={disabled} required {...input} /></label>
}

// The browser holds the form back until the number is a Rwandan mobile number.
export function PhoneField({ value, setValue, disabled, inputRef }) {
  return <label className="parent-pin-field parent-phone-field">Nimero ya telefoni<small>Telefoni igendanwa yo mu Rwanda, nka 0788 123 456</small>
    <input ref={inputRef} type="tel" value={value} disabled={disabled} required inputMode="tel" autoComplete="tel"
      onChange={event => { setValue(event.target.value); event.target.setCustomValidity(event.target.value && !normalisePhone(event.target.value) ? WRONG_PHONE : '') }}
      onInvalid={event => { if (event.currentTarget.validity.valueMissing) event.currentTarget.setCustomValidity(NO_PHONE) }} /></label>
}

// The adult's own name for a new account, in any script, with its spaces tidied; null if it is
// empty or too long. It is the account's name on the server, never a child's.
export function caregiverName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ')
  return name && name.length <= NAME_MAX && !/\p{Cc}/u.test(name) ? name : null
}

export function NameField({ value, setValue, disabled, inputRef, hint = true }) {
  return <label className="parent-pin-field parent-name-field">Izina ryawe (umurezi){hint && <small>Izina ryawe bwite, si iry’umwana. Rigaragara kuri konti yawe.</small>}
    <input ref={inputRef} type="text" value={value} disabled={disabled} required maxLength={NAME_MAX} autoComplete="name" autoCapitalize="words"
      onChange={event => { setValue(event.target.value); event.target.setCustomValidity('') }}
      onInvalid={event => event.currentTarget.setCustomValidity(MESSAGES.name)} /></label>
}

export function EmailField({ value, setValue, disabled, inputRef, readOnly = false }) {
  return <TextField label="Email" type="email" value={value} setValue={setValue} disabled={disabled} inputRef={inputRef}
    className="parent-email-field" autoComplete="email" autoCapitalize="none" inputMode="email" maxLength={254} readOnly={readOnly} />
}

// Cloud passwords are never constrained to, or confused with, the local numeric PIN.
export function PasswordField({ value, setValue, disabled, inputRef, creating = false, label = 'Ijambo ry’ibanga rya konti', hint }) {
  const id = useId(), [visible, setVisible] = useState(false)
  // Each field owns its reveal control; clearing a password hides it again.
  useEffect(() => { if (!value) setVisible(false) }, [value])
  return <div className="parent-pin-field parent-password-field">
    <label htmlFor={id}>{label}</label>
    <div className="parent-password-input">
      <input id={id} ref={inputRef} type={visible ? 'text' : 'password'} value={value} onChange={event => setValue(event.target.value)}
        disabled={disabled} required autoComplete={creating ? 'new-password' : 'current-password'} autoCapitalize="none" spellCheck={false}
        minLength={creating ? 8 : undefined} aria-describedby={hint ? `${id}-hint` : undefined} />
      <button type="button" className="parent-password-toggle" disabled={disabled} aria-pressed={visible}
        aria-label={`${visible ? 'Hisha' : 'Erekana'}: ${label}`} onClick={() => setVisible(current => !current)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
    {hint && <small id={`${id}-hint`} className="parent-field-hint">{hint}</small>}
  </div>
}

const smsDigits = value => value.replace(/\D/g, '').slice(0, 6)
export function SmsCodeField({ value, setValue, disabled, inputRef }) {
  return <TextField label="Kode twakoherereje" value={value} setValue={next => setValue(smsDigits(next))} inputRef={inputRef} disabled={disabled}
    className="parent-code-field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" />
}

export function EmailCodeField({ value, setValue, disabled, inputRef }) {
  return <TextField label="Kode yo muri email" value={value} setValue={next => setValue(smsDigits(next))} inputRef={inputRef} disabled={disabled}
    className="parent-code-field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
    onInput={event => event.currentTarget.setCustomValidity('')}
    onInvalid={event => event.currentTarget.setCustomValidity(MESSAGES.emailcode)} />
}

export function usePinForm() {
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

export const Cooldown = ({ form }) => !!form.remaining && <p role="status" className="parent-form-error">Wagerageje kenshi. Tegereza amasegonda {form.remaining}, wongere ugerageze.</p>
