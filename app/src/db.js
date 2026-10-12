// IndexedDB schema (Dexie). Mirrors the server tables the client owns offline.
// A draft message row is written BEFORE its first tap event (proposal 3.2.3, FR7).
import Dexie from 'dexie'
import { localizedError } from './errors-rw.js'

export const db = new Dexie('vuga')

db.version(1).stores({
  profiles: 'profile_id, code',
  symbols: 'key, category',
  vocabulary: '[profile_id+key], profile_id',
  messages: 'message_id, profile_id, spoken_at, synced',
  tap_events: 'event_id, message_id, action_index',
  settings: 'key'
})

db.version(2).stores({ recordings: 'key' })

export async function getProfiles() {
  return db.profiles.orderBy('code').toArray()
}

export async function createLocalProfile(code, age_band = null) {
  code = code.trim().toUpperCase()
  if (!/^[A-Z]-\d{2,3}$/.test(code)) throw localizedError('Koresha kode nka P-01.')
  return db.transaction('rw', db.profiles, async () => {
    if (await db.profiles.where('code').equals(code).count()) throw localizedError('Iyi kode isanzwe iri kuri iki gikoresho.')
    const profile = { profile_id: `local-${crypto.randomUUID()}`, code, age_band, access_method: 'touch', local_only: true }
    await db.profiles.add(profile)
    return profile
  })
}

// null means an unconfigured profile; [] means deliberately no enabled symbols.
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

export async function getRecording(key) { return (await db.recordings.get(key))?.blob ?? null }
export async function saveRecording(key, blob) {
  if (!(blob instanceof Blob) || !blob.size) throw localizedError('Nta jwi riri muri iyi dosiye.')
  await db.recordings.put({ key, blob, updated_at: new Date().toISOString() })
}
export async function deleteRecording(key) { await db.recordings.delete(key) }

export async function getLocalSummary(profileId) {
  const messages = await db.messages.where('profile_id').equals(profileId).and(m => !!m.spoken_at).toArray()
  const symbol_frequency = {}, by_board_mode = {}
  for (const m of messages) {
    const totals = by_board_mode[m.board_mode] ??= { messages: 0, taps: 0, duration_ms: 0 }
    totals.messages++; totals.taps += m.tap_count; totals.duration_ms += m.duration_ms ?? 0
    const events = await db.tap_events.where('message_id').equals(m.message_id).toArray()
    for (const e of events) if (e.action_type === 'select') symbol_frequency[e.symbol_key] = (symbol_frequency[e.symbol_key] ?? 0) + 1
  }
  for (const totals of Object.values(by_board_mode)) {
    totals.taps_per_message = totals.taps / totals.messages
    totals.seconds_per_message = totals.duration_ms / totals.messages / 1000
  }
  return { profile: profileId, by_board_mode, symbol_frequency: Object.fromEntries(Object.entries(symbol_frequency).sort((a, b) => b[1] - a[1])) }
}

// Explicit device export contains pseudonymous messages, never tokens or voice recordings.
export async function exportLocalData(profileId = null) {
  return db.transaction('r', db.profiles, db.messages, db.tap_events, async () => {
    const messages = profileId ? await db.messages.where('profile_id').equals(profileId).toArray() : await db.messages.toArray()
    const rows = []
    for (const message of messages) {
      const { synced, ...data } = message
      rows.push({ ...data, events: await db.tap_events.where('message_id').equals(message.message_id).sortBy('action_index') })
    }
    const profiles = (await db.profiles.toArray()).filter(profile => !profileId || profile.profile_id === profileId)
      .map(({ profile_id, code }) => ({ profile_id, code }))
    return { format: 'vuga-local-export-v1', exported_at: new Date().toISOString(), profiles, messages: rows }
  })
}

export async function startDraft(profile_id, board_mode, started_at = new Date().toISOString()) {
  const message_id = crypto.randomUUID()
  await db.messages.add({
    message_id, profile_id, board_mode,
    started_at, spoken_at: null,
    tap_count: 0, duration_ms: null, synced: 0
  })
  return message_id
}

// One row per task action: select | navigate | correct | speak. Only select carries symbol_key.
export async function logAction(message_id, action_index, action_type, extra = {}) {
  if (action_type === 'select' && !extra.symbol_key) throw new Error('select requires symbol_key')
  await db.tap_events.add({
    event_id: crypto.randomUUID(), message_id, action_index, action_type,
    symbol_key: extra.symbol_key ?? null, was_suggested: !!extra.was_suggested,
    context: extra.context ?? null, ts: extra.ts ?? new Date().toISOString()
  })
}

export async function finaliseMessage(message_id, tap_count) {
  const m = await db.messages.get(message_id)
  const first = await db.tap_events.where({ message_id }).sortBy('action_index')
  const t0 = first.length ? new Date(first[0].ts).getTime() : new Date(m.started_at).getTime()
  const spoken_at = new Date(first.findLast(e => e.action_type === 'speak')?.ts ?? Date.now())
  await db.messages.update(message_id, {
    spoken_at: spoken_at.toISOString(), tap_count, duration_ms: Math.max(0, spoken_at.getTime() - t0)
  })
}

// Upload only when an authorised adult asks and the device is online (FR7).
export async function syncPending(apiBase, token) {
  if (!navigator.onLine) return { skipped: 'offline' }
  if (!token) throw localizedError('Banza winjire muri konti mbere yo kohereza amakuru.')
  const pending = await db.messages.where('synced').equals(0).and(m => m.spoken_at).toArray()
  if (!pending.length) return { accepted_messages: 0 }
  // Resolve account ownership before building a batch. Shared devices can contain another
  // account's cached rows; local/demo profiles have no server identity and stay on device.
  const ownedResponse = await fetch(`${apiBase}/profiles`, { headers: { Authorization: `Bearer ${token}` } })
  if (!ownedResponse.ok) throw localizedError('Ntibyashobotse kugenzura imyirondoro ya konti yawe. Ongera winjire muri konti.')
  const owned = new Set((await ownedResponse.json()).map(profile => profile.profile_id))
  const allEligible = pending.filter(message => owned.has(message.profile_id))
  const eligible = allEligible.slice(0, 1000)
  const skipped_local = pending.length - allEligible.length
  const remaining = allEligible.length - eligible.length
  if (!eligible.length) return { accepted_messages: 0, skipped_local }
  const messages = []
  for (const m of eligible) {
    const events = await db.tap_events.where({ message_id: m.message_id }).sortBy('action_index')
    const { synced, ...rest } = m
    messages.push({ ...rest, events })
  }
  const r = await fetch(`${apiBase}/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages })
  })
  if (!r.ok) throw localizedError('Kohereza amakuru ntibyashobotse. Amakuru aracyabitswe kuri iki gikoresho.')
  const result = await r.json()
  if (result.accepted_messages + result.duplicates !== eligible.length) throw localizedError('Amakuru yose ntiyemejwe ko yakiriwe. Ubutumwa buracyabitswe kugira ngo wongere kubwohereza.')
  await db.messages.bulkPut(eligible.map(m => ({ ...m, synced: 1 })))
  return { ...result, skipped_local, remaining }
}
