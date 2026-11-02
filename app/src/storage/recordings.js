// Caregiver voice recordings, one per word, shared by every profile on this device. They are never in
// the messages export or the message sync; a signed-in caregiver's account backup keeps them
// (storage/backup.js).
import { db } from './db.js'
import { localizedError } from '../shared/errors-rw.js'

export async function getRecording(key) { return (await db.recordings.get(key))?.blob ?? null }

export async function saveRecording(key, blob) {
  if (!(blob instanceof Blob) || !blob.size) throw localizedError('Nta jwi riri muri iyi dosiye.')
  await db.recordings.put({ key, blob, updated_at: new Date().toISOString() })
}

export async function deleteRecording(key) { await db.recordings.delete(key) }

export function recordedKeys() { return db.recordings.toCollection().primaryKeys() }
