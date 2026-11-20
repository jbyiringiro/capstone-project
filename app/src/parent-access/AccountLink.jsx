import { useEffect, useRef, useState } from 'react'
import { api } from '../server/api-client.js'
import { connectAccount } from '../server/account-backup.js'
import { displayPhone, normalisePhone } from '../server/phone.js'
import { codeSentText, usePhoneCode } from '../server/use-phone-code.js'
import { localizedError } from '../shared/errors-rw.js'
import { ParentAccessError, unlockParentAccess, validParentPin } from './parent-access.js'
import { NameField, PhoneField, PinField, SmsCodeField, WRONG_PIN, caregiverName, errorText } from './forms.jsx'
import EmailAccountLink from './EmailAccountLink.jsx'

// Brings the account's copy onto this device, or saves this device to the account, and says what
// happened. Without internet the copy simply waits for the next time.
export async function connectBackup(onDeviceRestored) {
  try {
    const result = await connectAccount()
    if (result.action === 'restored' || result.action === 'updated') {
      await onDeviceRestored?.()
      return `Ibyo wabitse kuri konti byagarutse kuri iki gikoresho: ${result.profiles ? `imyirondoro ${result.profiles} n’igenamiterere ryayo` : 'igenamiterere ry’ikibaho'}.`
    }
    if (result.action === 'saved') return 'Ibyo washyizeho kuri iki gikoresho byabitswe kuri konti yawe.'
    if (result.action === 'choose') return 'Konti yawe n’iki gikoresho byombi bifite ibyo mwashyizeho: hitamo ibyo ugumana muri «Ohereza».'
    return ''
  } catch { return 'Ibyo kuri konti bizahuzwa n’iki gikoresho ubutaha hari interineti.' }
}

// Links this device to a caregiver's Vuga account by mobile number. A new number gets a code by SMS,
// the caregiver's own name and a PIN: the one chosen here, or the device's own when it already has
// one (`devicePin`). A number that has an account signs in with its PIN, and a forgotten PIN is
// replaced with a new code. `onLinked` gets the number, the PIN and whether the account already existed.
export default function AccountLink(props) {
  const [legacy, setLegacy] = useState(false)
  const [legacyBusy, setLegacyBusy] = useState(false)
  return legacy ? <>
    <PhoneAccountLink {...props} onBusyChange={setLegacyBusy} />
    <button type="button" className="parent-text-button" disabled={legacyBusy} onClick={() => setLegacy(false)}>Koresha email</button>
  </> : <EmailAccountLink {...props} onLegacy={() => setLegacy(true)} />
}

function PhoneAccountLink({ devicePin = false, onLinked, onSkip, onBusyChange }) {
  const [step, setStep] = useState('number') // number | new | existing | reset
  const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [name, setName] = useState('')
  const [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const sms = usePhoneCode(), first = useRef(null)
  const number = sms.sentTo ?? normalisePhone(phone)
  useEffect(() => { setCode(''); setPin(''); setConfirmation(''); setError(''); if (step !== 'number') first.current?.focus() }, [step])
  async function run(event, task) {
    event?.preventDefault(); setBusy(true); onBusyChange?.(true); setError('')
    try { await task() } catch (failure) {
      // A request that never reached the server, or a server that cannot text codes, leaves the way
      // without a number open.
      const unavailable = failure?.localized && (!failure.status || failure.status === 503 || failure.status === 502)
      setError(errorText(failure) + (unavailable && onSkip ? ' Ushobora no gukomeza nta nimero.' : ''))
    } finally { setBusy(false); onBusyChange?.(false) }
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
    if (!/^\d{6}$/.test(code)) throw new ParentAccessError('smscode')
    const caregiver = caregiverName(name)
    if (!caregiver) throw new ParentAccessError('name')
    if (devicePin) {
      const local = await unlockParentAccess(pin)
      if (!local.ok) throw localizedError(local.retryAfterMs ? `Wagerageje kenshi. Tegereza amasegonda ${Math.ceil(local.retryAfterMs / 1000)}, wongere ugerageze.` : WRONG_PIN)
    } else newPin()
    await api.register(sms.sentTo, code, pin, caregiver)
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
      <p className="parent-access-note">Nimero ikoreshwa gusa kohereza kode no kwinjira. Abana bamenyekana kuri seriveri kuri kode gusa; amazina, amafoto n’amajwi biguma kuri iki gikoresho. <a href="/privacy.html" target="_blank" rel="noreferrer">Uko Vuga ibika amakuru</a></p>
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
    <p role="status">{codeSentText(sms.delivery, displayPhone(sms.sentTo))}</p>
    <form onSubmit={creating ? create : reset}>
      <SmsCodeField value={code} setValue={setCode} inputRef={first} disabled={busy} />
      {creating && <NameField value={name} setValue={setName} disabled={busy} />}
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
