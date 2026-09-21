// On-device Kneser-Ney trigram predictor reading the JSON artefact exported by ml/vuga_ml.
// Kept numerically identical to vuga_ml/models/ngram.py so that browser and server agree.
const BOS = '<s>', EOS = '</s>'

export class KnTrigram {
  constructor(artifact) {
    this.d = artifact.discount
    this.vocab = artifact.vocab
    this.tri = new Map()
    for (const [w1, w2, nxt] of artifact.tri) this.tri.set(`${w1}\u0001${w2}`, nxt)
    this.biCont = new Map()
    const pairs = new Set()
    for (const [key, nxt] of this.tri) {
      const w2 = key.split('\u0001')[1]
      if (!this.biCont.has(w2)) this.biCont.set(w2, {})
      for (const w3 of Object.keys(nxt)) { this.biCont.get(w2)[w3] = (this.biCont.get(w2)[w3] || 0) + 1; pairs.add(`${w2}\u0001${w3}`) }
    }
    this.uniCont = {}
    for (const p of pairs) { const w3 = p.split('\u0001')[1]; this.uniCont[w3] = (this.uniCont[w3] || 0) + 1 }
    this.uniTotal = Object.values(this.uniCont).reduce((a, b) => a + b, 0)
  }
  pUni(w) {
    if (!this.uniTotal) return 1 / Math.max(this.vocab.length, 1)
    return ((this.uniCont[w] || 0) + 1e-9) / (this.uniTotal + 1e-9 * this.vocab.length)
  }
  pBi(w2, w3) {
    const nxt = this.biCont.get(w2); const pu = this.pUni(w3)
    if (!nxt) return pu
    const total = Object.values(nxt).reduce((a, b) => a + b, 0)
    const lam = this.d * Object.keys(nxt).length / total
    return Math.max((nxt[w3] || 0) - this.d, 0) / total + lam * pu
  }
  pTri(w1, w2, w3) {
    const nxt = this.tri.get(`${w1}\u0001${w2}`); const pb = this.pBi(w2, w3)
    if (!nxt) return pb
    const total = Object.values(nxt).reduce((a, b) => a + b, 0)
    const lam = this.d * Object.keys(nxt).length / total
    return Math.max((nxt[w3] || 0) - this.d, 0) / total + lam * pb
  }
  // distribution over `allowed` (enabled vocabulary) + EOS, as in Predictor.predict
  predict(prefix, allowed = null) {
    const p = [BOS, BOS, ...prefix]
    const w1 = p[p.length - 2], w2 = p[p.length - 1]
    let raw = {}
    for (const w of this.vocab) raw[w] = this.pTri(w1, w2, w)
    if (allowed) {
      const mask = new Set([...allowed, EOS])
      const kept = Object.fromEntries(Object.entries(raw).filter(([k]) => mask.has(k)))
      const positives = Object.values(kept).filter(v => v > 0)
      const floor = (positives.length ? Math.min(...positives) : 1) * 1e-3
      for (const k of mask) if (!(k in kept)) kept[k] = floor
      raw = kept
    }
    const z = Object.values(raw).reduce((a, b) => a + b, 0)
    for (const k in raw) raw[k] /= z
    return raw
  }
  topK(prefix, k = 3, allowed = null) {
    return Object.entries(this.predict(prefix, allowed))
      .filter(([s]) => s !== EOS)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, k).map(([s]) => s)
  }
}

export async function loadPredictor(url = '/models/kn_trigram.json') {
  const r = await fetch(url)
  if (!r.ok) return null
  return new KnTrigram(await r.json())
}
