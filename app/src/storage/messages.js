// Message and action log. A draft message row is written BEFORE its first tap event
// (proposal 3.2.3, FR7), and every task action is one event, so tap totals include Speak.
import { db } from './db.js'
import { isCustomKey } from './custom-symbols.js'

// `synced` values. Messages that use a caregiver's custom word never leave the device: the
// server has no such symbol, and the word may name or show a family member. Child-mode taps
// stay on the device too: they are not part of the static/predictive comparison.
export const SyncState = Object.freeze({ PENDING: 0, SYNCED: 1, DEVICE_ONLY: -1 })

export async function startDraft(profile_id, board_mode, started_at = new Date().toISOString()) {
  const message_id = crypto.randomUUID()
  await db.messages.add({
    message_id, profile_id, board_mode,
    started_at, spoken_at: null,
    tap_count: 0, duration_ms: null, synced: SyncState.PENDING
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
  const events = await db.tap_events.where({ message_id }).sortBy('action_index')
  const t0 = events.length ? new Date(events[0].ts).getTime() : new Date(m.started_at).getTime()
  const spoken_at = new Date(events.findLast(e => e.action_type === 'speak')?.ts ?? Date.now())
  const deviceOnly = m.board_mode === 'child' || events.some(e => isCustomKey(e.symbol_key))
  await db.messages.update(message_id, {
    spoken_at: spoken_at.toISOString(), tap_count, duration_ms: Math.max(0, spoken_at.getTime() - t0),
    synced: deviceOnly ? SyncState.DEVICE_ONLY : SyncState.PENDING
  })
}

// Attaches each message's events in action order with one query instead of one per message.
export async function withEvents(messages) {
  const events = await db.tap_events.where('message_id').anyOf(messages.map(m => m.message_id)).toArray()
  const byMessage = new Map(messages.map(m => [m.message_id, []]))
  for (const event of events) byMessage.get(event.message_id)?.push(event)
  return messages.map(m => ({ ...m, events: byMessage.get(m.message_id).sort((a, b) => a.action_index - b.action_index) }))
}

export async function completedMessages(profileId, boardMode = null) {
  const messages = await db.messages.where('profile_id').equals(profileId)
    .and(m => !!m.spoken_at && (!boardMode || m.board_mode === boardMode)).toArray()
  return withEvents(messages)
}

export async function getLocalSummary(profileId) {
  const symbol_frequency = {}, by_board_mode = {}
  for (const m of await completedMessages(profileId)) {
    const totals = by_board_mode[m.board_mode] ??= { messages: 0, taps: 0, duration_ms: 0 }
    totals.messages++; totals.taps += m.tap_count; totals.duration_ms += m.duration_ms ?? 0
    for (const e of m.events) if (e.action_type === 'select') symbol_frequency[e.symbol_key] = (symbol_frequency[e.symbol_key] ?? 0) + 1
  }
  for (const totals of Object.values(by_board_mode)) {
    totals.taps_per_message = totals.taps / totals.messages
    totals.seconds_per_message = totals.duration_ms / totals.messages / 1000
  }
  return { profile: profileId, by_board_mode, symbol_frequency: Object.fromEntries(Object.entries(symbol_frequency).sort((a, b) => b[1] - a[1])) }
}

export function countPendingUploads() {
  return db.messages.where('synced').equals(SyncState.PENDING).and(m => !!m.spoken_at).count()
}

// Explicit device export contains pseudonymous messages, never tokens or voice recordings.
export async function exportLocalData(profileId = null) {
  return db.transaction('r', db.profiles, db.messages, db.tap_events, async () => {
    const messages = profileId ? await db.messages.where('profile_id').equals(profileId).toArray() : await db.messages.toArray()
    const rows = (await withEvents(messages)).map(({ synced, ...data }) => data)
    const profiles = (await db.profiles.toArray()).filter(profile => !profileId || profile.profile_id === profileId)
      .map(({ profile_id, code }) => ({ profile_id, code }))
    return { format: 'vuga-local-export-v1', exported_at: new Date().toISOString(), profiles, messages: rows }
  })
}
