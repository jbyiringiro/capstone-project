// "Shakisha" picture-finding game: Vuga says a word and the child finds its picture on their own
// board. Pictures stay where they always are, so practice builds the motor memory the child uses
// to communicate. The game is never logged as communication.
//
// Targets are drawn with weights favouring words this child has found less easily before, never
// the same word twice in a row. After two misses the correct picture is highlighted (errorless
// learning), and every picture found earns a star: the reward is for finding, not for speed.
export const HINT_AFTER_MISSES = 2

export class FindGame {
  #keys
  #random
  #history
  #rounds = []
  #current = null

  constructor(keys, { rounds = 5, random = Math.random, history = {} } = {}) {
    if (new Set(keys).size < 2) throw new Error('the game needs at least two different pictures')
    this.#keys = [...new Set(keys)]
    this.#random = random
    this.#history = history
    this.length = rounds
    this.#next()
  }

  get target() { return this.#current?.target ?? null }
  get round() { return this.#rounds.length + (this.#current ? 1 : 0) }
  get finished() { return this.#current === null }
  get stars() { return this.#rounds.length }
  get results() { return this.#rounds.map(round => ({ ...round })) }

  // Weight = 1 + earlier rounds not found first time + a small bonus for words asked rarely.
  weight(key) {
    const { asked = 0, firstTry = 0 } = this.#history[key] ?? {}
    return 1 + (asked - firstTry) + 1 / (1 + asked)
  }

  answer(key) {
    if (this.finished) throw new Error('the game is finished')
    const round = this.#current
    if (key !== round.target) {
      round.misses += 1
      return { correct: false, hint: round.misses >= HINT_AFTER_MISSES }
    }
    this.#rounds.push({ target: round.target, misses: round.misses, hinted: round.misses >= HINT_AFTER_MISSES })
    const previous = round.target
    this.#current = null
    if (this.#rounds.length < this.length) this.#next(previous)
    return { correct: true, hint: false, finished: this.finished }
  }

  #next(previous = null) {
    const candidates = this.#keys.filter(key => key !== previous)
    const weights = candidates.map(key => this.weight(key))
    let pick = this.#random() * weights.reduce((a, b) => a + b, 0)
    let target = candidates[candidates.length - 1]
    for (let i = 0; i < candidates.length; i++) {
      pick -= weights[i]
      if (pick < 0) { target = candidates[i]; break }
    }
    this.#current = { target, misses: 0 }
  }
}
