import { db } from './db.js'
import { localizedError } from '../shared/errors-rw.js'

export const PROFILE_CODE = /^[A-Z]-\d{2,3}$/
// A child on this device goes by a code such as P-01 or by the name the family uses. Only
// server profiles, whose messages can be uploaded, are kept to codes.
export const PROFILE_NAME_MAX = 30
const PROFILE_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’-]*$/u
// An age or age band such as 7, 7-9 or 13+, as the server takes it (api/app/schemas.py AgeBand).
const AGE_BAND = /^\d{1,2}(-\d{1,2}|\+)?$/
// Ids of deleted children that an account copy may still hold, so that no copy brings them back
// (storage/backup.js). Ids only: no code, name or data.
export const DELETED_PROFILES = 'deleted-profiles'
const DELETED_MAX = 1000

// Everything this device keeps for a child, deleted with them in one transaction. Custom words and
// recordings are shared by every child here, so they stay.
export const childTables = () => [db.profiles, db.vocabulary, db.messages, db.tap_events, db.game_sessions, db.settings]

export async function getProfiles() {
  return db.profiles.orderBy('code').toArray()
}

// A child's name or code as typed: spaces tidied, a code in capitals.
export function childLabel(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (PROFILE_CODE.test(text.toUpperCase())) return { code: text.toUpperCase(), isCode: true }
  if (!text || text.length > PROFILE_NAME_MAX || !PROFILE_NAME.test(text)) throw localizedError(`Andika izina cyangwa kode y’umwana, nka Keza cyangwa P-01. Inyuguti ntizirenge ${PROFILE_NAME_MAX}.`)
  return { code: text, isCode: false }
}

const ageBand = value => {
  if (value === null || value === undefined || value === '') return null
  if (!AGE_BAND.test(String(value))) throw localizedError('Hitamo icyiciro cy’imyaka kiri ku rutonde.')
  return String(value)
}

async function codeTaken(code, isCode, exceptId = null) {
  if (await db.profiles.where('code').equalsIgnoreCase(code).filter(profile => profile.profile_id !== exceptId).count()) {
    throw localizedError(isCode ? 'Iyi kode isanzwe iri kuri iki gikoresho.' : 'Iri zina risanzwe riri kuri iki gikoresho.')
  }
}

export async function createLocalProfile(code, age_band = null) {
  const label = childLabel(code), age = ageBand(age_band)
  return db.transaction('rw', db.profiles, async () => {
    await codeTaken(label.code, label.isCode)
    const profile = { profile_id: `local-${crypto.randomUUID()}`, code: label.code, age_band: age, access_method: 'touch', local_only: true }
    await db.profiles.add(profile)
    return profile
  })
}

export async function saveServerProfiles(profiles) {
  await db.profiles.bulkPut(profiles.map(profile => ({ ...profile, local_only: false })))
}

// The child as an edit would leave them, checked but not saved, so a server child can be changed
// on the server first. A child known by a code may be on the caregiver's account copy, which
// holds codes only, so they keep a code; a child known by a name may be given a code.
export async function prepareProfileEdit(profileId, { code, age_band = null }) {
  const profile = await db.profiles.get(profileId)
  if (!profile) throw localizedError('Uyu mwirondoro ntukiri kuri iki gikoresho.')
  const label = childLabel(code)
  if (PROFILE_CODE.test(profile.code) && !label.isCode) {
    throw localizedError('Uyu mwana amenyekana kuri kode, kandi kode ni yo ibikwa kuri konti yawe. Mwandikire indi kode, nka P-02.')
  }
  await codeTaken(label.code, label.isCode, profileId)
  return { ...profile, code: label.code, age_band: ageBand(age_band) }
}

// Saves a new name or code and age band under the same id, so the child's words, settings,
// messages and recordings stay theirs. The open child is updated too.
export async function updateProfile(profileId, changes) {
  return db.transaction('rw', db.profiles, db.settings, async () => {
    const next = await prepareProfileEdit(profileId, changes)
    await db.profiles.put(next)
    const open = await db.settings.get('profile')
    if (open?.value?.profile_id === profileId) await db.settings.put({ key: 'profile', value: next })
    return next
  })
}

// Deletes children and what this device keeps for them only: their words, board and child-mode
// settings, messages with their taps (drafts and unsent ones too) and game results. If one was
// open, the board goes back to the demo board. Run inside a transaction over childTables().
export async function eraseLocalProfiles(ids) {
  if (!ids.length) return
  const messages = await db.messages.where('profile_id').anyOf(ids).primaryKeys()
  await db.tap_events.where('message_id').anyOf(messages).delete()
  await db.messages.bulkDelete(messages)
  await db.vocabulary.where('profile_id').anyOf(ids).delete()
  await db.game_sessions.where('profile_id').anyOf(ids).delete()
  await db.settings.bulkDelete(ids.flatMap(id => [`appearance:${id}`, `vocabulary:${id}`]))
  await db.profiles.bulkDelete(ids)
  const open = await db.settings.get('profile')
  if (ids.includes(open?.value?.profile_id)) await db.settings.put({ key: 'profile', value: null })
}

export async function getDeletedProfiles() {
  return (await db.settings.get(DELETED_PROFILES))?.value ?? []
}

export async function rememberDeletedProfiles(ids) {
  const known = await getDeletedProfiles()
  await db.settings.put({ key: DELETED_PROFILES, value: [...new Set([...known, ...ids])].slice(-DELETED_MAX) })
}

// Deletes one child from this device. A child known by a code may be on the account copy, so the
// deletion is remembered by id and goes up with the next copy. Returns whether they were open.
export async function deleteProfile(profileId) {
  return db.transaction('rw', childTables(), async () => {
    const [profile, open] = await Promise.all([db.profiles.get(profileId), db.settings.get('profile')])
    if (!profile) return false
    await eraseLocalProfiles([profileId])
    if (PROFILE_CODE.test(profile.code)) await rememberDeletedProfiles([profileId])
    return open?.value?.profile_id === profileId
  })
}
