// IndexedDB schema (Dexie). Mirrors the server tables the client owns offline; each store's
// queries live in its own module in this folder.
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

db.version(2).stores({ recordings: 'key' })

// Caregiver-made words (FR3): picture blob, Kinyarwanda label and category, device-only.
db.version(3).stores({ custom_symbols: 'symbol_id, created_at', vocabulary: '[profile_id+key], profile_id, key' })

// Picture-finding game results per child (device-only, never exported or synced).
db.version(4).stores({ game_sessions: '++id, profile_id, finished_at' })
