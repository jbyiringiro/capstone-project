// Everything a caregiver set up on this device, as one snapshot for their Vuga account, so a new
// phone or tablet gets it all back by signing in: the children, their words, board, place and
// next-word settings, child mode, custom words with their photos, and familiar-voice recordings.
// The PIN, the sign-in, messages and game results stay on the device that made them.
import { db } from './db.js'
import { localizedError } from '../shared/errors-rw.js'
import { isCustomKey } from './custom-symbols.js'

export const BACKUP_FORMAT = 'vuga-account-backup-v1'
const TABLES = ['profiles', 'vocabulary', 'settings', 'custom_symbols', 'recordings']
// Board, place, next-word and child-mode settings per child, hand-picked word lists, the board
// mode, the open child and the speech choice. Never the PIN, the token or the linked account.
const backedUp = key => /^(appearance|vocabulary):/.test(key) || ['mode', 'profile', 'speech-mode'].includes(key)

async function toData(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return { type: blob.type, base64: btoa(text) }
}
const toBlob = ({ type, base64 }) => new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type })

export async function createBackup() {
  const [profiles, vocabulary, settings, custom, recordings] = await db.transaction('r', TABLES.map(name => db[name]), () =>
    Promise.all([db.profiles.toArray(), db.vocabulary.toArray(), db.settings.toArray(), db.custom_symbols.toArray(), db.recordings.toArray()]))
  // Pictures and voices are read after the transaction: it would close while a blob is read.
  return {
    format: BACKUP_FORMAT,
    data: {
      profiles,
      vocabulary,
      settings: settings.filter(({ key }) => backedUp(key)),
      custom_symbols: await Promise.all(custom.map(async ({ image, ...word }) => ({ ...word, image: await toData(image) }))),
      recordings: await Promise.all(recordings.map(async ({ blob, ...recording }) => ({ ...recording, blob: await toData(blob) })))
    }
  }
}

const text = value => typeof value === 'string' && value.length > 0
const file = value => typeof value?.type === 'string' && typeof value.base64 === 'string'
const listOf = (value, valid) => Array.isArray(value) && value.every(valid)
function validBackup(data) {
  return !!data && listOf(data.profiles, p => text(p?.profile_id) && text(p.code))
    && listOf(data.vocabulary, v => text(v?.profile_id) && text(v.key))
    && listOf(data.settings, s => text(s?.key) && backedUp(s.key))
    && listOf(data.custom_symbols, w => isCustomKey(w?.symbol_id) && text(w.label_rw) && text(w.category) && file(w.image))
    && listOf(data.recordings, r => text(r?.key) && file(r.blob))
}

// Brings a snapshot onto this device. What it holds replaces the same children, settings, words
// and recordings here; anything else on this device stays.
export async function restoreBackup(snapshot) {
  const data = snapshot?.format === BACKUP_FORMAT ? snapshot.data : null
  if (!validBackup(data)) throw localizedError('Ibyabitswe kuri konti ntibisomeka. Bibike bundi bushya uhereye ku gikoresho byavuyeho.')
  const custom = data.custom_symbols.map(({ image, ...word }) => ({ ...word, image: toBlob(image) }))
  const recordings = data.recordings.map(({ blob, ...recording }) => ({ ...recording, blob: toBlob(blob) }))
  await db.transaction('rw', TABLES.map(name => db[name]), async () => {
    await db.profiles.bulkPut(data.profiles)
    // A child's hand-picked words come back as a whole list.
    await db.vocabulary.where('profile_id').anyOf(data.profiles.map(profile => profile.profile_id)).delete()
    await db.vocabulary.bulkPut(data.vocabulary)
    await db.settings.bulkPut(data.settings)
    await db.custom_symbols.bulkPut(custom)
    await db.recordings.bulkPut(recordings)
  })
  return { profiles: data.profiles.length, words: custom.length, recordings: recordings.length }
}

// A device nobody has set up yet: no children, custom words or recordings.
export async function isNewDevice() {
  const counts = await Promise.all([db.profiles.count(), db.custom_symbols.count(), db.recordings.count()])
  return counts.every(count => count === 0)
}

export async function backupFingerprint(snapshot) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot.data)))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}
