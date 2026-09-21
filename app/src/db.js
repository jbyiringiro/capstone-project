// IndexedDB schema (Dexie). Mirrors the server tables the client owns offline.
// A draft message row is written BEFORE its first tap event (proposal 3.2.3, FR7).
import Dexie from 'dexie'

export const db = new Dexie('vuga')

db.version(1).stores({
  profiles: 'profile_id, code',
  symbols: 'key, category',
  vocabulary: '[profile_id+key], profile_id',
  messages: 'message_id, profile_id, spoken_at, synced',
  tap_events: 'event_id, message_id, action_index',
  settings: 'key'
})

export async function startDraft(profile_id, board_mode) {
  const message_id = crypto.randomUUID()
  await db.messages.add({
    message_id, profile_id, board_mode,
    started_at: new Date().toISOString(), spoken_at: null,
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
    context: extra.context ?? null, ts: new Date().toISOString()
  })
}

export async function finaliseMessage(message_id, tap_count) {
  const m = await db.messages.get(message_id)
  const first = await db.tap_events.where({ message_id }).sortBy('action_index')
  const t0 = first.length ? new Date(first[0].ts).getTime() : new Date(m.started_at).getTime()
  const spoken_at = new Date()
  await db.messages.update(message_id, {
    spoken_at: spoken_at.toISOString(), tap_count, duration_ms: spoken_at.getTime() - t0
  })
}

// Upload only when an authorised adult asks and the device is online (FR7).
export async function syncPending(apiBase, token) {
  if (!navigator.onLine) return { skipped: 'offline' }
  const pending = await db.messages.where('synced').equals(0).and(m => m.spoken_at).toArray()
  if (!pending.length) return { accepted_messages: 0 }
  const messages = []
  for (const m of pending) {
    const events = await db.tap_events.where({ message_id: m.message_id }).sortBy('action_index')
    const { synced, ...rest } = m
    messages.push({ ...rest, events })
  }
  const r = await fetch(`${apiBase}/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages })
  })
  if (!r.ok) throw new Error(`sync failed: ${r.status}`)
  await db.messages.bulkPut(pending.map(m => ({ ...m, synced: 1 })))
  return r.json()
}
