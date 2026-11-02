// Keeps the caregiver's device on their Vuga account (storage/backup.js) and brings it back on a
// new phone or tablet. A device saves to an account only after it has joined that account's copy,
// by receiving it or by being the first to save, so a new device never overwrites a saved set-up.
import { db } from '../storage/db.js'
import { backupFingerprint, createBackup, isNewDevice, restoreBackup } from '../storage/backup.js'
import { api, getLinkedAccount, getToken } from './api-client.js'

const JOINED = 'account-backup'

async function joined() {
  const [state, account] = await Promise.all([db.settings.get(JOINED), getLinkedAccount()])
  return state?.value && account && state.value.phone === account.phone ? state.value : null
}
async function remember(fingerprint, saved_at) {
  const account = await getLinkedAccount()
  await db.settings.put({ key: JOINED, value: { phone: account?.phone ?? null, fingerprint, saved_at } })
}
async function upload(snapshot) {
  const fingerprint = await backupFingerprint(snapshot)
  const status = await api.saveBackup(snapshot)
  await remember(fingerprint, status.saved_at)
  return status
}

export const accountBackupState = joined

// Saves this device to the account it has joined when something changed since the last save.
// Signed out, offline or not joined, it does nothing.
export async function saveToAccount() {
  const state = await joined()
  if (!state || !(await getToken()) || globalThis.navigator?.onLine === false) return null
  const snapshot = await createBackup()
  if (await backupFingerprint(snapshot) === state.fingerprint) return { saved_at: state.saved_at, unchanged: true }
  return upload(snapshot)
}

export async function restoreFromAccount() {
  const fresh = await isNewDevice()
  const saved = await api.loadBackup()
  const restored = await restoreBackup(saved)
  // A new device now holds exactly the account's copy; a device with its own children holds both,
  // and the account keeps both from now on.
  const snapshot = await createBackup()
  if (fresh) await remember(await backupFingerprint(snapshot), saved.saved_at)
  else await upload(snapshot)
  return { ...restored, saved_at: saved.saved_at }
}

// The caregiver keeps this device's set-up and replaces the account's copy with it.
export const replaceAccountCopy = async () => upload(await createBackup())

// Run after signing in. The action tells the caregiver what happened:
//  'saved'    the account had no copy, so this device's set-up is now on it;
//  'restored' a new device received everything from the account;
//  'joined'   this device already keeps the account's copy up to date;
//  'choose'   the account and this device both have a set-up, and the caregiver chooses.
export async function connectAccount() {
  if (await joined()) return { action: 'joined', ...(await saveToAccount()) }
  const status = await api.backupStatus()
  if (!status.saved_at) return { action: 'saved', ...(await replaceAccountCopy()) }
  if (await isNewDevice()) return { action: 'restored', ...(await restoreFromAccount()) }
  return { action: 'choose', saved_at: status.saved_at }
}
