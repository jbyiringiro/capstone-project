// Keeps the caregiver's device on their Vuga account (storage/backup.js) and brings it back on a
// new phone or tablet. A device saves to an account only after it has joined that account's copy,
// by receiving it or by being the first to save, so a new device never overwrites a saved set-up.
// Each save names the revision of the copy it builds on. When another device saved in between,
// the server refuses the save (409): a device that changed nothing since takes the newer copy,
// and a device that changed something waits for the caregiver to choose.
import { db } from '../storage/db.js'
import { backupDifferences, backupFingerprint, createBackup, isNewDevice, noDifferences, restoreBackup } from '../storage/backup.js'
import { api, getLinkedAccount, getToken } from './api-client.js'
import { samePhone } from './phone.js'

const JOINED = 'account-backup'

async function joined() {
  const [state, account] = await Promise.all([db.settings.get(JOINED), getLinkedAccount()])
  return state?.value && account && samePhone(state.value.phone, account.phone) ? state.value : null
}
async function remember(fingerprint, saved_at, revision) {
  const account = await getLinkedAccount()
  await db.settings.put({ key: JOINED, value: { phone: account?.phone ?? null, fingerprint, saved_at, revision } })
}
async function upload(snapshot, base) {
  const fingerprint = await backupFingerprint(snapshot)
  const status = await api.saveBackup(snapshot, base)
  await remember(fingerprint, status.saved_at, status.revision)
  return status
}
const changedSince = async state => (await backupFingerprint(await createBackup())) !== state.fingerprint

export const accountBackupState = joined

// Saves this device to the account it has joined when something changed since the last save.
// Signed out, offline or not joined, it does nothing. When another device saved in between, nothing
// is replaced: the result says `conflict`, and Ohereza asks the caregiver.
export async function saveToAccount() {
  const state = await joined()
  if (!state || !(await getToken()) || globalThis.navigator?.onLine === false) return null
  const snapshot = await createBackup()
  if (await backupFingerprint(snapshot) === state.fingerprint) return { saved_at: state.saved_at, revision: state.revision, unchanged: true }
  try {
    return await upload(snapshot, state.revision ?? 0)
  } catch (error) {
    if (error.status !== 409) throw error
    return { conflict: true, saved_at: error.reply?.saved_at ?? null, revision: error.reply?.revision ?? null }
  }
}

// Brings the account's copy onto this device. The device then holds that copy, plus any child the
// account did not have yet; if it holds more, the account keeps both from now on.
export async function restoreFromAccount() {
  const saved = await api.loadBackup()
  const restored = await restoreBackup(saved)
  const snapshot = await createBackup()
  const fingerprint = await backupFingerprint(snapshot)
  if (fingerprint === await backupFingerprint(saved)) await remember(fingerprint, saved.saved_at, saved.revision)
  else await upload(snapshot, saved.revision)
  return { ...restored, saved_at: saved.saved_at }
}

// The caregiver keeps this device's set-up and replaces the account's copy with it, whichever
// revision that copy has reached.
export async function replaceAccountCopy() {
  const { revision } = await api.backupStatus()
  return upload(await createBackup(), revision)
}

// What differs between this device and the account's copy, by child, for the caregiver to choose.
export async function accountDifferences() {
  const [here, saved] = await Promise.all([createBackup(), api.loadBackup()])
  return { differences: backupDifferences(here.data, saved.data), saved }
}

async function choose() {
  const { differences, saved } = await accountDifferences()
  // The same set-up on both sides: this device simply joins the account's copy.
  if (noDifferences(differences)) {
    await remember(await backupFingerprint(await createBackup()), saved.saved_at, saved.revision)
    return { action: 'joined', saved_at: saved.saved_at }
  }
  return { action: 'choose', saved_at: saved.saved_at, differences }
}

// Run after signing in and whenever Ohereza opens. The action tells the caregiver what happened:
//  'saved'    the account had no copy, so this device's set-up is now on it;
//  'restored' a new device received everything from the account;
//  'updated'  another device saved changes, and this one had changed nothing since, so it took them;
//  'joined'   this device keeps the account's copy up to date;
//  'choose'   the account and this device both have changes, listed in `differences`, and the
//             caregiver chooses which to keep.
export async function connectAccount() {
  const [state, status] = await Promise.all([joined(), api.backupStatus()])
  if (!status.saved_at) return { action: 'saved', ...(await upload(await createBackup(), status.revision)) }
  if (state && state.revision === status.revision) {
    const saved = await saveToAccount()
    return saved?.conflict ? choose() : { action: 'joined', ...saved }
  }
  if (state && !(await changedSince(state))) return { action: 'updated', ...(await restoreFromAccount()) }
  if (!state && await isNewDevice()) return { action: 'restored', ...(await restoreFromAccount()) }
  return choose()
}
