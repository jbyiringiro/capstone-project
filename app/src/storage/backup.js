// What a caregiver set up on this device, as one copy for their Vuga account, so a new phone or
// tablet gets it back by signing in: each child known by a code such as P-01, their words, board,
// place, next-word and child-mode settings, the board mode and the speech choice. Nothing in it
// names a child or carries a photo or a voice (NFR4: no child names or media on the server): a child
// the family calls by name, custom words with their photos, familiar-voice recordings, messages,
// game results, the PIN and the sign-in stay on the device that made them.
//
// A child deleted here is listed by id in `deleted`, and the account keeps that list: no copy
// brings the child back, and a device that receives the copy deletes the child too.
import { db } from './db.js'
import { localizedError } from '../shared/errors-rw.js'
import { isCustomKey } from './custom-symbols.js'
import { PROFILE_CODE, childTables, eraseLocalProfiles, getDeletedProfiles, rememberDeletedProfiles } from './profiles.js'
import { normalisePreferences } from './board-preferences.js'

export const BACKUP_FORMAT = 'vuga-account-backup-v2'
const TABLES = ['profiles', 'vocabulary', 'settings']
// Board, place, next-word and child-mode settings per child, hand-picked word lists, the board
// mode, the open child and the speech choice. Never the PIN, the token or the linked account.
const backedUp = key => /^(appearance|vocabulary):/.test(key) || ['mode', 'profile', 'speech-mode'].includes(key)
const childOf = key => key.slice(key.indexOf(':') + 1)
const coded = profile => PROFILE_CODE.test(profile?.code ?? '')
// The ids the account takes (api/app/schemas.py ProfileId): a server child, or one made on a device.
const PROFILE_ID = /^(local-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// The server takes each setting only in its current shape (api/app/schemas.py), so board settings
// saved by an older version go up as this device reads them, and the open child with its profile
// fields alone.
const PROFILE_FIELDS = ['profile_id', 'code', 'age_band', 'access_method', 'local_only']
const accountValue = ({ key, value }) => ({
  key,
  value: key.startsWith('appearance:') ? normalisePreferences(value)
    : key === 'profile' && value ? Object.fromEntries(PROFILE_FIELDS.filter(field => field in value).map(field => [field, value[field]]))
      : value
})

export async function createBackup() {
  const [profiles, vocabulary, settings, gone] = await db.transaction('r', TABLES.map(name => db[name]), () =>
    Promise.all([db.profiles.toArray(), db.vocabulary.toArray(), db.settings.toArray(), getDeletedProfiles()]))
  const children = profiles.filter(coded)
  const kept = new Set(children.map(profile => profile.profile_id))
  // A setting of a child who stays on this device stays with them; 'demo' is the board without a child.
  const keptSetting = ({ key, value }) => (key.includes(':') ? kept.has(childOf(key)) || childOf(key) === 'demo'
    : key !== 'profile' || !value || kept.has(value.profile_id))
  const deleted = gone.filter(id => PROFILE_ID.test(id) && !kept.has(id)).sort()
  return {
    format: BACKUP_FORMAT,
    data: {
      profiles: children.map(({ profile_id, code, age_band = null, access_method = 'touch', local_only = true }) => ({ profile_id, code, age_band, access_method, local_only })),
      // Custom words never leave the device, so their keys stay out of the word lists too.
      vocabulary: vocabulary.filter(row => kept.has(row.profile_id) && !isCustomKey(row.key)).map(({ profile_id, key }) => ({ profile_id, key })),
      settings: settings.filter(setting => backedUp(setting.key) && keptSetting(setting)).map(accountValue),
      // Listed only when there is one, so a copy without deletions looks as it always did.
      ...(deleted.length ? { deleted } : {})
    }
  }
}

const text = value => typeof value === 'string' && value.length > 0
const listOf = (value, valid) => Array.isArray(value) && value.every(valid)
function validBackup(data) {
  return !!data && listOf(data.profiles, p => text(p?.profile_id) && coded(p))
    && listOf(data.vocabulary, v => text(v?.profile_id) && text(v.key))
    && listOf(data.settings, s => text(s?.key) && backedUp(s.key))
    && (data.deleted === undefined || listOf(data.deleted, text))
}

// Brings an account copy onto this device. What it holds replaces the same children's words and
// settings here; anything else on this device stays, including the custom words made here. A
// child deleted on another device is deleted here too, and a child deleted here does not come back.
export async function restoreBackup(snapshot) {
  const data = snapshot?.format === BACKUP_FORMAT ? snapshot.data : null
  if (!validBackup(data)) throw localizedError('Ibyabitswe kuri konti ntibisomeka. Bibike bundi bushya uhereye ku gikoresho byavuyeho.')
  return db.transaction('rw', childTables(), async () => {
    const gone = new Set([...(await getDeletedProfiles()), ...(data.deleted ?? [])])
    const here = await db.profiles.where('profile_id').anyOf([...gone]).primaryKeys()
    await eraseLocalProfiles(here)
    if (data.deleted?.length) await rememberDeletedProfiles(data.deleted)
    const keep = id => !gone.has(id)
    const profiles = data.profiles.filter(profile => keep(profile.profile_id))
    await db.profiles.bulkPut(profiles)
    // A child's hand-picked words come back as a whole list, with this device's custom words in it.
    const children = profiles.map(profile => profile.profile_id)
    const custom = (await db.vocabulary.where('profile_id').anyOf(children).toArray()).filter(row => isCustomKey(row.key))
    await db.vocabulary.where('profile_id').anyOf(children).delete()
    await db.vocabulary.bulkPut([...data.vocabulary.filter(row => keep(row.profile_id)), ...custom])
    await db.settings.bulkPut(data.settings.filter(({ key, value }) => (key.includes(':') ? keep(childOf(key)) : key !== 'profile' || !value || keep(value.profile_id))))
    return { profiles: profiles.length, removed: here.length }
  })
}

// A device nobody has set up yet: no children, custom words or recordings.
export async function isNewDevice() {
  const counts = await Promise.all([db.profiles.count(), db.custom_symbols.count(), db.recordings.count()])
  return counts.every(count => count === 0)
}

// The same JSON for the same content, whatever order the keys were written in.
const canonical = value => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item))

