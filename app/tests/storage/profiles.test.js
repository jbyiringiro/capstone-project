import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/storage/db.js'
import { createLocalProfile, deleteProfile, getDeletedProfiles, getProfiles, prepareProfileEdit, saveServerProfiles, updateProfile } from '../../src/storage/profiles.js'
import { getBoardPreferences, saveBoardPreferences } from '../../src/storage/board-preferences.js'
import { addCustomSymbol } from '../../src/storage/custom-symbols.js'
import { saveRecording } from '../../src/storage/recordings.js'
import { getVocabulary, setVocabulary } from '../../src/storage/vocabulary.js'
import { finaliseMessage, logAction, startDraft } from '../../src/storage/messages.js'
import { saveGameSession } from '../../src/storage/game-sessions.js'

beforeEach(() => Promise.all(db.tables.map(table => table.clear())))

// A child with all a device keeps for them: words, board settings, a spoken message with its taps,
// an unfinished draft and a game result.
async function childWithData(code) {
  const child = await createLocalProfile(code, '7-9')
  await setVocabulary(child.profile_id, ['I', 'WATER'])
  await saveBoardPreferences(child.profile_id, { environment: 'meal', childMode: true })
  const spoken = await startDraft(child.profile_id, 'static')
  await logAction(spoken, 0, 'select', { symbol_key: 'WATER' })
  await logAction(spoken, 1, 'speak')
  await finaliseMessage(spoken, 2)
  const draft = await startDraft(child.profile_id, 'predictive')
  await logAction(draft, 0, 'select', { symbol_key: 'I' })
  await saveGameSession(child.profile_id, '2026-11-04T10:00:00Z', [{ target: 'WATER', misses: 0 }])
  return { child, messages: [spoken, draft] }
}

describe('editing a child', () => {
  it('keeps the id, so the child’s words, settings and messages stay theirs, and updates the open child', async () => {
    const { child } = await childWithData('Keza')
    await db.settings.put({ key: 'profile', value: child })
    const next = await updateProfile(child.profile_id, { code: '  Keza   Uwase ', age_band: '10-12' })
    expect(next).toEqual({ ...child, code: 'Keza Uwase', age_band: '10-12' })
    expect(await db.profiles.get(child.profile_id)).toEqual(next)
    expect((await db.settings.get('profile')).value).toEqual(next)
    expect(await getVocabulary(child.profile_id)).toEqual(['I', 'WATER'])
    expect(await getBoardPreferences(child.profile_id)).toMatchObject({ environment: 'meal', childMode: true })
    expect(await db.messages.where('profile_id').equals(child.profile_id).count()).toBe(2)
    // A name can become a code, and the age band can be cleared.
    expect(await updateProfile(child.profile_id, { code: 'p-07', age_band: '' })).toMatchObject({ code: 'P-07', age_band: null })
    expect(await getProfiles()).toHaveLength(1)
  })
  it('refuses a blank, malformed or taken name or code, and a bad age band, without saving anything', async () => {
    const keza = await createLocalProfile('Keza'), coded = await createLocalProfile('P-01')
    await createLocalProfile('Ganza')
    for (const [id, changes, message] of [
      [keza.profile_id, { code: '   ' }, 'Andika izina cyangwa kode'],
      [keza.profile_id, { code: '<script>' }, 'Andika izina cyangwa kode'],
      [keza.profile_id, { code: 'K'.repeat(31) }, 'Inyuguti ntizirenge 30'],
      [keza.profile_id, { code: 'ganza' }, 'Iri zina risanzwe'],
      [keza.profile_id, { code: 'p-01' }, 'Iyi kode isanzwe'],
      [keza.profile_id, { code: 'Keza', age_band: 'seven' }, 'icyiciro cy’imyaka'],
      // A child known by a code may be on the account copy, which holds codes only.
      [coded.profile_id, { code: 'Keza Two' }, 'Mwandikire indi kode'],
      ['local-missing', { code: 'Ineza' }, 'ntukiri kuri iki gikoresho']
    ]) {
      await expect(updateProfile(id, changes)).rejects.toMatchObject({ localized: true, message: expect.stringContaining(message) })
    }
    expect((await getProfiles()).map(profile => profile.code)).toEqual(['Ganza', 'Keza', 'P-01'])
    // Its own name or code again, in other letters, is not a duplicate.
    expect(await updateProfile(keza.profile_id, { code: 'KEZA' })).toMatchObject({ code: 'KEZA' })
    expect(await updateProfile(coded.profile_id, { code: 'P-02' })).toMatchObject({ code: 'P-02' })
  })
  it('accepts ordinary names in any script', async () => {
    const child = await createLocalProfile('Ineza')
    for (const name of ['Ñkurunziza', 'Uwase-Marie', 'Ange O’Neil', 'Мария', '李明']) {
      expect(await updateProfile(child.profile_id, { code: name })).toMatchObject({ code: name })
    }
  })
  it('checks a server child’s edit before it goes to the server, and keeps a code', async () => {
    await saveServerProfiles([{ profile_id: '0d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f', code: 'S-01', age_band: null, access_method: 'touch' }, { profile_id: '1d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f', code: 'S-02', age_band: null, access_method: 'touch' }])
    await expect(prepareProfileEdit('0d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f', { code: 'S-02' })).rejects.toThrow('Iyi kode isanzwe')
    await expect(prepareProfileEdit('0d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f', { code: 'Keza' })).rejects.toThrow('Mwandikire indi kode')
    expect(await prepareProfileEdit('0d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f', { code: 's-11', age_band: '4-6' })).toMatchObject({ code: 'S-11', age_band: '4-6', local_only: false })
    expect((await db.profiles.get('0d6f2b4e-1c3a-4b5d-8e7f-9a0b1c2d3e4f')).code).toBe('S-01')
  })
})

