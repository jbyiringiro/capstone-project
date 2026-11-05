import { useEffect, useRef, useState } from 'react'
import { api } from '../server/api-client.js'
import { normalisePhone } from '../server/phone.js'
import { codeSentText, usePhoneCode } from '../server/use-phone-code.js'
import { ParentAccessError, getParentPinVersion, recoverParentPin, resetParentPinWithAccount, validParentPin } from './parent-access.js'
import { Cooldown, PasswordField, PinField, SmsCodeField, TextField, WRONG_CODE, errorText, usePinForm } from './forms.jsx'

const masked = phone => (phone.length > 3 ? `${'•'.repeat(Math.min(phone.length - 3, 7))}${phone.slice(-3)}` : phone)

// A forgotten PIN: the recovery code written down at setup, or a code texted to the number of the
// Vuga account linked to this device. Both set a new PIN and show a new recovery code; no child's
// data is touched. Through the account, the new PIN is the account's too.
export default function ForgotPin({ status, account, onRecovered, onBack }) {
  const ways = [status.recoverable && 'code', account && 'account'].filter(Boolean)
  const [way, setWay] = useState(ways[0] ?? null)
  const [secret, setSecret] = useState(''), [sending, setSending] = useState(false)
  const [resetNote, setResetNote] = useState('')
  const form = usePinForm(), first = useRef(null), sms = usePhoneCode()
  const emailAccount = !!account?.email
  const phone = account?.phone ? normalisePhone(account.phone) ?? account.phone : null
  useEffect(() => { form.setLockedUntil(status.retryAfterMs ? Date.now() + status.retryAfterMs : 0) }, [])
  useEffect(() => { setSecret(''); form.setError(''); first.current?.focus() }, [way, sms.sentTo])
  async function sendCode() {
    setSending(true); form.setError('')
    try { await sms.send(phone, 'reset') } catch (failure) {
      // Without SMS, the recovery code written down at setup still works on this device.
      const noSms = !failure?.status || failure.status === 502 || failure.status === 503
      form.setError(errorText(failure) + (noSms && ways.includes('code') ? ' Ushobora no gukoresha kode yo kugarura wanditse.' : ''))
    } finally { setSending(false) }
  }
  const recover = event => form.submit(event, way === 'code'
    ? () => recoverParentPin(secret, form.pin, form.confirmation)
    : async () => {
      // Checked before the server is asked, so a typing slip does not cost a trip to it.
      if (!validParentPin(form.pin)) throw new ParentAccessError('format')
      if (form.pin !== form.confirmation) throw new ParentAccessError('mismatch')
      if (emailAccount) {
        // Fresh proof must belong to the exact linked Vuga user, not just any verified email user.
        const gate = await getParentPinVersion()
        const session = await api.reauthenticateEmail(account.email, secret, account)
        return resetParentPinWithAccount(form.pin, form.confirmation, { account, token: session.access_token, gate })
      }
      if (!/^\d{6}$/.test(secret)) throw new ParentAccessError('smscode')
      await api.resetPin(phone, secret, form.pin)
      await api.login(phone, form.pin)
      return resetParentPinWithAccount(form.pin, form.confirmation)
    }, result => onRecovered(result.recoveryCode), WRONG_CODE)
  const accountText = way !== 'account' ? ''
    : emailAccount ? `Injira muri konti ya ${account.email} ihujwe n’iki gikoresho. Ijambo ry’ibanga rya konti ntirihinduka; uhindura umubare w’ibanga w’iki gikoresho gusa. Bisaba interineti.`
      : sms.sentTo ? codeSentText(sms.delivery, masked(phone))
      : `Tuzohereza kode muri SMS kuri ${masked(phone)}, nimero ya konti ya Vuga ihujwe n’iki gikoresho. Umubare w’ibanga mushya uzaba n’uwa konti yawe. Bisaba interineti.`
  async function resetEmailPassword() {
    setSending(true); form.setError(''); setResetNote('')
    try {
      await api.requestEmailPasswordReset(account.email)
      setResetNote('Niba iyi email ifite konti, izakira ubutumwa bwo guhindura ijambo ry’ibanga. Reba no muri spam, uhindure ijambo ry’ibanga, hanyuma ugaruke hano.')
    } catch (failure) { form.setError(errorText(failure)) }
    finally { setSending(false) }
  }
  return <>
    <h1 id="parent-access-title">Shyiraho umubare w’ibanga mushya.</h1>
    {!way ? <div className="parent-setup-note"><b>Nta buryo bwo kuwugarura buri kuri iki gikoresho.</b>
      <p>Nta kode yo kugarura cyangwa konti ya Vuga bihujwe n’iki gikoresho. Uwashyizeho umubare w’ibanga ni we wawuhindura. Gusiba amakuru ya mushakisha bisiba umubare w’ibanga n’amakuru yose y’abana ari kuri iki gikoresho, keretse ibyabitswe kuri konti ya Vuga.</p></div> : <>
      {ways.length > 1 && <div className="parent-ways" role="group" aria-label="Uburyo bwo kugarura">
        <button type="button" aria-pressed={way === 'code'} onClick={() => setWay('code')}>Kode yo kugarura</button>
        <button type="button" aria-pressed={way === 'account'} onClick={() => setWay('account')}>Konti ya Vuga</button>
      </div>}
      <p>{way === 'code' ? 'Andika kode wahawe igihe washyiragaho umubare w’ibanga.' : accountText}</p>
      {way === 'account' && !emailAccount && !sms.sentTo ? <>
        {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
        <button ref={first} type="button" className="button-primary parent-submit" disabled={sending} onClick={sendCode}>{sending ? 'Birimo kohereza…' : 'Ohereza kode'}</button>
      </> : <form onSubmit={recover}>
        {way === 'code'
          ? <TextField label="Kode yo kugarura" value={secret} setValue={setSecret} inputRef={first} disabled={form.busy || !!form.remaining} className="parent-code-field" />
          : emailAccount ? <PasswordField value={secret} setValue={setSecret} inputRef={first} disabled={form.busy || sending} />
            : <SmsCodeField value={secret} setValue={setSecret} inputRef={first} disabled={form.busy} />}
        <PinField label="Umubare w’ibanga mushya" value={form.pin} setValue={form.setPin} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
        <PinField label="Ongera wandike umubare w’ibanga mushya" value={form.confirmation} setValue={form.setConfirmation} autoComplete="new-password" disabled={form.busy || !!form.remaining} />
        {form.error && <p role="alert" className="parent-form-error">{form.error}</p>}
        <Cooldown form={form} />
        <button className="button-primary parent-submit" disabled={form.busy || !!form.remaining}>{form.busy ? 'Birimo kugenzurwa…' : 'Shyiraho umubare mushya'}</button>
      </form>}
      {way === 'account' && sms.sentTo && <button type="button" className="parent-text-button" disabled={!!sms.wait || sending || form.busy} onClick={sendCode}>
        {sms.wait ? `Saba indi kode (${sms.wait})` : 'Saba indi kode'}</button>}
      {way === 'account' && emailAccount && <>
        {resetNote && <p role="status">{resetNote}</p>}
        <button type="button" className="parent-text-button" disabled={sending || form.busy} onClick={resetEmailPassword}>{sending ? 'Birimo kohereza…' : 'Nibagiwe ijambo ry’ibanga rya konti'}</button>
      </>}
    </>}
    <button type="button" className="parent-text-button" onClick={onBack}>Subira inyuma</button>
  </>
}
