import { useEffect, useState } from 'react'
import { api, getLinkedAccount } from '../server/api-client.js'
import { displayPhone } from '../server/phone.js'
import { localizedError } from '../shared/errors-rw.js'
import {
  ParentAccessError, changeParentPin, getParentAccessStatus, renewRecoveryCode, resetParentPinWithAccount, unlockParentAccess,
  validParentPin
} from './parent-access.js'
import AccountLink, { connectBackup } from './AccountLink.jsx'
import RecoveryCode from './RecoveryCode.jsx'
import { Cooldown, MESSAGES, PinField, usePinForm } from './forms.jsx'
import './parent-access.css'

const ACCOUNT_PIN_DIFFERS = 'Konti yawe ntiyemeye umubare w’ibanga usanzwe: ushobora kuba warawuhinduye ku kindi gikoresho. Subira ku kibaho, ukande «Nibagiwe umubare w’ibanga».'

// Kwinjira in the caregiver area: the device's link to the caregiver's number, a new PIN and a new
// recovery code.
export default function ParentPinSettings({ onDeviceRestored }) {
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
