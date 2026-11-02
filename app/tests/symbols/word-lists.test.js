import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSymbols } from '../../src/symbols/catalogue.js'
import { HOME_KEYS } from '../../src/symbols/categories.js'
import { ENVIRONMENTS, FRINGE_CATEGORIES, MAX_ENVIRONMENT_WORDS, environmentWords, isCoreWord, placeVocabulary } from '../../src/symbols/environments.js'
import { MAX_RELATED, RELATED_WORDS, relatedTriggers, relatedWords } from '../../src/symbols/related-words.js'

const symbols = parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf-8'))
const byKey = Object.fromEntries(symbols.map(s => [s.symbol_id, s]))
const all = new Set(symbols.map(s => s.symbol_id))

describe('next words after a picture', () => {
  it('opens drinks after "kunywa": cup, juice, milk and water', () => {
    expect(relatedWords('DRINK').map(key => byKey[key].label_rw)).toEqual(expect.arrayContaining(['igikombe', 'umutobe', 'amata', 'amazi']))
  })
  it('lists only bundled words, never the picture itself or a repeat, within the page limit', () => {
    for (const [key, list] of Object.entries(RELATED_WORDS)) {
      expect(all.has(key), key).toBe(true)
      expect(list.length, key).toBeLessThanOrEqual(MAX_RELATED)
      expect(new Set(list).size, key).toBe(list.length)
      expect(list, key).not.toContain(key)
      for (const next of list) expect(all.has(next), `${key} -> ${next}`).toBe(true)
    }
  })
  it('uses a caregiver’s own list, including an empty one, and adds their own pictures', () => {
    const custom = { DRINK: ['MILK'], EAT: [], 'CUSTOM-1A2B3C4D': ['WATER'] }
    expect(relatedWords('DRINK', custom)).toEqual(['MILK'])
    expect(relatedWords('EAT', custom)).toEqual([])
    expect(relatedWords('PLAY', custom)).toEqual(RELATED_WORDS.PLAY)
    expect(relatedWords('YES')).toEqual([])
    expect(relatedTriggers(custom)).toEqual(expect.arrayContaining(['DRINK', 'PLAY', 'CUSTOM-1A2B3C4D']))
  })
})

describe('words for where the child is', () => {
  it('names only bundled naming words, without repeats', () => {
    for (const place of ENVIRONMENTS) {
      expect(new Set(place.keys).size, place.id).toBe(place.keys.length)
      expect(place.keys.length, place.id).toBeLessThanOrEqual(MAX_ENVIRONMENT_WORDS)
      expect(all.has(place.symbol), place.id).toBe(true)
      for (const key of place.keys) {
        expect(all.has(key), `${place.id}: ${key}`).toBe(true)
        expect(FRINGE_CATEGORIES.includes(byKey[key].category) || HOME_KEYS.includes(key), `${place.id}: ${key}`).toBe(true)
      }
    }
  })
  it('keeps core words, actions, feelings, the body and the everyday page in every place', () => {
    const enabled = new Set(all)
    for (const place of ENVIRONMENTS) {
      const allowed = placeVocabulary(symbols, enabled, place.id)
      for (const key of [...HOME_KEYS, 'I', 'NOT', 'GO', 'HURT', 'HEAD', 'WHERE', 'HELLO', 'BIG', 'NOW']) expect(allowed.has(key), `${place.id}: ${key}`).toBe(true)
    }
    expect(isCoreWord(byKey.WANT)).toBe(true)
    expect(isCoreWord(byKey.CUP)).toBe(false)
  })
  it('shows a meal’s food and things but hides the classroom’s', () => {
    const allowed = placeVocabulary(symbols, new Set(all), 'meal')
    for (const key of ['CUP', 'SPOON', 'PORRIDGE', 'JUICE']) expect(allowed.has(key), key).toBe(true)
    for (const key of ['PEN', 'BICYCLE', 'COW']) expect(allowed.has(key), key).toBe(false)
    expect(placeVocabulary(symbols, new Set(all), 'all').size).toBe(symbols.length)
  })
  it('never shows a word the child’s vocabulary leaves out, and follows the caregiver’s own list', () => {
    const enabled = new Set(['I', 'WANT', 'CUP', 'PEN'])
    expect([...placeVocabulary(symbols, enabled, 'meal')].sort()).toEqual(['CUP', 'I', 'WANT'])
    expect([...placeVocabulary(symbols, enabled, 'meal', { meal: ['PEN'] })].sort()).toEqual(['I', 'PEN', 'WANT'])
    expect(environmentWords('meal', { meal: [] })).toEqual([])
    expect(placeVocabulary(symbols, enabled, 'unknown').size).toBe(4)
  })
})
