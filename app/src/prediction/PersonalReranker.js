// Personal re-ranker applied on top of a frozen model, a port of vuga_ml/models/reranker.py:
//
//   score(s) = log p_model(s | prefix)
//            + wFreq * log(1 + count[s])
//            + wRec  * exp(-(now - lastUsed[s]) / tau)
//            + wCtx  * log(1 + bigram[(prefix[-1], s)])
//
// followed by a softmax. It decorates any Predictor, so the board treats it like the base model.
import { Predictor } from './Predictor.js'

export const RERANKER_WEIGHTS = Object.freeze({ wFreq: 0.3, wRec: 0.3, wCtx: 0.5, tau: 3600 })

export class PersonalReranker extends Predictor {
  constructor(model, history, { clock = () => Date.now() / 1000, ...weights } = {}) {
    super()
    this.model = model
    this.history = history
    this.clock = clock
    Object.assign(this, RERANKER_WEIGHTS, weights)
  }

  get name() { return `${this.model.name}+personal` }

  predict(prefix, allowed = null) {
    const base = this.model.predict(prefix, allowed)
    const now = this.clock()
    const previous = prefix[prefix.length - 1]
    const scores = {}
    let best = -Infinity
    for (const [symbol, p] of Object.entries(base)) {
      let score = Math.log(Math.max(p, 1e-12)) + this.wFreq * Math.log1p(this.history.count(symbol))
      const lastUsed = this.history.lastUsed(symbol)
      if (lastUsed !== undefined) score += this.wRec * Math.exp(-Math.max(now - lastUsed, 0) / this.tau)
      if (prefix.length) score += this.wCtx * Math.log1p(this.history.bigram(previous, symbol))
      scores[symbol] = score
      if (score > best) best = score
    }
    // Subtracting the best score before exponentiating keeps the softmax from overflowing.
    let total = 0
    for (const symbol in scores) { scores[symbol] = Math.exp(scores[symbol] - best); total += scores[symbol] }
    for (const symbol in scores) scores[symbol] /= total
    return scores
  }
}
