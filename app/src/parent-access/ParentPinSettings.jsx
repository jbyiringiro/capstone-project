import { useEffect, useState } from 'react'
import { api, getLinkedAccount } from '../server/api-client.js'
import { emailAuth } from '../server/email-auth.js'
import { displayPhone } from '../server/phone.js'
import { localizedError } from '../shared/errors-rw.js'
import {
  ParentAccessError, changeParentPin, getParentAccessStatus, renewRecoveryCode, resetParentPinWithAccount, unlockParentAccess,
  validParentPin
} from './parent-access.js'
import AccountLink, { connectBackup } from './AccountLink.jsx'
import RecoveryCode from './RecoveryCode.jsx'
import EmailPasswordReset from './EmailPasswordReset.jsx'
import { Cooldown, MESSAGES, PasswordField, PinField, errorText, usePinForm } from './forms.jsx'
import './parent-access.css'

const ACCOUNT_PIN_DIFFERS = 'Konti yawe ntiyemeye umubare w’ibanga usanzwe: ushobora kuba warawuhinduye ku kindi gikoresho. Subira ku kibaho, ukande «Nibagiwe umubare w’ibanga».'

// Kwinjira in the caregiver area: the device's link to the caregiver's number, a new PIN and a new
// recovery code.
export default function ParentPinSettings({ onDeviceRestored }) {
  const form = usePinForm(), [currentPin, setCurrentPin] = useState(''), [status, setStatus] = useState('')
  const codeForm = usePinForm(), [recovery, setRecovery] = useState(''), [recoverable, setRecoverable] = useState(null)
  const [account, setAccount] = useState(undefined), [linkNote, setLinkNote] = useState(''), [linkRecovery, setLinkRecovery] = useState('')
  const eraseForm = usePinForm(), [erasing, setErasing] = useState(false)
  const [erasePassword, setErasePassword] = useState(''), [resetBusy, setResetBusy] = useState(false), [resetError, setResetError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false), [unlinkBusy, setUnlinkBusy] = useState(false)
  const accountAddress = account?.email || (account?.phone ? displayPhone(account.phone) : '')
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
  // Erasing the account (the right to erasure) asks twice, then needs the account's PIN, which
  // counts towards its lock. Only once the server has erased it does this device forget the
  // account, its session and its account copy; it keeps its own children, words, recordings and PIN.
  const cancelErase = () => { setErasing(false); eraseForm.setPin(''); setErasePassword(''); eraseForm.setError('') }
  const erase = event => {
    if (!erasing) { event.preventDefault(); setLinkNote(''); setErasing(true); return }
    const address = accountAddress
    return eraseForm.submit(event, async () => {
      if (account.email) await api.deleteEmailAccount(account.email, erasePassword)
      else {
        if (!validParentPin(eraseForm.pin)) throw new ParentAccessError('format')
        await api.deleteAccount(account.phone, eraseForm.pin)
      }
      return { ok: true }
    }, () => {
      eraseForm.setPin(''); setErasePassword(''); setErasing(false); setAccount(null)
      setLinkNote(`Konti ya ${address} yasibwe kuri seriveri, hamwe n’ibyo yari ibitse byose. Iki gikoresho ntikigihujwe na yo; abana, amagambo, amajwi n’umubare w’ibanga biri kuri iki gikoresho biracyahari.`)
    })
  }
  // A number that already had an account brings its PIN, which becomes this device's PIN too.
  // Email accounts always keep the local PIN that AccountLink checked before linking.
  async function linked({ phone, email, user_id, auth_provider, pin, existing }) {
    const replaced = !email && existing ? await resetParentPinWithAccount(pin, pin) : null
    const backup = await connectBackup(onDeviceRestored)
    setAccount((await getLinkedAccount().catch(() => null)) ?? (email ? { email, user_id, auth_provider: auth_provider || emailAuth.provider } : { phone }))
    setLinkNote(`Iki gikoresho gihujwe na konti ya ${email || displayPhone(phone)}.${email ? ' Umubare w’ibanga w’iki gikoresho ntiwahindutse.' : existing ? ' Umubare w’ibanga wa konti ni wo ukoreshwa no kuri iki gikoresho.' : ''} ${backup}`.trim())
    if (replaced) { setLinkRecovery(replaced.recoveryCode); setRecoverable(true) }
  }
  async function resetEmailPassword() {
    if (emailAuth.verificationMethod === 'code') { setResetOpen(true); setLinkNote(''); setResetError(''); return }
    setResetBusy(true); setResetError(''); setLinkNote('')
    try {
      await api.requestEmailPasswordReset(account.email)
      setLinkNote('Niba iyi email ifite konti, izakira ubutumwa bwo guhindura ijambo ry’ibanga. Reba no muri spam. Umubare w’ibanga w’iki gikoresho ntuhinduka.')
    } catch (failure) { setResetError(errorText(failure)) }
    finally { setResetBusy(false) }
  }
  async function unlink() {
    if (!unlinking) { setUnlinking(true); return }
    setUnlinkBusy(true); setResetError('')
    try {
      await api.unlinkAccount()
      setAccount(null); setUnlinking(false); cancelErase()
      setLinkNote('Iki gikoresho ntikigihujwe na konti. Konti yo kuri seriveri ntiyasibwe. Abana, amajwi n’umubare w’ibanga biri kuri iki gikoresho biracyahari.')
    } catch (failure) { setResetError(errorText(failure)) }
    finally { setUnlinkBusy(false) }
  }
  return <section className="parent-settings"><p className="dash-eyebrow">Kwinjira kw’umurezi</p><h1>Umubare w’ibanga w’umurezi.</h1>
    <p>Iyo usubiye ku kibaho, ufunze porogaramu, cyangwa umaze iminota itanu ntacyo ukora, ahagenewe umurezi harafungwa. Kugira ngo wongere winjire bisaba umubare w’ibanga.</p>
    <section className="dash-card" aria-label="Konti y’umurezi"><h2>Konti y’umurezi</h2>
      {linkRecovery ? <><p role="status">{linkNote}</p><RecoveryCode code={linkRecovery} onDone={() => setLinkRecovery('')} done="Nayibitse" /></>
        : account?.email || account?.phone ? <>
          <p>Iki gikoresho gihujwe na konti ya Vuga ya {account.name ? <><b>{account.name}</b> ({accountAddress})</> : <b>{accountAddress}</b>}. {account.email ? 'Kwinjira kuri konti ku kindi gikoresho bisaba email n’ijambo ry’ibanga rya konti. Umubare w’ibanga w’imibare 4–6 urinda iki gikoresho gusa.' : 'Umubare w’ibanga wawe ni wo winjiza kuri iyo konti ku bindi bikoresho, kandi niwawibagirwa, uwuhindura ukoresheje SMS.'}</p>
          {linkNote && <p role="status">{linkNote}</p>}
          {account.email && <>
            {resetError && <p role="alert" className="parent-form-error">{resetError}</p>}
            {resetOpen ? <EmailPasswordReset initialEmail={account.email} readOnly onBusyChange={setResetBusy}
              onBack={() => setResetOpen(false)} onDone={() => { setResetOpen(false); setLinkNote('Ijambo ry’ibanga rya konti ryahinduwe. Umubare w’ibanga w’iki gikoresho ntiwahindutse.') }} />
              : <button type="button" className="parent-text-button" disabled={resetBusy || unlinkBusy || eraseForm.busy} onClick={resetEmailPassword}>{resetBusy ? 'Birimo kohereza…' : 'Hindura ijambo ry’ibanga rya konti ukoresheje email'}</button>}
            {unlinking && <p role="status">Guhagarika guhuza iki gikoresho na konti ntibisiba konti yo kuri seriveri cyangwa amakuru y’abana ari hano. Kubika no kugarura iby’iyi konti bizasaba kongera kwinjira.</p>}
            <button type="button" className="parent-text-button" disabled={unlinkBusy || resetBusy || eraseForm.busy} onClick={unlink}>{unlinkBusy ? 'Birimo guhagarikwa…' : unlinking ? 'Yego, hagarika guhuza iki gikoresho' : 'Hagarika guhuza iki gikoresho na konti'}</button>
            {unlinking && <button type="button" className="parent-text-button" disabled={unlinkBusy} onClick={() => setUnlinking(false)}>Reka, gumana konti ihujwe</button>}
          </>}
        </> : account === null && <>
          {linkNote && <p role="status">{linkNote}</p>}
          <p>Ongeraho konti ya email kugira ngo ibyo washyizeho bibikwe kuri konti yawe, ubibone no ku bindi bikoresho. Umubare w’ibanga w’iki gikoresho ntuhinduka.</p>
          <AccountLink devicePin onLinked={linked} />
        </>}
    </section>
    {(account?.email || account?.phone) && !linkRecovery && <form className="dash-card account-delete" onSubmit={erase} aria-labelledby="account-delete-title"><h2 id="account-delete-title">Siba konti yanjye</h2>
      <p><b>Bisibwa burundu kuri seriveri:</b> izina ryawe na {account.email ? 'email yawe, konti n’ijambo ry’ibanga byayo' : 'nimero yawe, umubare w’ibanga wa konti'}, abana bazwi kuri kode n’amagambo n’igenamiterere byabo, ubutumwa wohereje, n’ibyo wabitse kuri konti. Ku bindi bikoresho, kwinjira kuri iyi konti birahagarara.</p>
      <p><b>Biguma kuri iki gikoresho:</b> abana (amazina na kode), amashusho yabo, amagambo mashya n’amafoto yayo, amajwi wafashe, ubutumwa butaroherezwa, n’umubare w’ibanga ufungura ahagenewe umurezi. Nyuma yaho, konti yasibwe ntizongera kugufasha kugarura umubare w’ibanga: bika kode yo kugarura. <a href="/privacy.html" target="_blank" rel="noreferrer">Uko Vuga ibika amakuru</a></p>
      {erasing && <>
        <p role="status">Urashaka koko gusiba konti ya {account.name ? `${account.name} (${accountAddress})` : accountAddress}? Ntibishobora gusubizwa inyuma. Bisaba interineti.</p>
        {account.email ? <PasswordField value={erasePassword} setValue={setErasePassword} disabled={eraseForm.busy} />
          : <PinField label="Umubare w’ibanga wa konti" value={eraseForm.pin} setValue={eraseForm.setPin} autoComplete="current-password" disabled={eraseForm.busy || !!eraseForm.remaining} />}
      </>}
      {eraseForm.error && <p className="parent-form-error" role="alert">{eraseForm.error}</p>}
      <Cooldown form={eraseForm} />
      <div className="account-delete-actions">
        <button className="button-outline audio-delete" disabled={eraseForm.busy || !!eraseForm.remaining || unlinkBusy || resetBusy}>{eraseForm.busy ? 'Birimo gusibwa…' : erasing ? 'Siba konti burundu' : 'Siba konti yanjye'}</button>
        {erasing && <button type="button" className="button-outline" onClick={cancelErase} disabled={eraseForm.busy}>Reka, gumana konti</button>}
      </div>
    </form>}
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
    <p className="parent-local-note">Uyu mubare urinda ahagenewe umurezi kuri iki gikoresho. Nturinda amakuru umuntu ufite uburenganzira bwo guhindura cyangwa gusiba ububiko bwa mushakisha. Konti ya email ifite ijambo ry’ibanga ritandukanye n’uyu mubare.</p>
  </section>
}