export async function backupFingerprint(snapshot) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(snapshot.data)))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

// What differs between two copies, for the caregiver to choose between them: children (by code) on
// only one side, children whose words or settings differ, children deleted on another device
// (`removed`), and the device-wide settings (board mode, open child, speech choice, the board
// without a child). A child deleted on one side is never offered as missing from the other, and
// `deletions` says this device deleted children the account has not heard of yet.
export function backupDifferences(here, account) {
  const byId = data => new Map(data.profiles.map(profile => [profile.profile_id, profile]))
  const ofChild = (data, id) => canonical({
    profile: byId(data).get(id),
    words: data.vocabulary.filter(row => row.profile_id === id).map(row => row.key).sort(),
    settings: data.settings.filter(setting => setting.key.includes(':') && childOf(setting.key) === id)
  })
  const device = data => canonical(data.settings.filter(setting => !setting.key.includes(':') || childOf(setting.key) === 'demo'))
  const mine = byId(here), theirs = byId(account)
  const goneHere = new Set(here.deleted ?? []), goneThere = new Set(account.deleted ?? [])
  const codes = list => list.map(profile => profile.code).sort()
  return {
    onlyHere: codes([...mine.values()].filter(profile => !theirs.has(profile.profile_id) && !goneThere.has(profile.profile_id))),
    onlyAccount: codes([...theirs.values()].filter(profile => !mine.has(profile.profile_id) && !goneHere.has(profile.profile_id))),
    changed: codes([...mine.values()].filter(profile => theirs.has(profile.profile_id) && ofChild(here, profile.profile_id) !== ofChild(account, profile.profile_id))),
    removed: codes([...mine.values()].filter(profile => goneThere.has(profile.profile_id))),
    device: device(here) !== device(account),
    deletions: [...goneHere].some(id => !goneThere.has(id))
  }
}

export const noDifferences = differences => !differences.onlyHere.length && !differences.onlyAccount.length && !differences.changed.length
  && !differences.removed?.length && !differences.device
