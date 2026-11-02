import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { KnTrigram } from '../src/predictor.js'

// Parity with the Python KneserNeyTrigram: fixture produced by ml/scripts/export_artifacts.py
const fixture = JSON.parse(readFileSync(new URL('./fixtures/kn_fixture.json', import.meta.url), 'utf-8'))

describe('KnTrigram JS port', () => {
  const model = new KnTrigram(fixture.artifact)
  it('returns a normalised distribution including EOS', () => {
    const d = model.predict(['I'])
    const z = Object.values(d).reduce((a, b) => a + b, 0)
    expect(Math.abs(z - 1)).toBeLessThan(1e-9)
    expect(d['</s>']).toBeDefined()
  })
  it('matches Python top-3 on every fixture case', () => {
    for (const c of fixture.cases) expect(model.topK(c.prefix, 3)).toEqual(c.top3)
  })
  it('matches Python top-3 under the vocabulary mask', () => {
    const allowed = new Set(fixture.allowed)
    for (const c of fixture.cases) expect(model.topK(c.prefix, 3, allowed)).toEqual(c.top3_masked)
  })
})
