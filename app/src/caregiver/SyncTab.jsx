import { useEffect, useState } from 'react'
import { API_BASE, api, getLinkedAccount, getToken } from '../server/api-client.js'
import { syncPending } from '../server/sync.js'
import { accountBackupState, connectAccount, replaceAccountCopy, restoreFromAccount, saveToAccount } from '../server/account-backup.js'
import { displayPhone } from '../server/phone.js'
import RecoveryCode from '../parent-access/RecoveryCode.jsx'
import { resetParentPinWithAccount, unlockParentAccess } from '../parent-access/parent-access.js'
import { countPendingUploads, exportLocalData } from '../storage/messages.js'
import { saveServerProfiles } from '../storage/profiles.js'
import { getVocabulary, setVocabulary } from '../storage/vocabulary.js'
import { userError } from '../shared/errors-rw.js'
import { Heading, clearValidation, requiredCode } from './components.jsx'

// Data leaves the device only when the adult chooses: a JSON download, an upload of completed
// messages of server profiles owned by the signed-in account (FR7), or, once signed in, the
// account backup that brings children's boards set up here to a new phone or tablet.
const when = iso => new Date(iso).toLocaleString('rw-RW', { dateStyle: 'medium', timeStyle: 'short' })
const brought = result => (result.profiles ? `imyirondoro ${result.profiles} n’igenamiterere ryayo` : 'igenamiterere ry’ikibaho')
const restoredText = (result, updated) => `${updated ? 'Ibyo wahinduye ku kindi gikoresho byazanywe kuri iki gikoresho' : 'Ibyo wabitse kuri konti byagarutse kuri iki gikoresho'}: ${brought(result)}.`

// How this device and the account's copy differ, by child code, before the caregiver chooses.
function Differences({ value }) {
  if (!value) return null
  const rows = [
    value.onlyAccount.length && `Abana bari kuri konti gusa: ${value.onlyAccount.join(', ')}`,
    value.onlyHere.length && `Abana bari kuri iki gikoresho gusa: ${value.onlyHere.join(', ')}`,
    value.changed.length && `Abana bafite amashusho cyangwa igenamiterere bitandukanye: ${value.changed.join(', ')}`,
    value.device && 'Igenamiterere rusange riratandukanye: uburyo bw’ikibaho, umwana ufunguye, ijwi cyangwa ikibaho cy’igerageza.'
  ].filter(Boolean)
  return <ul className="account-backup-differences" aria-label="Ibitandukanye">{rows.map(row => <li key={row}>{row}</li>)}</ul>
}

// The Vuga account this device is linked to, by the number given at the first setup or in Kwinjira.
// Signed out, the caregiver signs in again with the PIN. When the account's PIN was changed on
// another device, this device takes that PIN too, with a new recovery code.
function AccountSignIn({ onSignedIn, onOpenAccess }) {
  const [account, setAccount] = useState(undefined), [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [recovery, setRecovery] = useState('')
  useEffect(() => { getLinkedAccount().then(setAccount).catch(() => setAccount(null)) }, [])
  async function signIn(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await api.login(account.phone, pin)
      if ((await unlockParentAccess(pin)).ok) await onSignedIn()
      else setRecovery((await resetParentPinWithAccount(pin, pin)).recoveryCode)
    } catch (failure) { setError(userError(failure, 'Kwinjira ntibyashobotse. Ongera ugerageze.')) }
    finally { setBusy(false) }
  }
  if (recovery) return <div className="card"><h2>Umubare w’ibanga mushya kuri iki gikoresho</h2>
    <p className="muted">Iki gikoresho ubu gikoresha umubare w’ibanga wa konti yawe. Bika kode nshya yo kuwugarura.</p>
    <RecoveryCode code={recovery} onDone={async () => { setRecovery(''); await onSignedIn() }} done="Nayibitse" /></div>
  if (account === undefined) return null
  if (!account?.phone) return <div className="card"><h2>Konti ya Vuga<small>Konti yo kuri seriveri si ngombwa</small></h2>
    <p className="muted">Iki gikoresho ntikirahuzwa na nimero ya telefoni. Ongeraho nimero yawe muri «Kwinjira» kugira ngo ibyo washyizeho bibikwe kuri konti yawe, kandi ubibone no ku bindi bikoresho.</p>
    <button className="primary" onClick={onOpenAccess}>Jya muri Kwinjira</button></div>
  return <form className="card" onSubmit={signIn}>
    <h2>Injira<small>Konti ya {displayPhone(account.phone)}</small></h2>
    <p className="muted">{account.stale ? 'Umubare w’ibanga wa konti yawe wahinduwe ku kindi gikoresho. Andika uwo mushya.' : 'Andika umubare w’ibanga wawe kugira ngo wongere winjire kuri konti yawe.'}</p>
    <label>Umubare w’ibanga<input type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} value={pin} onChange={event => setPin(event.target.value)} disabled={busy}
      onInvalid={event => event.currentTarget.setCustomValidity('Koresha imibare ine kugeza kuri itandatu gusa.')} onInput={clearValidation} autoComplete="current-password" required /></label>
    {error && <p role="alert" className="dash-form-error">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Birimo guhuza…' : 'Injira'}</button>
  </form>
}

