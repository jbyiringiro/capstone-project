import { describe, expect, it } from 'vitest'
import { topK } from '../../src/prediction/top-k.js'

const bySort = (d, k, exclude) => Object.entries(d).filter(([s]) => s !== exclude)
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k).map(([s]) => s)

describe('bounded top-k selection', () => {
  it('agrees with a full sort on random distributions, including ties', () => {
    let seed = 7
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let trial = 0; trial < 300; trial++) {
      const d = {}
      const n = 1 + Math.floor(random() * 60)
      for (let i = 0; i < n; i++) d[`S${Math.floor(random() * 500)}`] = Math.round(random() * 8) / 8
      for (const k of [0, 1, 3, 5, 80]) expect(topK(d, k, 'S1')).toEqual(bySort(d, k, 'S1'))
    }
  })
  it('breaks ties on the symbol key like the Python sort', () => {
    expect(topK({ WANT: 0.2, HELP: 0.2, I: 0.2, NO: 0.1 }, 3)).toEqual(['HELP', 'I', 'WANT'])
  })
})
