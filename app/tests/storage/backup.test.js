import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { BACKUP_FORMAT, createBackup, isNewDevice, restoreBackup } from '../../src/storage/backup.js'
import { getBoardPreferences, saveBoardPreferences } from '../../src/storage/board-preferences.js'
import { addCustomSymbol, listCustomSymbols } from '../../src/storage/custom-symbols.js'
import { getRecording, saveRecording } from '../../src/storage/recordings.js'
import { getVocabulary, setVocabulary } from '../../src/storage/vocabulary.js'
import { PARENT_ACCESS_KEY, setupParentPin } from '../../src/parent-access/parent-access.js'
import { accountBackupState, connectAccount, saveToAccount } from '../../src/server/account-backup.js'
import { api } from '../../src/server/api-client.js'

const bytes = async blob => [...new Uint8Array(await blob.arrayBuffer())]
const clearDevice = () => Promise.all(db.tables.map(table => table.clear()))

// One caregiver's device: a child with hand-picked words, a place and next-word list, a custom
// word with its photo, a familiar-voice recording, and the PIN and sign-in that must not travel.
async function setUpDevice() {
  await db.profiles.put({ profile_id: 'local-1', code: 'P-01', local_only: true })
  await db.settings.put({ key: 'profile', value: { profile_id: 'local-1', code: 'P-01' } })
  await db.settings.put({ key: 'mode', value: 'predictive' })
  await setVocabulary('local-1', ['I', 'WANT', 'WATER'])
  await saveBoardPreferences('local-1', { environment: 'meal', relatedWords: true, relatedLists: { DRINK: ['MILK', 'CUP'] }, showLabels: false })
  const word = await addCustomSymbol({ label: 'Nyogokuru', category: 'people', image: new Blob([new Uint8Array([1, 2, 250, 255])], { type: 'image/webp' }) }, { profileId: 'local-1' })
  await saveRecording(word.symbol_id, new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/webm' }))
  await setupParentPin('5678', '5678')
  await db.settings.put({ key: 'token', value: 'secret-token' })
  await db.settings.put({ key: 'account', value: { phone: '0780000001' } })
  return word
}

beforeEach(async () => { await clearDevice(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('device backup', () => {
  it('carries every child, word, setting, photo and voice to a new device, and never the PIN or sign-in', async () => {
    const word = await setUpDevice()
    const snapshot = JSON.parse(JSON.stringify(await createBackup()))
    expect(snapshot.format).toBe(BACKUP_FORMAT)
    expect(JSON.stringify(snapshot)).not.toMatch(/parent-access|secret-token|0780000001|digest/)

    await clearDevice()
    expect(await isNewDevice()).toBe(true)
    expect(await restoreBackup(snapshot)).toEqual({ profiles: 1, words: 1, recordings: 1 })
    expect(await isNewDevice()).toBe(false)
    expect(await getVocabulary('local-1')).toEqual(expect.arrayContaining(['I', 'WANT', 'WATER', word.symbol_id]))
    expect(await getBoardPreferences('local-1')).toMatchObject({ environment: 'meal', relatedWords: true, relatedLists: { DRINK: ['MILK', 'CUP'] }, showLabels: false })
    expect((await db.settings.get('mode')).value).toBe('predictive')
    const [restored] = await listCustomSymbols()
    expect(restored).toMatchObject({ symbol_id: word.symbol_id, label_rw: 'Nyogokuru', category: 'people' })
    expect(restored.image.type).toBe('image/webp')
    expect(await bytes(restored.image)).toEqual([1, 2, 250, 255])
    expect(await bytes(await getRecording(word.symbol_id))).toEqual([9, 8, 7])
    expect(await db.settings.get(PARENT_ACCESS_KEY)).toBeUndefined()
    expect(await db.settings.get('token')).toBeUndefined()
  })

  it('replaces a restored child’s word list but keeps what else this device has', async () => {
    await setUpDevice()
    const snapshot = await createBackup()
    await setVocabulary('local-1', ['NO'])
    await db.profiles.put({ profile_id: 'local-2', code: 'P-02', local_only: true })
    await restoreBackup(snapshot)
    expect(await getVocabulary('local-1')).not.toContain('NO')
    expect(await db.profiles.get('local-2')).toMatchObject({ code: 'P-02' })
  })

  it('refuses a damaged or foreign snapshot without changing the device', async () => {
    await setUpDevice()
    const snapshot = await createBackup()
    await expect(restoreBackup({ ...snapshot, format: 'other' })).rejects.toThrow('ntibisomeka')
    await expect(restoreBackup({ ...snapshot, data: { ...snapshot.data, settings: [{ key: PARENT_ACCESS_KEY, value: {} }] } })).rejects.toThrow('ntibisomeka')
    await expect(restoreBackup({ ...snapshot, data: { ...snapshot.data, custom_symbols: [{ symbol_id: 'WATER', label_rw: 'x', category: 'people', image: {} }] } })).rejects.toThrow('ntibisomeka')
    expect(await db.settings.get(PARENT_ACCESS_KEY)).toBeDefined()
  })
})

// A stand-in for the Vuga API: one backup per signed-in account.
function fakeServer() {
  const copies = new Map(), uploads = []
  vi.stubGlobal('fetch', async (url, { method = 'GET', headers = {}, body } = {}) => {
    const path = new URL(url).pathname
    const json = (status, value) => ({ ok: status < 300, status, json: async () => value })
    if (path === '/auth/login') return json(200, { access_token: `token:${new URLSearchParams(body).get('username')}` })
    const account = headers.Authorization?.replace('Bearer token:', '')
    if (!account) return json(401, {})
    if (path === '/backup/status') return json(200, copies.get(account) ? { saved_at: copies.get(account).saved_at, size: 1 } : { saved_at: null, size: 0 })
    if (path === '/backup' && method === 'GET') return copies.get(account) ? json(200, copies.get(account)) : json(404, {})
    if (path === '/backup' && method === 'PUT') {
      const saved = { ...JSON.parse(body), saved_at: new Date(Date.now() + uploads.length * 1000).toISOString() }
      copies.set(account, saved); uploads.push(account)
      return json(200, { saved_at: saved.saved_at, size: body.length })
    }
    return json(404, {})
  })
  return { copies, uploads }
}

describe('account backup', () => {
  it('saves a set-up device to an empty account, then only when something changed', async () => {
    const server = fakeServer()
    await setUpDevice()
    await api.login('0780000001', 'secret1')
    expect(await connectAccount()).toMatchObject({ action: 'saved' })
    expect(server.uploads).toHaveLength(1)
    expect(await saveToAccount()).toMatchObject({ unchanged: true })
    expect(server.uploads).toHaveLength(1)
    await saveBoardPreferences('local-1', { ...(await getBoardPreferences('local-1')), environment: 'school' })
    await saveToAccount()
    expect(server.uploads).toHaveLength(2)
    expect(JSON.stringify(server.copies.get('+250780000001').data)).toContain('school')
  })

  it('brings everything to a new device on sign-in, without sending anything back', async () => {
    const server = fakeServer()
    await setUpDevice()
    await api.login('0780000001', 'secret1')
    await connectAccount()
    await clearDevice()
    await api.login('0780000001', 'secret1')
    expect(await connectAccount()).toMatchObject({ action: 'restored', profiles: 1, words: 1, recordings: 1 })
    expect(server.uploads).toHaveLength(1)
    expect(await getBoardPreferences('local-1')).toMatchObject({ environment: 'meal' })
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
    expect(await connectAccount()).toMatchObject({ action: 'choose' })
    expect(await accountBackupState()).toBeNull()
    expect(await saveToAccount()).toBeNull()
    expect(server.uploads).toHaveLength(1)
  })
})
