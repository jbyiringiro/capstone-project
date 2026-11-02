import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, createLocalProfile, getVocabulary, setVocabulary, startDraft, logAction, finaliseMessage, getLocalSummary, exportLocalData, syncPending } from '../src/db.js'

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  vi.unstubAllGlobals()
})

describe('offline storage', () => {
  it('persists intentionally empty vocabulary separately from defaults', async () => {
    const profile = await createLocalProfile('p-01')
    expect(profile.code).toBe('P-01')
    expect(await getVocabulary(profile.profile_id)).toBeNull()
    await setVocabulary(profile.profile_id, [])
    expect(await getVocabulary(profile.profile_id)).toEqual([])
    await setVocabulary(profile.profile_id, ['I', 'WANT', 'I'])
    expect(await getVocabulary(profile.profile_id)).toEqual(['I', 'WANT'])
    await expect(createLocalProfile('P-01')).rejects.toThrow('Iyi kode isanzwe')
  })

  it('summarises completed messages using time to Speak, excludes drafts and secrets from export', async () => {
    await db.settings.put({ key: 'token', value: 'secret-not-for-export' })
    const message = await startDraft('demo', 'static')
    await logAction(message, 0, 'select', { symbol_key: 'WATER', ts: '2026-09-28T10:00:00.000Z' })
    await logAction(message, 1, 'speak', { ts: '2026-09-28T10:00:02.000Z' })
    await finaliseMessage(message, 2)
    await startDraft('demo', 'predictive')
    const summary = await getLocalSummary('demo')
    expect(summary.by_board_mode.static).toMatchObject({ messages: 1, taps_per_message: 2, seconds_per_message: 2 })
    expect(summary.by_board_mode.predictive).toBeUndefined()
    expect(summary.symbol_frequency).toEqual({ WATER: 1 })
    const exported = await exportLocalData()
    expect(exported.messages).toHaveLength(2)
    expect(JSON.stringify(exported)).not.toContain('secret-not-for-export')
  })

  it('uploads only the current account profiles and keeps local messages', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const localId = await startDraft('local-profile', 'static')
    const serverId = await startDraft('owned-server-profile', 'static')
    for (const id of [localId, serverId]) {
      await logAction(id, 0, 'select', { symbol_key: 'WATER' })
      await logAction(id, 1, 'speak')
      await finaliseMessage(id, 2)
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ profile_id: 'owned-server-profile' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted_messages: 1, duplicates: 0 }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await syncPending('http://localhost:8000', 'test-token')).toMatchObject({ accepted_messages: 1, skipped_local: 1 })
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(payload.messages.map(m => m.message_id)).toEqual([serverId])
    expect((await db.messages.get(localId)).synced).toBe(0)
    expect((await db.messages.get(serverId)).synced).toBe(1)
  })

  it('caps a large backlog to the API limit and leaves the remainder pending', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    await db.messages.bulkPut(Array.from({ length: 1001 }, (_, i) => ({
      message_id: `batch-${i}`, profile_id: 'owned', synced: 0, spoken_at: '2026-09-28T10:00:00Z'
    })))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ profile_id: 'owned' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted_messages: 1000, duplicates: 0 }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await syncPending('http://localhost:8000', 'token')).toMatchObject({ remaining: 1 })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages).toHaveLength(1000)
    expect(await db.messages.where('synced').equals(0).count()).toBe(1)
  })
})
