import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { BACKUP_FORMAT, backupDifferences, createBackup, isNewDevice, restoreBackup } from '../../src/storage/backup.js'
import { DEFAULT_PREFERENCES, getBoardPreferences, saveBoardPreferences } from '../../src/storage/board-preferences.js'
import { addCustomSymbol, listCustomSymbols } from '../../src/storage/custom-symbols.js'
import { saveRecording } from '../../src/storage/recordings.js'
import { getVocabulary, setVocabulary } from '../../src/storage/vocabulary.js'
import { createLocalProfile, deleteProfile, getDeletedProfiles } from '../../src/storage/profiles.js'
import { startDraft } from '../../src/storage/messages.js'
import { PARENT_ACCESS_KEY, setupParentPin } from '../../src/parent-access/parent-access.js'
import { accountBackupState, connectAccount, replaceAccountCopy, restoreFromAccount, saveToAccount } from '../../src/server/account-backup.js'
import { api } from '../../src/server/api-client.js'

const clearDevice = () => Promise.all(db.tables.map(table => table.clear()))
const ACCOUNT = '+250780000001'

// One caregiver's device: a child known by a code, with hand-picked words, a place and a next-word
// list; a child the family calls by name; a custom word with its photo; a familiar-voice recording;
// and the PIN and sign-in. Only the coded child's board may go to the account.
async function setUpDevice() {
  await db.profiles.put({ profile_id: 'local-1', code: 'P-01', age_band: null, access_method: 'touch', local_only: true })
  await db.profiles.put({ profile_id: 'local-2', code: 'Keza', age_band: '4-6', access_method: 'touch', local_only: true })
  await db.settings.put({ key: 'profile', value: { profile_id: 'local-1', code: 'P-01' } })
  await db.settings.put({ key: 'mode', value: 'predictive' })
  await setVocabulary('local-1', ['I', 'WANT', 'WATER'])
  await setVocabulary('local-2', ['MUM'])
  await saveBoardPreferences('local-1', { environment: 'meal', relatedWords: true, relatedLists: { DRINK: ['MILK', 'CUP'] }, showLabels: false })
  await saveBoardPreferences('local-2', { environment: 'school' })
  const word = await addCustomSymbol({ label: 'Nyogokuru', category: 'people', image: new Blob([new Uint8Array([1, 2, 250, 255])], { type: 'image/webp' }) }, { profileId: 'local-1' })
  await saveRecording(word.symbol_id, new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/webm' }))
  await setupParentPin('5678', '5678')
  await db.settings.put({ key: 'token', value: 'secret-token' })
  await db.settings.put({ key: 'account', value: { phone: '0780000001' } })
  return word
}

beforeEach(async () => { await clearDevice(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('device backup', () => {
  it('carries a coded child’s words and settings to a new device, and never a name, photo, voice, PIN or sign-in', async () => {
    const word = await setUpDevice()
    const snapshot = JSON.parse(JSON.stringify(await createBackup()))
    expect(snapshot.format).toBe(BACKUP_FORMAT)
    expect(Object.keys(snapshot.data).sort()).toEqual(['profiles', 'settings', 'vocabulary'])
    expect(snapshot.data.profiles).toEqual([{ profile_id: 'local-1', code: 'P-01', age_band: null, access_method: 'touch', local_only: true }])
    expect(JSON.stringify(snapshot)).not.toMatch(/Keza|local-2|CUSTOM-|base64|parent-access|secret-token|0780000001|digest/)

    await clearDevice()
    expect(await isNewDevice()).toBe(true)
    expect(await restoreBackup(snapshot)).toEqual({ profiles: 1, removed: 0 })
    expect(await isNewDevice()).toBe(false)
    expect(await getVocabulary('local-1')).toEqual(['I', 'WANT', 'WATER'])
    expect(await getBoardPreferences('local-1')).toMatchObject({ environment: 'meal', relatedWords: true, relatedLists: { DRINK: ['MILK', 'CUP'] }, showLabels: false })
    expect((await db.settings.get('mode')).value).toBe('predictive')
    expect((await db.settings.get('profile')).value).toEqual({ profile_id: 'local-1', code: 'P-01' })
    expect(await listCustomSymbols()).toEqual([])
    expect(await db.recordings.count()).toBe(0)
    expect(await db.settings.get(PARENT_ACCESS_KEY)).toBeUndefined()
    expect(await db.settings.get('token')).toBeUndefined()
    expect(word.symbol_id).toMatch(/^CUSTOM-/)
  })

  it('leaves the open child out when the family calls that child by name', async () => {
    await setUpDevice()
    await db.settings.put({ key: 'profile', value: { profile_id: 'local-2', code: 'Keza' } })
    expect((await createBackup()).data.settings.map(setting => setting.key)).toEqual(['appearance:local-1', 'mode', 'vocabulary:local-1'])
  })

  it('sends settings an older version saved in the shape the account takes', async () => {
    await setUpDevice()
    await db.settings.put({ key: 'appearance:local-1', value: { illustratedSymbols: true, environment: 'meal', gridSize: 'large' } })
    await db.settings.put({ key: 'profile', value: { profile_id: 'local-1', code: 'P-01', created: '2026-09-21' } })
    const settings = Object.fromEntries((await createBackup()).data.settings.map(({ key, value }) => [key, value]))
    expect(settings['appearance:local-1']).toEqual({ ...DEFAULT_PREFERENCES, environment: 'meal' })
    expect(settings.profile).toEqual({ profile_id: 'local-1', code: 'P-01' })
  })

  it('replaces a restored child’s word list but keeps this device’s other children and custom words', async () => {
    const word = await setUpDevice()
    const snapshot = await createBackup()
    await setVocabulary('local-1', ['NO', word.symbol_id])
    await db.profiles.put({ profile_id: 'local-3', code: 'P-03', local_only: true })
    await restoreBackup(snapshot)
    expect(await getVocabulary('local-1')).toEqual(expect.arrayContaining(['I', 'WANT', 'WATER', word.symbol_id]))
    expect(await getVocabulary('local-1')).not.toContain('NO')
    expect(await db.profiles.get('local-3')).toMatchObject({ code: 'P-03' })
    expect(await db.profiles.get('local-2')).toMatchObject({ code: 'Keza' })
    expect(await listCustomSymbols()).toHaveLength(1)
  })

  it('refuses a damaged, older or named copy without changing the device', async () => {
    await setUpDevice()
    const snapshot = await createBackup()
    await expect(restoreBackup({ ...snapshot, format: 'vuga-account-backup-v1' })).rejects.toThrow('ntibisomeka')
    await expect(restoreBackup({ ...snapshot, data: { ...snapshot.data, settings: [{ key: PARENT_ACCESS_KEY, value: {} }] } })).rejects.toThrow('ntibisomeka')
    await expect(restoreBackup({ ...snapshot, data: { ...snapshot.data, profiles: [{ profile_id: 'local-5', code: 'Keza' }] } })).rejects.toThrow('ntibisomeka')
    expect(await db.settings.get(PARENT_ACCESS_KEY)).toBeDefined()
  })

  it('lists by child code what differs between this device and the account', async () => {
    await setUpDevice()
    const here = (await createBackup()).data
    const account = JSON.parse(JSON.stringify(here))
    // Key order is not a difference.
    account.profiles[0] = Object.fromEntries(Object.entries(account.profiles[0]).reverse())
    expect(backupDifferences(here, account)).toEqual({ onlyHere: [], onlyAccount: [], changed: [], removed: [], device: false, deletions: false })
    account.profiles.push({ profile_id: 'server-9', code: 'S-09', age_band: null, access_method: 'touch', local_only: false })
    account.vocabulary = account.vocabulary.filter(row => row.key !== 'WATER')
    account.settings.find(setting => setting.key === 'mode').value = 'static'
    await db.profiles.put({ profile_id: 'local-4', code: 'P-04', local_only: true })
    expect(backupDifferences((await createBackup()).data, account)).toEqual({ onlyHere: ['P-04'], onlyAccount: ['S-09'], changed: ['P-01'], removed: [], device: true, deletions: false })
  })
  it('lists a deleted coded child by id only, and a stale copy of the account never brings the child back', async () => {
    await setUpDevice()
    const child = await createLocalProfile('P-05')
    await setVocabulary(child.profile_id, ['I', 'WATER'])
    await saveBoardPreferences(child.profile_id, { environment: 'home' })
    const stale = await createBackup()
    expect(stale.data.deleted).toBeUndefined()
    await deleteProfile(child.profile_id)
    const after = await createBackup()
    expect(after.data.deleted).toEqual([child.profile_id])
    expect(JSON.stringify(after.data.deleted)).not.toContain('P-05')
    expect(after.data.profiles.map(profile => profile.code)).toEqual(['P-01'])
    // Restoring the copy saved before the deletion brings back neither the child nor their words or settings.
    expect(await restoreBackup(stale)).toEqual({ profiles: 1, removed: 0 })
    expect(await db.profiles.get(child.profile_id)).toBeUndefined()
    expect(await getVocabulary(child.profile_id)).toBeNull()
    expect(await db.settings.get(`appearance:${child.profile_id}`)).toBeUndefined()
    // A child the family calls by name never goes to the account, so nothing is listed for them.
    await deleteProfile('local-2')
    expect(await getDeletedProfiles()).toEqual([child.profile_id])
  })
  it('deletes on this device a child another device deleted, with only that child’s records', async () => {
    const word = await setUpDevice()
    const gone = await createLocalProfile('P-05'), kept = await createLocalProfile('P-06')
    for (const child of [gone, kept]) {
      await setVocabulary(child.profile_id, ['I', word.symbol_id])
      await saveBoardPreferences(child.profile_id, { environment: 'meal' })
      await startDraft(child.profile_id, 'static')
      await db.game_sessions.add({ profile_id: child.profile_id, rounds: [], stars: 0, finished_at: '2026-11-04T10:00:00Z' })
    }
    await db.settings.put({ key: 'profile', value: gone })
    const copy = await createBackup()
    copy.data.profiles = copy.data.profiles.filter(profile => profile.profile_id !== gone.profile_id)
    copy.data.deleted = [gone.profile_id]
    expect(await restoreBackup(copy)).toEqual({ profiles: 2, removed: 1 })
    expect(await db.profiles.get(gone.profile_id)).toBeUndefined()
    expect(await db.messages.where('profile_id').equals(gone.profile_id).count()).toBe(0)
    expect(await db.game_sessions.where('profile_id').equals(gone.profile_id).count()).toBe(0)
    expect((await db.settings.get('profile')).value).toBeNull()
    expect(await getDeletedProfiles()).toEqual([gone.profile_id])
    // The other children, the shared custom word and its recording stay.
    expect((await db.profiles.toArray()).map(profile => profile.code).sort()).toEqual(['Keza', 'P-01', 'P-06'])
    expect((await getVocabulary(kept.profile_id)).sort()).toEqual(['I', word.symbol_id].sort())
    expect(await db.messages.where('profile_id').equals(kept.profile_id).count()).toBe(1)
    expect(await db.custom_symbols.get(word.symbol_id)).toBeTruthy()
    expect(await db.recordings.get(word.symbol_id)).toBeTruthy()
  })
  it('shows a child deleted elsewhere as removed, never as missing from either side', async () => {
    await setUpDevice()
    const child = await createLocalProfile('P-05')
    const here = (await createBackup()).data
    const account = { ...JSON.parse(JSON.stringify(here)), deleted: [child.profile_id] }
    account.profiles = account.profiles.filter(profile => profile.profile_id !== child.profile_id)
    expect(backupDifferences(here, account)).toMatchObject({ onlyHere: [], onlyAccount: [], removed: ['P-05'], deletions: false })
    // Deleted here, still on an older account copy: not offered back, and not yet known to the account.
    await deleteProfile(child.profile_id)
    expect(backupDifferences((await createBackup()).data, here)).toEqual({ onlyHere: [], onlyAccount: [], changed: [], removed: [], device: false, deletions: true })
  })
})

// A stand-in for the Vuga API: one backup per signed-in account, saved only on its latest revision.
function fakeServer() {
  const copies = new Map(), uploads = []
  vi.stubGlobal('fetch', async (url, { method = 'GET', headers = {}, body } = {}) => {
    const path = new URL(url).pathname
    const json = (status, value) => ({ ok: status < 300, status, json: async () => value })
    if (path === '/auth/login') return json(200, { access_token: `token:${new URLSearchParams(body).get('username')}` })
    const account = headers.Authorization?.replace('Bearer token:', '')
    if (!account) return json(401, {})
    const copy = copies.get(account)
    const status = () => (copy ? { saved_at: copy.saved_at, size: 1, revision: copy.revision } : { saved_at: null, size: 0, revision: 0 })
    if (path === '/backup/status') return json(200, status())
    if (path === '/backup' && method === 'GET') return copy ? json(200, copy) : json(404, {})
    if (path === '/backup' && method === 'PUT') {
      const { base_revision, ...snapshot } = JSON.parse(body)
      if (base_revision !== (copy?.revision ?? 0)) return json(409, { detail: 'the account copy changed on another device', ...status() })
      const saved = { ...snapshot, revision: base_revision + 1, saved_at: new Date(Date.now() + uploads.length * 1000).toISOString() }
      copies.set(account, saved); uploads.push(account)
      return json(200, { saved_at: saved.saved_at, size: body.length, revision: saved.revision })
    }
    return json(404, {})
  })
  return { copies, uploads }
}

// Another device saves a change to the account's copy.
function savedElsewhere(server, revision, change) {
  const copy = JSON.parse(JSON.stringify(server.copies.get(ACCOUNT)))
  change(copy.data)
  server.copies.set(ACCOUNT, { ...copy, revision, saved_at: `2026-11-03T0${revision}:00:00.000Z` })
}
const setting = (data, key) => data.settings.find(entry => entry.key === key)

describe('account backup', () => {
  it('saves a set-up device to an empty account, then only when something it keeps changed', async () => {
    const server = fakeServer()
    await setUpDevice()
    await api.login('0780000001', 'secret1')
    expect(await connectAccount()).toMatchObject({ action: 'saved', revision: 1 })
    expect(await saveToAccount()).toMatchObject({ unchanged: true })
    await saveBoardPreferences('local-1', { ...(await getBoardPreferences('local-1')), environment: 'school' })
    expect(await saveToAccount()).toMatchObject({ revision: 2 })
    expect(setting(server.copies.get(ACCOUNT).data, 'appearance:local-1').value.environment).toBe('school')
    // The named child stays on the device, so a change to that child sends nothing.
    await saveBoardPreferences('local-2', { ...(await getBoardPreferences('local-2')), environment: 'home' })
    expect(await saveToAccount()).toMatchObject({ unchanged: true })
    expect(server.uploads).toHaveLength(2)
  })

  it('brings a coded child to a new device on sign-in, without sending anything back', async () => {
    const server = fakeServer()
    await setUpDevice()
    await api.login('0780000001', 'secret1')
    await connectAccount()
    await clearDevice()
    await api.login('0780000001', 'secret1')
    expect(await connectAccount()).toMatchObject({ action: 'restored', profiles: 1 })
    expect(server.uploads).toHaveLength(1)
    expect(await getBoardPreferences('local-1')).toMatchObject({ environment: 'meal' })
    expect(await accountBackupState()).toMatchObject({ revision: 1 })
    expect(await saveToAccount()).toMatchObject({ unchanged: true })
  })

  it('never overwrites an account copy from a device that has its own set-up until the caregiver chooses', async () => {
    const server = fakeServer()
    await setUpDevice()
    await api.login('0780000001', 'secret1')
    await connectAccount()
    await clearDevice()
    await db.profiles.put({ profile_id: 'local-9', code: 'P-09', local_only: true })
    await api.login('0780000001', 'secret1')
    expect(await connectAccount()).toMatchObject({ action: 'choose', differences: { onlyHere: ['P-09'], onlyAccount: ['P-01'] } })
    expect(await accountBackupState()).toBeNull()
    expect(await saveToAccount()).toBeNull()
    expect(server.uploads).toHaveLength(1)
  })

  it('takes a newer copy saved from another device when nothing changed here since', async () => {
    const server = fakeServer()
    await setUpDevice()
    await api.login('0780000001', 'secret1')
    await connectAccount()
    savedElsewhere(server, 2, data => { setting(data, 'appearance:local-1').value.environment = 'school' })
    expect(await connectAccount()).toMatchObject({ action: 'updated', profiles: 1 })
    expect(await getBoardPreferences('local-1')).toMatchObject({ environment: 'school' })
    expect(await accountBackupState()).toMatchObject({ revision: 2 })
    expect(server.uploads).toHaveLength(1)
  })

  it('never replaces a newer copy with this device’s changes: the caregiver keeps this device’s set-up or the account’s', async () => {
    const server = fakeServer()
    const word = await setUpDevice()
    await api.login('0780000001', 'secret1')
    await connectAccount()
    savedElsewhere(server, 2, data => { setting(data, 'mode').value = 'static' })
    await setVocabulary('local-1', ['I', 'WANT', word.symbol_id])
    // Leaving the caregiver area tries to save: refused, and the newer copy stays as it was.
    expect(await saveToAccount()).toMatchObject({ conflict: true, revision: 2 })
    expect(server.uploads).toHaveLength(1)
    expect(setting(server.copies.get(ACCOUNT).data, 'mode').value).toBe('static')
    expect(await connectAccount()).toMatchObject({ action: 'choose', differences: { onlyHere: [], onlyAccount: [], changed: ['P-01'], device: true } })
    // Kept from the account: its words and mode come back, and what stays on this device stays.
    await restoreFromAccount()
    expect((await db.settings.get('mode')).value).toBe('static')
    expect(await getVocabulary('local-1')).toEqual(expect.arrayContaining(['I', 'WANT', 'WATER', word.symbol_id]))
    expect(await db.profiles.get('local-2')).toMatchObject({ code: 'Keza' })
    expect(await accountBackupState()).toMatchObject({ revision: 2 })
    expect(server.uploads).toHaveLength(1)
    // Or this device's set-up, chosen after another save elsewhere, replaces whatever revision is newest.
    savedElsewhere(server, 3, data => { setting(data, 'mode').value = 'predictive' })
    await setVocabulary('local-1', ['I', 'WANT'])
    expect(await connectAccount()).toMatchObject({ action: 'choose' })
    expect(await replaceAccountCopy()).toMatchObject({ revision: 4 })
    expect(server.copies.get(ACCOUNT).data.vocabulary.map(row => row.key)).toEqual(['I', 'WANT'])
    expect(await accountBackupState()).toMatchObject({ revision: 4 })
  })

  it('sends a deletion made here with the next save, and takes a child deleted elsewhere off this device', async () => {
    const server = fakeServer()
    await setUpDevice()
    const here = await createLocalProfile('P-05'), there = await createLocalProfile('P-06')
    await setVocabulary(there.profile_id, ['I'])
    await api.login('0780000001', 'secret1')
    expect(await connectAccount()).toMatchObject({ action: 'saved', revision: 1 })
    // Deleted here: leaving the caregiver area saves the copy without the child, listing its id.
    await deleteProfile(here.profile_id)
    expect(await saveToAccount()).toMatchObject({ revision: 2 })
    expect(server.copies.get(ACCOUNT).data.deleted).toEqual([here.profile_id])
    expect(server.copies.get(ACCOUNT).data.profiles.map(profile => profile.code).sort()).toEqual(['P-01', 'P-06'])
    // Deleted on another device: this one, which changed nothing since, deletes the child too.
    savedElsewhere(server, 3, data => {
      data.profiles = data.profiles.filter(profile => profile.profile_id !== there.profile_id)
      data.vocabulary = data.vocabulary.filter(row => row.profile_id !== there.profile_id)
      data.settings = data.settings.filter(entry => !entry.key.endsWith(there.profile_id))
      data.deleted = [here.profile_id, there.profile_id].sort()
    })
    expect(await connectAccount()).toMatchObject({ action: 'updated', removed: 1 })
    expect(await db.profiles.get(there.profile_id)).toBeUndefined()
    expect(await getVocabulary(there.profile_id)).toBeNull()
    expect(server.uploads).toHaveLength(2)
    expect(await saveToAccount()).toMatchObject({ unchanged: true })
  })

  it('never lets an account copy saved by a device that still had a deleted child bring it back', async () => {
    const server = fakeServer()
    await setUpDevice()
    const child = await createLocalProfile('P-05')
    await api.login('0780000001', 'secret1')
    await connectAccount()
    const old = server.copies.get(ACCOUNT).data.profiles.find(profile => profile.profile_id === child.profile_id)
    // Another device saved meanwhile, and this one deletes the child: only the deletion differs,
    // so it goes up without asking the caregiver.
    savedElsewhere(server, 2, () => {})
    await deleteProfile(child.profile_id)
    expect(await connectAccount()).toMatchObject({ action: 'saved', revision: 3 })
    expect(server.copies.get(ACCOUNT).data.deleted).toEqual([child.profile_id])
    // An older tablet saves the child back onto the account; taking the account's copy here still
    // leaves the child out, and this device's copy lists the deletion again.
    savedElsewhere(server, 4, data => { data.profiles.push(old); delete data.deleted })
    expect(await connectAccount()).toMatchObject({ action: 'updated', profiles: 1 })
    expect(await db.profiles.get(child.profile_id)).toBeUndefined()
    expect(server.copies.get(ACCOUNT)).toMatchObject({ revision: 5, data: { deleted: [child.profile_id] } })
    expect(server.copies.get(ACCOUNT).data.profiles.map(profile => profile.code)).toEqual(['P-01'])
  })
})
