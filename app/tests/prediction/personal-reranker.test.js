import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EOS, KneserNeyTrigram, PersonalHistory, PersonalReranker } from '../../src/prediction/index.js'

// Parity with vuga_ml.models.reranker: fixture produced by ml/scripts/export_reranker_fixture.py
const read = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8'))
const kn = read('kn_fixture.json'), fixture = read('reranker_fixture.json')

function fixtureReranker() {
  const history = new PersonalHistory()
  for (const r of fixture.records) history.record(r.prefix, r.symbol, r.t)
  return new PersonalReranker(new KneserNeyTrigram(kn.artifact), history, { ...fixture.weights, clock: () => fixture.now })
}

describe('PersonalReranker JS port', () => {
  const reranker = fixtureReranker()
  it('matches Python top-3 with and without the vocabulary mask', () => {
    const allowed = new Set(fixture.allowed)
    for (const c of fixture.cases) {
      expect(reranker.topK(c.prefix, 3)).toEqual(c.top3)
      expect(reranker.topK(c.prefix, 3, allowed)).toEqual(c.top3_masked)
    }
  })
  it('matches Python probabilities to 1e-9', () => {
    for (const d of fixture.distributions) {
      const p = reranker.predict(d.prefix, new Set(d.allowed))
      expect(Object.keys(p).sort()).toEqual(Object.keys(d.p).sort())
      for (const [symbol, expected] of Object.entries(d.p)) expect(Math.abs(p[symbol] - expected)).toBeLessThan(1e-9)
    }
  })
  it('raises the probability of words the child chose after the same word', () => {
    const allowed = new Set(fixture.allowed)
    const base = new KneserNeyTrigram(kn.artifact).predict(['I'], allowed)
    const personal = reranker.predict(['I'], allowed)
    const chosenAfterI = fixture.records.filter(r => r.prefix.at(-1) === 'I' && allowed.has(r.symbol)).map(r => r.symbol)
    expect(chosenAfterI).toContain('CUSTOM-FIXTURE')
    for (const symbol of chosenAfterI) expect(personal[symbol]).toBeGreaterThan(base[symbol])
    // With the frozen weights a word unseen in training is lifted but stays below the model's
    // plausible words: the history adds about +1.3 log-units against a 1000x mask floor.
    expect(reranker.topK(['I'], 3, allowed)).not.toContain('CUSTOM-FIXTURE')
  })
  it('falls back to the base ranking for a child with no history', () => {
    const base = new KneserNeyTrigram(kn.artifact)
    const fresh = new PersonalReranker(base, new PersonalHistory())
    for (const c of kn.cases.slice(0, 20)) expect(fresh.topK(c.prefix, 3)).toEqual(base.topK(c.prefix, 3))
    expect(fresh.name).toBe('kn_trigram+personal')
    const z = Object.values(fresh.predict(['I'])).reduce((a, b) => a + b, 0)
    expect(Math.abs(z - 1)).toBeLessThan(1e-9)
    expect(fresh.predict(['I'])[EOS]).toBeDefined()
  })
})

describe('PersonalHistory replay', () => {
  const event = (action_index, action_type, extra = {}) =>
    ({ action_index, action_type, ts: `2026-10-20T10:00:0${action_index}.000Z`, ...extra })
  it('scores each selection against the message as it stood, honouring corrections and clearing', () => {
    const history = PersonalHistory.fromMessages([{
      started_at: '2026-10-20T10:00:00.000Z',
      events: [
        event(0, 'select', { symbol_key: 'I' }), event(1, 'select', { symbol_key: 'GO' }),
        event(2, 'correct'), event(3, 'navigate', { context: 'cat:food_drink' }),
        event(4, 'select', { symbol_key: 'WATER' }), event(5, 'correct', { context: 'clear' }),
        event(6, 'select', { symbol_key: 'HELP' }), event(7, 'speak')
      ]
    }])
    expect(history.count('I')).toBe(1)
    expect(history.bigram('I', 'GO')).toBe(1)
    expect(history.bigram('I', 'WATER')).toBe(1)
    expect(history.bigram('GO', 'WATER')).toBe(0)
    expect(history.bigram('WATER', 'HELP')).toBe(0)
    expect(history.size).toBe(4)
    expect(history.lastUsed('HELP')).toBe(Date.parse('2026-10-20T10:00:06.000Z') / 1000)
  })
  it('replays messages in the order they were started, whatever order storage returns', () => {
    const message = (started_at, symbol_key, ts) =>
      ({ started_at, events: [{ action_index: 0, action_type: 'select', symbol_key, ts }] })
    const history = PersonalHistory.fromMessages([
      message('2026-10-20T11:00:00.000Z', 'WATER', '2026-10-20T11:00:01.000Z'),
      message('2026-10-20T09:00:00.000Z', 'WATER', '2026-10-20T09:00:01.000Z')
    ])
    expect(history.lastUsed('WATER')).toBe(Date.parse('2026-10-20T11:00:01.000Z') / 1000)
  })
})
