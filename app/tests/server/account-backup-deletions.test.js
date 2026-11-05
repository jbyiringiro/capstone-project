import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { createBackup } from '../../src/storage/backup.js'
import { getDeletedProfiles } from '../../src/storage/profiles.js'
import { getVocabulary, setVocabulary } from '../../src/storage/vocabulary.js'
import { startDraft, logAction } from '../../src/storage/messages.js'
import { api } from '../../src/server/api-client.js'
import { accountBackupState, connectAccount, replaceAccountCopy, saveToAccount } from '../../src/server/account-backup.js'

const CHILD = '0d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f'
const PHONE = '+250780000001'
const clone = value => JSON.parse(JSON.stringify(value))

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.stubGlobal('navigator', { onLine: true })
})

async function device() {
  const child = { profile_id: CHILD, code: 'P-01', age_band: null, access_method: 'touch', local_only: false }
  await db.profiles.put(child)
  await db.settings.bulkPut([
    { key: 'profile', value: child }, { key: 'mode', value: 'predictive' },
    { key: 'account', value: { phone: PHONE } }, { key: 'token', value: 'test-token' }
  ])
  await setVocabulary(CHILD, ['I', 'WATER'])
  const draft = await startDraft(CHILD, 'predictive')
  await logAction(draft, 0, 'select', { symbol_key: 'WATER' })
  return draft
}

// Models the server's persisted tombstones and visible revision, including a DELETE made by
// another device with no subsequent backup PUT. Reads return independent response objects.
function server() {
  const state = { copy: null, deleted: new Set(), requests: [], beforeRead: null }
  const filtered = data => ({
    ...data,
    profiles: data.profiles.filter(p => !state.deleted.has(p.profile_id)),
    vocabulary: data.vocabulary.filter(v => !state.deleted.has(v.profile_id)),
    settings: data.settings.filter(({ key, value }) => key.includes(':') ? !state.deleted.has(key.split(':')[1])
      : key !== 'profile' || !value || !state.deleted.has(value.profile_id)),
    ...(state.deleted.size ? { deleted: [...state.deleted].sort() } : {})
  })
  const status = () => ({ saved_at: state.copy?.saved_at ?? null, revision: state.copy?.revision ?? 0, size: 1 })
  const bump = data => {
    state.copy = { format: 'vuga-account-backup-v2', data: filtered(clone(data)),
      revision: (state.copy?.revision ?? 0) + 1, saved_at: new Date().toISOString() }
  }
  state.deleteElsewhere = () => { state.deleted.add(CHILD); bump(state.copy?.data ?? { profiles: [], vocabulary: [], settings: [] }) }
  state.changeElsewhere = () => {
    const next = clone(state.copy.data)
    next.settings.find(s => s.key === 'mode').value = 'static'
    bump(next)
  }
  vi.stubGlobal('fetch', async (url, { method = 'GET', body } = {}) => {
    const path = new URL(url).pathname
    state.requests.push(`${method} ${path}`)
    const reply = (code, value) => ({ ok: code < 300, status: code, json: async () => clone(value) })
    if (path === '/backup/status') return reply(200, status())
    if (path === '/backup' && method === 'GET') {
      if (state.beforeRead) { const task = state.beforeRead; state.beforeRead = null; await task() }
      return reply(200, state.copy)
    }
    if (path === '/backup' && method === 'PUT') {
      const sent = JSON.parse(body)
      if (sent.base_revision !== (state.copy?.revision ?? 0)) return reply(409, status())
      for (const id of sent.data.deleted ?? []) state.deleted.add(id)
      bump(sent.data)
      return reply(200, status())
    }
    if (path === `/profiles/${CHILD}` && method === 'DELETE') { state.deleteElsewhere(); return reply(204, null) }
    return reply(404, {})
  })
  return state
}

describe('deletions discovered through account revisions', () => {
  it('updates an unchanged second device after DELETE alone, including its active child and draft', async () => {
    const draft = await device(), remote = server()
    await connectAccount()
    const joined = await accountBackupState()
    remote.requests.length = 0
    // This API request represents device A; device B's IndexedDB is deliberately unchanged.
    await api.deleteProfile(CHILD)
    expect(await db.profiles.get(CHILD)).toBeDefined()
    expect(remote.copy.revision).toBeGreaterThan(joined.revision)
    expect(await connectAccount()).toMatchObject({ action: 'updated', removed: 1 })
    expect(remote.requests.slice(0, 3)).toEqual([`DELETE /profiles/${CHILD}`, 'GET /backup/status', 'GET /backup'])
    expect(await db.profiles.get(CHILD)).toBeUndefined()
    expect(await getVocabulary(CHILD)).toBeNull()
    expect(await db.messages.get(draft)).toBeUndefined()
    expect(await db.tap_events.where('message_id').equals(draft).count()).toBe(0)
    expect((await db.settings.get('profile')).value).toBeNull()
    expect(await getDeletedProfiles()).toContain(CHILD)
  })

  it('applies server deletions after keeping this device while preserving edits made during upload', async () => {
    await device()
    const remote = server()
    await connectAccount()
    remote.deleteElsewhere()
    remote.beforeRead = async () => { await db.settings.put({ key: 'speech-mode', value: 'kinyarwanda' }) }
    const result = await replaceAccountCopy()
    expect(result).toMatchObject({ removed: 1 })
    expect(await db.profiles.get(CHILD)).toBeUndefined()
    expect((await db.settings.get('speech-mode')).value).toBe('kinyarwanda')
    expect(remote.copy.data.settings.some(s => s.key === 'speech-mode')).toBe(false)
    // The in-flight edit is still pending, not silently marked as saved with the earlier snapshot.
    expect(await saveToAccount()).not.toMatchObject({ unchanged: true })
    expect(remote.copy.data.settings).toContainEqual({ key: 'speech-mode', value: 'kinyarwanda' })
    expect((await createBackup()).data.profiles).toEqual([])
  })

  it('keeps the revision this upload wrote when another save lands before its follow-up read', async () => {
    await device()
    const remote = server()
    await connectAccount()
    await db.settings.put({ key: 'speech-mode', value: 'kinyarwanda' })
    remote.beforeRead = async () => remote.changeElsewhere()
    const written = await saveToAccount()
    expect(written.revision).toBe(2)
    expect(remote.copy.revision).toBe(3)
    expect(await accountBackupState()).toMatchObject({ revision: 2 })
    expect((await db.settings.get('mode')).value).toBe('predictive')
    expect(await connectAccount()).toMatchObject({ action: 'updated' })
    expect((await db.settings.get('mode')).value).toBe('static')
  })

  it('does not mark the device joined if the accepted copy cannot be checked for remote deletions', async () => {
    await device()
    const remote = server()
    remote.beforeRead = async () => { throw new TypeError('network interrupted') }
    await expect(connectAccount()).rejects.toMatchObject({ localized: true })
    expect(await accountBackupState()).toBeNull()
    expect(remote.copy.revision).toBe(1)
    expect(await db.profiles.get(CHILD)).toBeDefined()
    // Reconnecting reconciles the existing copy instead of overwriting it as an empty account.
    expect(await connectAccount()).toMatchObject({ action: 'joined' })
  })
})
