// One child's own selection history: how often each word was chosen, when it was last chosen and
// which word it followed (proposal 3.3.2). Times are in seconds, as in vuga_ml/models/reranker.py.
const SEP = '\u0001'

export class PersonalHistory {
  #counts = new Map()
  #bigrams = new Map()
  #lastUsed = new Map()

  record(prefix, symbol, time) {
    this.#counts.set(symbol, this.count(symbol) + 1)
    if (prefix.length) {
      const pair = `${prefix[prefix.length - 1]}${SEP}${symbol}`
      this.#bigrams.set(pair, (this.#bigrams.get(pair) ?? 0) + 1)
    }
    this.#lastUsed.set(symbol, time)
  }

  count(symbol) { return this.#counts.get(symbol) ?? 0 }
  bigram(previous, symbol) { return this.#bigrams.get(`${previous}${SEP}${symbol}`) ?? 0 }
  lastUsed(symbol) { return this.#lastUsed.get(symbol) }
  get size() { return [...this.#counts.values()].reduce((a, b) => a + b, 0) }

  // Replays stored action logs. A selection is scored against the message as it stood at that
  // moment, so corrections ("Siba") and clearing ("Siba byose") change the context of later picks.
  static fromMessages(messages) {
    const history = new PersonalHistory()
    const ordered = [...messages].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    for (const message of ordered) {
      let draft = []
      for (const event of [...message.events].sort((a, b) => a.action_index - b.action_index)) {
        if (event.action_type === 'select' && event.symbol_key) {
          history.record(draft, event.symbol_key, Date.parse(event.ts) / 1000)
          draft = [...draft, event.symbol_key]
        } else if (event.action_type === 'correct') {
          draft = event.context === 'clear' ? [] : draft.slice(0, -1)
        }
      }
    }
    return history
  }
}
