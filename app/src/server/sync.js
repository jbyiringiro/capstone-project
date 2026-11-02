// Upload completed messages only when an authorised adult asks and the device is online (FR7).
import { db } from '../storage/db.js'
import { SyncState, withEvents } from '../storage/messages.js'
import { localizedError } from '../shared/errors-rw.js'

export const MAX_BATCH = 1000

export async function syncPending(apiBase, token) {
  if (!navigator.onLine) return { skipped: 'offline' }
  if (!token) throw localizedError('Banza winjire muri konti mbere yo kohereza amakuru.')
  const pending = await db.messages.where('synced').equals(SyncState.PENDING).and(m => m.spoken_at).toArray()
  if (!pending.length) return { accepted_messages: 0 }
  // Resolve account ownership before building a batch. Shared devices can contain another
  // account's cached rows; local/demo profiles have no server identity and stay on device.
  const ownedResponse = await fetch(`${apiBase}/profiles`, { headers: { Authorization: `Bearer ${token}` } })
  if (!ownedResponse.ok) throw localizedError('Ntibyashobotse kugenzura imyirondoro ya konti yawe. Ongera winjire muri konti.')
  const owned = new Set((await ownedResponse.json()).map(profile => profile.profile_id))
  const allEligible = pending.filter(message => owned.has(message.profile_id))
  const eligible = allEligible.slice(0, MAX_BATCH)
  const skipped_local = pending.length - allEligible.length
  const remaining = allEligible.length - eligible.length
  if (!eligible.length) return { accepted_messages: 0, skipped_local }
  const messages = (await withEvents(eligible)).map(({ synced, ...message }) => message)
  const r = await fetch(`${apiBase}/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages })
  })
  if (!r.ok) throw localizedError('Kohereza amakuru ntibyashobotse. Amakuru aracyabitswe kuri iki gikoresho.')
  const result = await r.json()
  if (result.accepted_messages + result.duplicates !== eligible.length) throw localizedError('Amakuru yose ntiyemejwe ko yakiriwe. Ubutumwa buracyabitswe kugira ngo wongere kubwohereza.')
  await db.messages.bulkPut(eligible.map(m => ({ ...m, synced: SyncState.SYNCED })))
  return { ...result, skipped_local, remaining }
}
