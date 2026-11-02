import { db } from './db.js'

// null means an unconfigured profile (every word shown); [] means deliberately no enabled words.
export async function getVocabulary(profileId) {
  const rows = await db.vocabulary.where('profile_id').equals(profileId).toArray()
  const configured = await db.settings.get(`vocabulary:${profileId}`)
  return configured || rows.length ? rows.map(row => row.key) : null
}

export async function setVocabulary(profileId, keys) {
  await db.transaction('rw', db.vocabulary, db.settings, async () => {
    await db.vocabulary.where('profile_id').equals(profileId).delete()
    await db.vocabulary.bulkPut([...new Set(keys)].map(key => ({ profile_id: profileId, key })))
    await db.settings.put({ key: `vocabulary:${profileId}`, value: true })
  })
}
