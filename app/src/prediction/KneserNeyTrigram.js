// On-device interpolated Kneser-Ney trigram reading the JSON artefact exported by ml/vuga_ml.
// Kept numerically identical to vuga_ml/models/ngram.py so that browser and server agree.
// Context totals, type counts and the continuation unigram are computed once when the artefact
// loads, so scoring one context is O(V) instead of re-summing every context for every word.
import { BOS, Predictor } from './Predictor.js'

const SEP = '\u0001'

// Counts of the words that followed one context, with the totals smoothing needs.
class ContextCounts {
  constructor() {
    this.next = new Map()
    this.total = 0
  }
  add(word, count) {
    this.next.set(word, (this.next.get(word) ?? 0) + count)
    this.total += count
  }
  count(word) { return this.next.get(word) ?? 0 }
  get types() { return this.next.size }
}

export class KneserNeyTrigram extends Predictor {
  constructor(artifact) {
    super()
    this.discount = artifact.discount
    this.vocab = artifact.vocab
    this.trigrams = new Map()                 // "w1 SEP w2" -> words after the pair
    this.continuations = new Map()            // w2 -> {w3: number of distinct w1 before (w2, w3)}
    for (const [w1, w2, next] of artifact.tri) {
      const context = new ContextCounts()
      for (const [w3, count] of Object.entries(next)) {
        context.add(w3, count)
        if (!this.continuations.has(w2)) this.continuations.set(w2, new ContextCounts())
        this.continuations.get(w2).add(w3, 1)
      }
      this.trigrams.set(`${w1}${SEP}${w2}`, context)
    }
    // Continuation unigram: in how many distinct (w2, w3) pairs each w3 appears.
    const pairCounts = new Map()
    for (const context of this.continuations.values()) {
      for (const w3 of context.next.keys()) pairCounts.set(w3, (pairCounts.get(w3) ?? 0) + 1)
    }
    const pairs = [...pairCounts.values()].reduce((a, b) => a + b, 0)
    const continuation = count => pairs
      ? (count + 1e-9) / (pairs + 1e-9 * this.vocab.length)
      : 1 / Math.max(this.vocab.length, 1)
    this.unigram = new Map(this.vocab.map(word => [word, continuation(pairCounts.get(word) ?? 0)]))
    this.unseen = continuation(0)
  }

  get name() { return 'kn_trigram' }

  pUni(word) { return this.unigram.get(word) ?? this.unseen }

  // Absolute discounting with interpolation towards the lower-order estimate.
  interpolate(context, word, lower) {
    if (!context) return lower
    const lambda = this.discount * context.types / context.total
    return Math.max(context.count(word) - this.discount, 0) / context.total + lambda * lower
  }

  pBi(w2, w3) { return this.interpolate(this.continuations.get(w2), w3, this.pUni(w3)) }

  pTri(w1, w2, w3) { return this.interpolate(this.trigrams.get(`${w1}${SEP}${w2}`), w3, this.pBi(w2, w3)) }

  scores(prefix) {
    const padded = [BOS, BOS, ...prefix]
    const w1 = padded[padded.length - 2], w2 = padded[padded.length - 1]
    const trigram = this.trigrams.get(`${w1}${SEP}${w2}`)
    const bigram = this.continuations.get(w2)
    const out = {}
    for (const word of this.vocab) {
      out[word] = this.interpolate(trigram, word, this.interpolate(bigram, word, this.pUni(word)))
    }
    return out
  }
}
