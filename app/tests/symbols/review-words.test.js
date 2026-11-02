import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { customBoardSymbol, parseSymbols } from '../../src/symbols/catalogue.js'
import { REVIEW_WORDS, parseReviewWords, reviewSets } from '../../src/symbols/review-words.js'

const bundled = parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf-8'))

describe('vocabulary review words', () => {
  it('lists the 32 sheet words once each, all of them bundled', () => {
    expect(REVIEW_WORDS).toHaveLength(32)
    expect(new Set(REVIEW_WORDS).size).toBe(32)
    const known = new Set(bundled.map(s => s.symbol_id))
    expect(REVIEW_WORDS.filter(key => !known.has(key))).toEqual([])
    expect(REVIEW_WORDS.slice(0, 3)).toEqual(['I', 'YOU', 'NOT'])
  })
  it('reads CRLF files, skips blank lines and refuses a file without its header', () => {
    expect(parseReviewWords('symbol_id\r\nYES\r\n\r\nNO\r\n')).toEqual(['YES', 'NO'])
    expect(() => parseReviewWords('YES\nNO\n')).toThrow(/symbol_id/)
  })
  it('offers the sheet first, then every bundled word by category, then each category, never custom words', () => {
    const custom = customBoardSymbol({ symbol_id: 'CUSTOM-1A2B3C4D', label_rw: 'nyogokuru', category: 'people' }, 'blob:x')
    const sets = reviewSets([...bundled, custom])
    expect(sets.map(set => set.id).slice(0, 2)).toEqual(['review', 'all'])
    expect(sets[0].keys).toEqual(REVIEW_WORDS)
    expect(sets[1].keys).toHaveLength(bundled.length)
    expect(new Set(sets[1].keys).size).toBe(bundled.length)
    expect(sets.flatMap(set => set.keys)).not.toContain('CUSTOM-1A2B3C4D')
    const categories = sets.slice(2)
    expect(categories.reduce((total, set) => total + set.keys.length, 0)).toBe(bundled.length)
    expect(sets[1].keys).toEqual(categories.flatMap(set => set.keys))
  })
  it('drops sheet words the catalogue does not have and empty lists', () => {
    const sets = reviewSets([{ symbol_id: 'WATER', label_rw: 'amazi', category: 'food_drink' }], ['WATER', 'GONE'])
    expect(sets.map(set => [set.id, set.keys])).toEqual([['review', ['WATER']], ['all', ['WATER']], ['food_drink', ['WATER']]])
  })
})
