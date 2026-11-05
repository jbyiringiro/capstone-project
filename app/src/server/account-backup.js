// Keeps the caregiver's device on their Vuga account (storage/backup.js) and brings it back on a
// new phone or tablet. A device saves to an account only after it has joined that account's copy,
// by receiving it or by being the first to save, so a new device never overwrites a saved set-up.
// Each save names the revision of the copy it builds on. When another device saved in between,
// the server refuses the save (409): a device that changed nothing since takes the newer copy,
// and a device that changed something waits for the caregiver to choose.
import { db } from '../storage/db.js'
import { backupDifferences, backupFingerprint, createBackup, isNewDevice, noDifferences, restoreBackup } from '../storage/backup.js'
import { api, getLinkedAccount, getToken } from './api-client.js'
import { accountIdentity, sameAccount } from './account-identity.js'
import { childTables } from '../storage/profiles.js'
import { localizedError } from '../shared/errors-rw.js'

const JOINED = 'account-backup'

// A network round trip may outlive logout or an account switch in another tab. Pin every request
// to its original bearer, and check that link again before applying data or remembering a revision.
const accountChanged = () => localizedError('Konti ihujwe n’iki gikoresho yahindutse. Ongera ufungure «Ohereza» kuri konti yawe.')
async function context() {
  return db.transaction('r', db.settings, async () => {
    const account = await getLinkedAccount(), token = await getToken()
    if (!account || !token) throw accountChanged()
    return { account, token }
  })
}
async function check(link) {
  if (!sameAccount(await getLinkedAccount(), link.account) || await getToken() !== link.token) throw accountChanged()
}
async function request(link, task) {
  await check(link)
  const result = await task(link.token)
  await check(link)
  return result
}
async function restore(link, snapshot) {
  return db.transaction('rw', childTables(), async () => {
    await check(link)
    return restoreBackup(snapshot)
  })
}

async function joined() {
  const [state, account] = await Promise.all([db.settings.get(JOINED), getLinkedAccount()])
  return state?.value && sameAccount(state.value, account) ? state.value : null
}
async function remember(link, fingerprint, saved_at, revision) {
  await db.transaction('rw', db.settings, async () => {
    await check(link)
    await db.settings.put({ key: JOINED, value: { ...accountIdentity(link.account), fingerprint, saved_at, revision } })
  })
}
async function upload(link, snapshot, base) {
  const status = await request(link, token => api.saveBackup(snapshot, base, token))
  // The server may know deletions this device has not received, even after a caregiver chose
  // to keep this device's copy. Apply those tombstones without overwriting edits made locally
  // while the request was in flight. Never mark a filtered-out child as successfully joined.
  const saved = await request(link, token => api.loadBackup(token))
  const deleted = [...new Set([...(snapshot.data.deleted ?? []), ...(saved.data.deleted ?? [])])].sort()
  const restored = deleted.length ? await restore(link, { format: saved.format, data: { profiles: [], vocabulary: [], settings: [], deleted } }) : null
  const gone = new Set(deleted)
  const accepted = { ...snapshot, data: {
    ...snapshot.data,
    profiles: snapshot.data.profiles.filter(profile => !gone.has(profile.profile_id)),
    vocabulary: snapshot.data.vocabulary.filter(row => !gone.has(row.profile_id)),
    settings: snapshot.data.settings.filter(({ key, value }) => key.includes(':') ? !gone.has(key.slice(key.indexOf(':') + 1))
      : key !== 'profile' || !value || !gone.has(value.profile_id)),
    ...(deleted.length ? { deleted } : {})
  } }
  const fingerprint = await backupFingerprint(accepted)
  // Another save can land before the GET returns. Keep the revision THIS request wrote;
  // the next connection must still fetch any newer settings instead of silently joining them.
  await remember(link, fingerprint, status.saved_at, status.revision)
  return restored?.removed ? { ...status, removed: restored.removed } : status
}
const changedSince = async state => (await backupFingerprint(await createBackup())) !== state.fingerprint

export const accountBackupState = joined

// Saves this device to the account it has joined when something changed since the last save.
// Signed out, offline or not joined, it does nothing. When another device saved in between, nothing
// is replaced: the result says `conflict`, and Ohereza asks the caregiver.
export async function saveToAccount(link) {
  const state = await joined()
  if (!state || !(await getToken()) || globalThis.navigator?.onLine === false) return null
  link ??= await context()
  await check(link)
  if (!sameAccount(state, link.account)) throw accountChanged()
  const snapshot = await createBackup()
  if (await backupFingerprint(snapshot) === state.fingerprint) return { saved_at: state.saved_at, revision: state.revision, unchanged: true }
  try {
    return await upload(link, snapshot, state.revision ?? 0)
  } catch (error) {
    if (error.status !== 409) throw error
    return { conflict: true, saved_at: error.reply?.saved_at ?? null, revision: error.reply?.revision ?? null }
  }
}

// Brings the account's copy onto this device. The device then holds that copy, plus any child the
// account did not have yet; if it holds more, the account keeps both from now on.
export async function restoreFromAccount(link) {
  link ??= await context()
  const saved = await request(link, token => api.loadBackup(token))
  const restored = await restore(link, saved)
  const snapshot = await createBackup()
  const fingerprint = await backupFingerprint(snapshot)
  if (fingerprint === await backupFingerprint(saved)) await remember(link, fingerprint, saved.saved_at, saved.revision)
  else await upload(link, snapshot, saved.revision)
  return { ...restored, saved_at: saved.saved_at }
}

// The caregiver keeps this device's set-up and replaces the account's copy with it, whichever
// revision that copy has reached.
export async function replaceAccountCopy() {
  const link = await context()
  const { revision } = await request(link, token => api.backupStatus(token))
  return upload(link, await createBackup(), revision)
}

// What differs between this device and the account's copy, by child, for the caregiver to choose.
export async function accountDifferences(link) {
  link ??= await context()
  const [here, saved] = await Promise.all([createBackup(), request(link, token => api.loadBackup(token))])
  return { differences: backupDifferences(here.data, saved.data), saved }
}

async function choose(link) {
  const { differences, saved } = await accountDifferences(link)
  // Children deleted here that the account has not heard of go up with this device's copy; the
  // account adds them to its own list, so this replaces nothing else.
  if (noDifferences(differences) && differences.deletions) {
    const status = await upload(link, await createBackup(), saved.revision)
    return { action: status.removed ? 'updated' : 'saved', ...status }
  }
  // The same set-up on both sides: this device simply joins the account's copy.
  if (noDifferences(differences)) {
    await remember(link, await backupFingerprint(await createBackup()), saved.saved_at, saved.revision)
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
  const link = await context()
  const [state, status] = await Promise.all([joined(), request(link, token => api.backupStatus(token))])
  if (!status.saved_at) {
    const saved = await upload(link, await createBackup(), status.revision)
    return { action: saved.removed ? 'updated' : 'saved', ...saved }
  }
  if (state && state.revision === status.revision) {
    const saved = await saveToAccount(link)
    return saved?.conflict ? choose(link) : { action: saved?.removed ? 'updated' : 'joined', ...saved }
  }
  if (state && !(await changedSince(state))) return { action: 'updated', ...(await restoreFromAccount(link)) }
  if (!state && await isNewDevice()) return { action: 'restored', ...(await restoreFromAccount(link)) }
  return choose(link)
}