export default function SyncTab({ online, setError, onDeviceRestored, onNavigate }) {
  const [authed, setAuthed] = useState(false)
  const [pending, setPending] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [serverCode, setServerCode] = useState('')
  // The account copy: when it was last saved, and whether this device keeps it up to date or must
  // first choose between the account's set-up and its own (`differences`).
  const [backup, setBackup] = useState(null)
  const [backupMessage, setBackupMessage] = useState('')
  const count = () => countPendingUploads().then(setPending).catch(e => setError(userError(e)))
  useEffect(() => {
    getToken().then(async token => {
      setAuthed(!!token)
      if (!token) return
      const state = await accountBackupState()
      if (state) setBackup({ saved_at: state.saved_at, choose: false })
      // Online, the account says whether another device saved since. If the server cannot be
      // reached, a device that keeps the copy just shows its last save.
      if (navigator.onLine) await withBusy(connect, { quietIfUnreachable: !!state })
    }).catch(e => setError(userError(e)))
    count()
  }, [])

  async function connect() {
    const result = await connectAccount()
    if (result.action === 'restored' || result.action === 'updated') {
      await onDeviceRestored?.()
      setBackupMessage(restoredText(result, result.action === 'updated'))
    } else if (result.action === 'saved') setBackupMessage('Ibyo washyizeho kuri iki gikoresho byabitswe kuri konti yawe.')
    setBackup({ saved_at: result.saved_at, choose: result.action === 'choose', differences: result.differences })
  }
  const restore = () => withBusy(async () => {
    const result = await restoreFromAccount()
    await onDeviceRestored?.()
    setBackup({ saved_at: result.saved_at, choose: false })
    setBackupMessage(`Ibyo kuri konti byagaruwe kuri iki gikoresho: ${brought(result)}.`)
  })
  const replace = () => {
    if (!window.confirm('Ibyo wabitse kuri konti bizasimburwa n’ibyo kuri iki gikoresho. Urabyemeza?')) return
    return withBusy(async () => {
      const status = await replaceAccountCopy()
      setBackup({ saved_at: status.saved_at, choose: false })
      setBackupMessage('Ibyo kuri iki gikoresho ni byo ubu biri kuri konti yawe.')
    })
  }
  const saveNow = () => withBusy(async () => {
    const status = await saveToAccount()
    if (!status) { setBackupMessage('Ntibyabitswe. Reba ko ufite interineti kandi winjiye kuri konti.'); return }
    if (status.conflict) {
      await connect()
      setBackupMessage('Ntibyabitswe: konti yawe ifite ibyahinduwe ku kindi gikoresho. Hitamo ibyo ugumana.')
      return
    }
    setBackup({ saved_at: status.saved_at, choose: false })
    setBackupMessage(status.unchanged ? 'Nta gishya cyo kubika: konti ifite ibiri kuri iki gikoresho.' : 'Byabitswe kuri konti yawe.')
  })

  async function importProfiles() {
    const profiles = await api.profiles()
    for (const profile of profiles) {
      if (await getVocabulary(profile.profile_id) === null) {
        const vocabulary = await api.vocabulary(profile.profile_id)
        await setVocabulary(profile.profile_id, vocabulary.map(symbol => symbol.key))
      }
    }
    await saveServerProfiles(profiles)
    setMessage(`Imyirondoro ${profiles.length} ya seriveri iraboneka mu gice cy’Abana. Amashusho yari yaratoranyijwe kuri iki gikoresho yagumishijweho.`)
  }
  async function withBusy(task, { quietIfUnreachable = false } = {}) {
    setBusy(true); setError('')
    try { await task() } catch (e) {
      // The server ended the session (the PIN changed, or it expired): sign in again below.
      if (e.status === 401) { setAuthed(false); setBackup(null) }
      // A request that never reached the server has no status.
      if (!(quietIfUnreachable && !e.status)) setError(userError(e))
    } finally { setBusy(false) }
  }
  const fetchProfiles = () => withBusy(importProfiles)
  const createServerProfile = event => {
    event.preventDefault()
    return withBusy(async () => { await api.createProfile(serverCode.trim().toUpperCase(), null); setServerCode(''); await importProfiles() })
  }
  const upload = () => withBusy(async () => {
    const result = await syncPending(API_BASE, await getToken())
    setMessage(result.skipped ? 'Nta interineti: nta butumwa bwoherejwe.' : `Ubutumwa bwoherejwe: ${result.accepted_messages ?? 0}; ubwabanje kwakirwa: ${result.duplicates ?? 0}; ubwagumye kuri iki gikoresho: ${result.skipped_local ?? 0}.${result.remaining ? ` Haracyasigaye ubutumwa ${result.remaining} bwo kohereza; ongera ukande Ohereza ubu.` : ''}`)
    await count()
  })
  async function download() {
    try {
      const data = await exportLocalData()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `vuga-ubutumwa-${new Date().toISOString().slice(0, 10)}.json`
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Ubutumwa bwakuwe kuri iki gikoresho. Bika neza dosiye wabonye.')
    } catch (e) { setError(userError(e)) }
  }

  return <><Heading eyebrow="Ohereza" title="Ni wowe uhitamo uko amakuru akoreshwa.">Ubutumwa buguma kuri iki gikoresho kugeza igihe uhisemo kubukuramo cyangwa kohereza ubwa konti yawe kuri seriveri.</Heading>
    <div className="two">
      <div className="card">
        <h2>Amakuru yo kuri iki gikoresho</h2>
        <p className="big">{pending}<small>ubutumwa bwarangiye butaroherezwa</small></p>
        <p className="muted">Imyirondoro y’igerageza n’iyakozwe kuri iki gikoresho biguma hano. Iyo ukanze kohereza, hoherezwa gusa ubutumwa bw’imyirondoro yo kuri seriveri iri muri konti winjiyemo. Ubutumwa burimo amagambo mashya wongeyeho buguma kuri iki gikoresho.</p>
        <button className="primary" onClick={upload} disabled={!online || !authed || busy || !pending}>Ohereza ubu</button>
        <button className="ghost" onClick={download} disabled={busy}>Kuramo ubutumwa bwo kuri iki gikoresho</button>
        <p className="muted">Dosiye ikubiyemo kode z’abana n’ibikorwa byo gutegura ubutumwa. Nta magambobanga cyangwa amajwi yafashwe birimo.</p>
        {message && <p role="status">{message}</p>}
      </div>
      {!authed ? <AccountSignIn onSignedIn={async () => { setAuthed(true); await withBusy(connect); await fetchProfiles() }} onOpenAccess={() => onNavigate?.('access')} /> : <div className="card">
        <h2>Konti yo kuri seriveri<small>Winjiye kuri iki gikoresho</small></h2>
        <button className="ghost" disabled={busy || !online} onClick={fetchProfiles}>Zana imyirondoro ya konti yanjye</button>
        <button className="ghost" disabled={busy} onClick={async () => { try { await api.logout(); setAuthed(false); setBackup(null); setBackupMessage('') } catch (e) { setError(userError(e)) } }}>Sohoka</button>
        <section className="account-backup" aria-label="Ibibitswe kuri konti">
          <h3>Ibibitswe kuri konti</h3>
          <p className="muted">Abana bafite kode nka P-01, amashusho yabo, igenamiterere ry’ikibaho, aho umwana ari, amagambo akurikira n’uburyo bw’umwana bibikwa kuri konti yawe igihe usubiye ku kibaho. Winjiye kuri iyi konti kuri telefoni cyangwa tablet nshya, biragaruka. Amazina y’abana, amagambo mashya n’amafoto yayo, amajwi yafashwe, ubutumwa n’umubare w’ibanga ntibijyamo: biguma kuri iki gikoresho.</p>
          {backup?.choose ? <>
            <p className="account-backup-when">Konti yawe ifite ibyo wabitse ku wa {when(backup.saved_at)}, kandi iki gikoresho na cyo gifite ibyacyo. Hitamo ibyo ugumana.</p>
            <Differences value={backup.differences} />
            <button className="primary" disabled={busy || !online} onClick={restore}>Garura ibyo kuri konti</button>
            <button className="ghost" disabled={busy || !online} onClick={replace}>Bika ibyo kuri iki gikoresho kuri konti</button>
            <p className="muted">«Garura ibyo kuri konti»: ibyo kuri konti bisimbura ibyo kuri iki gikoresho ku bana bari kuri byombi, abandi bana bakagumaho. «Bika ibyo kuri iki gikoresho kuri konti»: konti isigarana ibyo kuri iki gikoresho gusa.</p>
          </> : <>
            <p className="account-backup-when">{backup?.saved_at ? `Byabitswe bwa nyuma: ${when(backup.saved_at)}` : 'Ntibirabikwa kuri konti.'}</p>
            <button className="primary" disabled={busy || !online || !backup} onClick={saveNow}>Bika ubu</button>
            <button className="ghost" disabled={busy || !online || !backup?.saved_at} onClick={restore}>Garura ibyo kuri konti</button>
          </>}
          {backupMessage && <p role="status">{backupMessage}</p>}
        </section>
        <form onSubmit={createServerProfile}>
          <label>Kora umwirondoro kuri seriveri<small>Kode y’umwana gusa; iyi kode yoherezwa kuri konti yawe yo kuri seriveri.</small><input value={serverCode} onChange={e => setServerCode(e.target.value)} onInvalid={requiredCode} onInput={clearValidation} placeholder="P-01" maxLength={5} pattern="[A-Za-z]-[0-9]{2,3}" required /></label>
          <button className="primary" disabled={busy || !online}>Bika umwirondoro kuri seriveri</button>
        </form>
      </div>}
    </div></>
}
