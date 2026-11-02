// Common interface of the on-device next-symbol models, mirroring ml/vuga_ml/models/base.py.
// Subclasses only provide scores(); the vocabulary mask, normalisation and ranking are shared, so
// every model is constrained to the child's enabled words in exactly the same way.
import { topK } from './top-k.js'

export const BOS = '<s>'
export const EOS = '</s>'

export class Predictor {
  get name() { return 'base' }

  // Unnormalised, non-negative scores over the training vocabulary, including EOS.
  scores(_prefix) {
    throw new Error(`${this.constructor.name} must implement scores(prefix)`)
  }

  // Probability distribution over `allowed` (the enabled vocabulary) plus EOS.
  predict(prefix, allowed = null) {
    const raw = this.scores(prefix)
    return normalise(allowed ? applyMask(raw, allowed) : raw)
  }

  topK(prefix, k = 3, allowed = null) {
    return topK(this.predict(prefix, allowed), k, EOS)
  }
}

// Enabled words the model never saw in training (custom words, for example) still get a small
// floor, so the distribution covers the whole board.
export function applyMask(raw, allowed) {
  const mask = [...allowed, EOS]
  const kept = {}
  let smallest = Infinity
  for (const key of mask) {
    if (key in raw) {
      kept[key] = raw[key]
      if (raw[key] > 0 && raw[key] < smallest) smallest = raw[key]
    }
  }
  const floor = (Number.isFinite(smallest) ? smallest : 1) * 1e-3
  for (const key of mask) if (!(key in kept)) kept[key] = floor
  return kept
}

export function normalise(raw) {
  const keys = Object.keys(raw)
  const total = keys.reduce((sum, key) => sum + raw[key], 0)
  const out = {}
  for (const key of keys) out[key] = total > 0 ? raw[key] / total : 1 / keys.length
  return out
}