describe('deleting a child', () => {
  it('deletes the child and only their records, keeping other children and shared words and recordings', async () => {
    const { child, messages } = await childWithData('P-05')
    const { child: other, messages: kept } = await childWithData('Ganza')
    const word = await addCustomSymbol({ label: 'Nyogokuru', category: 'people', image: new Blob([new Uint8Array([1, 2])], { type: 'image/webp' }) }, { profileId: child.profile_id })
    await setVocabulary(other.profile_id, ['I', word.symbol_id])
    await saveRecording(word.symbol_id, new Blob([new Uint8Array([9])], { type: 'audio/webm' }))
    await saveRecording('WATER', new Blob([new Uint8Array([8])], { type: 'audio/webm' }))
    expect(await deleteProfile(child.profile_id)).toBe(false)
    expect(await db.profiles.get(child.profile_id)).toBeUndefined()
    expect(await getVocabulary(child.profile_id)).toBeNull()
    expect(await db.settings.get(`appearance:${child.profile_id}`)).toBeUndefined()
    expect(await db.settings.get(`vocabulary:${child.profile_id}`)).toBeUndefined()
    expect(await db.messages.bulkGet(messages)).toEqual([undefined, undefined])
    expect(await db.tap_events.where('message_id').anyOf(messages).count()).toBe(0)
    expect(await db.game_sessions.where('profile_id').equals(child.profile_id).count()).toBe(0)
    // Another child keeps everything, and so does the device: custom words and recordings are shared.
    expect(await getVocabulary(other.profile_id)).toEqual(expect.arrayContaining(['I', word.symbol_id]))
    expect(await getBoardPreferences(other.profile_id)).toMatchObject({ environment: 'meal' })
    expect(await db.tap_events.where('message_id').anyOf(kept).count()).toBe(3)
    expect(await db.game_sessions.where('profile_id').equals(other.profile_id).count()).toBe(1)
    expect(await db.custom_symbols.get(word.symbol_id)).toBeTruthy()
    expect(await db.recordings.count()).toBe(2)
    // A coded child is remembered by id for the account copy; a child known by name is not.
    expect(await getDeletedProfiles()).toEqual([child.profile_id])
    await deleteProfile(other.profile_id)
    expect(await getDeletedProfiles()).toEqual([child.profile_id])
    expect(await deleteProfile(other.profile_id)).toBe(false)
  })
  it('sends the board back to the demo board when the open child is deleted', async () => {
    const { child } = await childWithData('Keza')
    await db.settings.put({ key: 'profile', value: child })
    await saveBoardPreferences(null, { gridSize: 12 })
    expect(await deleteProfile(child.profile_id)).toBe(true)
    expect((await db.settings.get('profile')).value).toBeNull()
    // The demo board's own settings stay.
    expect(await getBoardPreferences(null)).toMatchObject({ gridSize: 12 })
  })
  it('leaves everything as it was when the deletion fails part way', async () => {
    const { child } = await childWithData('P-05')
    const before = await Promise.all([db.profiles.count(), db.vocabulary.count(), db.messages.count(), db.tap_events.count(), db.game_sessions.count()])
    const original = db.game_sessions.where.bind(db.game_sessions)
    db.game_sessions.where = () => { throw new Error('disk full') }
    try { await expect(deleteProfile(child.profile_id)).rejects.toThrow('disk full') } finally { db.game_sessions.where = original }
    expect(await Promise.all([db.profiles.count(), db.vocabulary.count(), db.messages.count(), db.tap_events.count(), db.game_sessions.count()])).toEqual(before)
    expect(await getDeletedProfiles()).toEqual([])
  })
})
