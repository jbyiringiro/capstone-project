import { useEffect, useRef, useState } from 'react'
import { api } from '../server/api-client.js'
import { ParentAccessError } from './parent-access.js'
import { EmailCodeField, EmailField, PasswordField, errorText } from './forms.jsx'

// Neon uses a six-digit code, including for recovery. Share the complete flow
// between sign-in, forgotten device PIN, and caregiver account settings.
export default function EmailPasswordReset({ initialEmail = '', readOnly = false, onDone, onBack, onBusyChange }) {
  const [email, setEmail] = useState(initialEmail), [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [completing, setCompleting] = useState(false)
  const [until, setUntil] = useState(0), [now, setNow] = useState(Date.now())
  const submitting = useRef(false), codeInput = useRef(null)
  const remaining = Math.max(0, Math.ceil((until - now) / 1000))
  useEffect(() => {
    if (!until) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [until])
  useEffect(() => { if (sentTo) codeInput.current?.focus() }, [sentTo])
  async function run(event, task) {
    event?.preventDefault()
    if (submitting.current) return
    submitting.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try { await task() } catch (failure) {
      if (failure.passwordReset === true) { setCompleting(true); setCode('') }
      if (failure.code === 'too-many-requests') { setNow(Date.now()); setUntil(Date.now() + 60_000) }
      setError(errorText(failure))
    } finally { submitting.current = false; setBusy(false); onBusyChange?.(false) }
  }
  const send = event => run(event, async () => {
    if (until > Date.now()) return
    const address = (sentTo || email).trim().toLowerCase()
    await api.requestEmailPasswordReset(address)
    setSentTo(address); setCode(''); setNow(Date.now()); setUntil(Date.now() + 60_000)
  })
  const confirm = event => run(event, async () => {
    if (!completing && !/^\d{6}$/.test(code)) throw new ParentAccessError('emailcode')
    if (password.length < 8) throw new ParentAccessError('password')
    if (password !== repeat) throw new ParentAccessError('passwordmismatch')
    if (completing) await api.finishEmailPasswordReset(sentTo, password)
    else await api.confirmEmailPasswordReset(sentTo, code, password)
    setCode(''); setPassword(''); setRepeat('')
    onDone?.(sentTo)
  })
  return <section className="email-password-reset" aria-label="Hindura ijambo ry’ibanga rya konti" aria-busy={busy}>
    <p className="email-help">{sentTo ? <>Niba <b className="email-address">{sentTo}</b> ifite konti, twakoherereje kode. Reba no muri spam.</>
      : 'Tuzohereza kode yo guhindura ijambo ry’ibanga muri email yawe.'}</p>
    <form onSubmit={sentTo ? confirm : send}>
      {sentTo ? <>
        {!completing && <EmailCodeField value={code} setValue={setCode} disabled={busy} inputRef={codeInput} />}
        <PasswordField label="Ijambo ry’ibanga rishya" value={password} setValue={setPassword} disabled={busy} creating hint="Nibura inyuguti 8." />
        <PasswordField label="Ongera wandike ijambo ry’ibanga rishya" value={repeat} setValue={setRepeat} disabled={busy} creating />
      </> : <EmailField value={email} setValue={setEmail} disabled={busy} readOnly={readOnly} />}
      {error && <p role="alert" className="parent-form-error">{error}</p>}
      <button className="button-primary parent-submit" disabled={busy || (!sentTo && !!remaining)}>{busy ? 'Birimo gukorwa…' : completing ? 'Rangiza guhindura ijambo ry’ibanga' : sentTo ? 'Bika ijambo ry’ibanga rishya' : remaining ? `Ohereza kode (${remaining}s)` : 'Ohereza kode'}</button>
    </form>
    {sentTo && !completing && <button type="button" className="parent-text-button" disabled={busy || !!remaining} onClick={send}>{remaining ? `Saba indi kode (${remaining}s)` : 'Saba indi kode'}</button>}
    <button type="button" className="parent-text-button" disabled={busy} onClick={onBack}>Subira inyuma</button>
  </section>
}
