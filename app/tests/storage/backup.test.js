import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { BACKUP_FORMAT, backupDifferences, createBackup, isNewDevice, restoreBackup } from '../../src/storage/backup.js'
import { getBoardPreferences, saveBoardPreferences } from '../../src/storage/board-preferences.js'
import { addCustomSymbol, listCustomSymbols } from '../../src/storage/custom-symbols.js'
import { saveRecording } from '../../src/storage/recordings.js'
import { getVocabulary, setVocabulary } from '../../src/storage/vocabulary.js'
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
    expect(await restoreBackup(snapshot)).toEqual({ profiles: 1 })
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
    expect(backupDifferences(here, account)).toEqual({ onlyHere: [], onlyAccount: [], changed: [], device: false })
    account.profiles.push({ profile_id: 'server-9', code: 'S-09', age_band: null, access_method: 'touch', local_only: false })
    account.vocabulary = account.vocabulary.filter(row => row.key !== 'WATER')
    account.settings.find(setting => setting.key === 'mode').value = 'static'
    await db.profiles.put({ profile_id: 'local-4', code: 'P-04', local_only: true })
    expect(backupDifferences((await createBackup()).data, account)).toEqual({ onlyHere: ['P-04'], onlyAccount: ['S-09'], changed: ['P-01'], device: true })
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
})
