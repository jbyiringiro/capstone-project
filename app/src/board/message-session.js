// Serialise persistence independently of rendering, so quick taps keep their order.
export function createMessageSession({ startDraft, logAction, finaliseMessage }, profileId, mode) {
  let id = null
  let index = 0
  let queue = Promise.resolve()
  let failure = null
  const enqueue = operation => {
    const next = queue.then(() => {
      if (failure) throw failure
      return operation()
    })
    queue = next.catch(error => { failure = error })
    return next
  }
  return {
    record(type, extra = {}) {
      const event = { ...extra, ts: extra.ts ?? new Date().toISOString() }
      return enqueue(async () => {
        if (!id) id = await startDraft(profileId, mode, event.ts)
        await logAction(id, index, type, event)
        index += 1
      })
    },
    finish() {
      return enqueue(async () => {
        if (!id) return
        await finaliseMessage(id, index)
        id = null
        index = 0
      })
    }
  }
}
