// Serialises one message's persistence independently of rendering, so quick taps keep their order.
// The draft is created by the first action and every later action waits for the one before it;
// after a storage failure the session refuses further writes instead of logging out of order.
export class MessageSession {
  #storage
  #profileId
  #mode
  #id = null
  #index = 0
  #queue = Promise.resolve()
  #failure = null

  constructor(storage, profileId, mode) {
    this.#storage = storage
    this.#profileId = profileId
    this.#mode = mode
  }

  #enqueue(operation) {
    const next = this.#queue.then(() => {
      if (this.#failure) throw this.#failure
      return operation()
    })
    this.#queue = next.catch(error => { this.#failure = error })
    return next
  }

  record(type, extra = {}) {
    const event = { ...extra, ts: extra.ts ?? new Date().toISOString() }
    return this.#enqueue(async () => {
      if (!this.#id) this.#id = await this.#storage.startDraft(this.#profileId, this.#mode, event.ts)
      await this.#storage.logAction(this.#id, this.#index, type, event)
      this.#index += 1
    })
  }

  finish() {
    return this.#enqueue(async () => {
      if (!this.#id) return
      await this.#storage.finaliseMessage(this.#id, this.#index)
      this.#id = null
      this.#index = 0
    })
  }
}
