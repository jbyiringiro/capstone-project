import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { addCustomSymbol, deleteCustomSymbol, isCustomKey, listCustomSymbols, validateCustomWord } from '../../src/storage/custom-symbols.js'
import { getVocabulary, setVocabulary } from '../../src/storage/vocabulary.js'
import { getRecording, saveRecording } from '../../src/storage/recordings.js'
import { countPendingUploads, finaliseMessage, logAction, startDraft, SyncState } from '../../src/storage/messages.js'
import { syncPending } from '../../src/server/sync.js'

const photo = () => new Blob(['jpeg-bytes'], { type: 'image/webp' })

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  vi.unstubAllGlobals()
})

describe('caregiver custom words', () => {
  it('validates the label, category and picture in Kinyarwanda', () => {
    expect(() => validateCustomWord({ label: '  ', category: 'people', image: photo() })).toThrow('Andika izina')
    expect(() => validateCustomWord({ label: 'x'.repeat(41), category: 'people', image: photo() })).toThrow('inyuguti 40')
    expect(() => validateCustomWord({ label: 'nyogokuru', category: 'nowhere', image: photo() })).toThrow('icyiciro')
    expect(() => validateCustomWord({ label: 'nyogokuru', category: 'people', image: new Blob(['x'], { type: 'text/plain' }) })).toThrow('ifoto')
    expect(() => validateCustomWord({ label: 'Amazi', category: 'food_drink', image: photo() }, ['amazi'])).toThrow('risanzwe')
    expect(validateCustomWord({ label: '  nyogo   kuru ', category: 'people', image: photo() }).label).toBe('nyogo kuru')
  })

  it('stores a word with a custom key and refuses a second word with the same label', async () => {
    const word = await addCustomSymbol({ label: 'Nyogokuru', category: 'people', image: photo() })
    expect(isCustomKey(word.symbol_id)).toBe(true)
    expect(isCustomKey('WATER')).toBe(false)
    expect(await listCustomSymbols()).toMatchObject([{ symbol_id: word.symbol_id, label_rw: 'Nyogokuru', category: 'people' }])
    await expect(addCustomSymbol({ label: 'nyogokuru', category: 'places', image: photo() })).rejects.toThrow('risanzwe')
  })

  it('adds the new word to the active child only when that child has a chosen vocabulary', async () => {
    const unconfigured = await addCustomSymbol({ label: 'imbwa yacu', category: 'animals', image: photo() }, { profileId: 'local-a' })
    expect(await getVocabulary('local-a')).toBeNull()
    await setVocabulary('local-b', ['I', 'WANT'])
    const chosen = await addCustomSymbol({ label: 'ishuri ryacu', category: 'places', image: photo() }, { profileId: 'local-b' })
    expect((await getVocabulary('local-b')).sort()).toEqual(['I', 'WANT', chosen.symbol_id].sort())
    expect(await getVocabulary('local-b')).not.toContain(unconfigured.symbol_id)
  })

  it('deletes the word with its recording and its place in every vocabulary, but never a bundled word', async () => {
    const word = await addCustomSymbol({ label: 'nyogokuru', category: 'people', image: photo() })
    await saveRecording(word.symbol_id, new Blob(['voice'], { type: 'audio/webm' }))
    await setVocabulary('local-a', ['I', word.symbol_id])
    await setVocabulary('local-b', [word.symbol_id])
    await deleteCustomSymbol(word.symbol_id)
    expect(await listCustomSymbols()).toEqual([])
    expect(await getRecording(word.symbol_id)).toBeNull()
    expect(await getVocabulary('local-a')).toEqual(['I'])
    expect(await getVocabulary('local-b')).toEqual([])
    await expect(deleteCustomSymbol('WATER')).rejects.toThrow('ntasibwa')
  })

  it('keeps messages that use a custom word on the device when syncing', async () => {
    const word = await addCustomSymbol({ label: 'nyogokuru', category: 'people', image: photo() })
    const ids = {}
    for (const [name, key] of [['custom', word.symbol_id], ['bundled', 'WATER']]) {
      ids[name] = await startDraft('owned', 'static')
      await logAction(ids[name], 0, 'select', { symbol_key: key })
      await logAction(ids[name], 1, 'speak')
      await finaliseMessage(ids[name], 2)
    }
    expect((await db.messages.get(ids.custom)).synced).toBe(SyncState.DEVICE_ONLY)
    expect(await countPendingUploads()).toBe(1)
    vi.stubGlobal('navigator', { onLine: true })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ profile_id: 'owned' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted_messages: 1, duplicates: 0 }) })
    vi.stubGlobal('fetch', fetchMock)
    await syncPending('http://localhost:8000', 'token')
    const uploaded = JSON.parse(fetchMock.mock.calls[1][1].body).messages
    expect(uploaded.map(m => m.message_id)).toEqual([ids.bundled])
    expect(JSON.stringify(uploaded)).not.toContain(word.symbol_id)
  })
})
