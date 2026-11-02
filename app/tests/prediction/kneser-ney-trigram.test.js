import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EOS, KneserNeyTrigram, Predictor, predictorFromArtifact } from '../../src/prediction/index.js'

// Parity with the Python KneserNeyTrigram: fixture produced by ml/scripts/export_artifacts.py
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kn_fixture.json', import.meta.url), 'utf-8'))

describe('KneserNeyTrigram JS port', () => {
  const model = new KneserNeyTrigram(fixture.artifact)
  it('returns a normalised distribution including EOS', () => {
    const d = model.predict(['I'])
    const z = Object.values(d).reduce((a, b) => a + b, 0)
    expect(Math.abs(z - 1)).toBeLessThan(1e-9)
    expect(d[EOS]).toBeDefined()
  })
  it('matches Python top-3 on every fixture case', () => {
    for (const c of fixture.cases) expect(model.topK(c.prefix, 3)).toEqual(c.top3)
  })
  it('matches Python top-3 under the vocabulary mask', () => {
    const allowed = new Set(fixture.allowed)
    for (const c of fixture.cases) expect(model.topK(c.prefix, 3, allowed)).toEqual(c.top3_masked)
  })
  it('only suggests enabled words, and gives enabled words unseen in training a small floor', () => {
    const allowed = new Set(['I', 'WANT', 'CUSTOM-NEW'])
    const d = model.predict(['I'], allowed)
    expect(Object.keys(d).sort()).toEqual([EOS, 'CUSTOM-NEW', 'I', 'WANT'].sort())
    expect(d['CUSTOM-NEW']).toBeGreaterThan(0)
    expect(d['CUSTOM-NEW']).toBeLessThan(d.WANT)
    expect(model.topK(['I'], 3, allowed)).not.toContain(EOS)
  })
})

describe('Predictor interface', () => {
  it('builds the model named by the artefact type and rejects unknown types', () => {
    expect(predictorFromArtifact(fixture.artifact)).toBeInstanceOf(KneserNeyTrigram)
    expect(() => predictorFromArtifact({ type: 'gru' })).toThrow('unknown model type')
  })
  it('requires subclasses to provide scores and shares masking and ranking', () => {
    expect(() => new Predictor().predict([])).toThrow('must implement scores')
    class Fixed extends Predictor { scores() { return { A: 2, B: 1, C: 1, [EOS]: 4 } } }
    expect(new Fixed().topK([], 3)).toEqual(['A', 'B', 'C'])
    expect(new Fixed().topK([], 2, new Set(['C', 'B']))).toEqual(['B', 'C'])
  })
})
