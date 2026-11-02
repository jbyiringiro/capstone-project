import { MessageSession } from '../board/message-session.js'
import { finaliseMessage, logAction, startDraft } from '../storage/messages.js'

const storage = { startDraft, logAction, finaliseMessage }

// In child mode one tap is a whole message: the word is selected and said at once. It is logged
// like any message (so the caregiver's summary counts the words the child uses) under the 'child'
// board mode, which keeps it on the device and out of the study comparison.
export async function logChildWord(profileId, key, ts = new Date().toISOString()) {
  const session = new MessageSession(storage, profileId, 'child')
  await session.record('select', { symbol_key: key, ts })
  await session.record('speak', { ts })
  await session.finish()
}
