import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSymbols } from '../../src/symbols/catalogue.js'
import { CATEGORY_ORDER, HOME_KEYS, LOCKED_KEYS, isLockedKey, withLockedKeys } from '../../src/symbols/categories.js'
import { ENVIRONMENTS, placeVocabulary } from '../../src/symbols/environments.js'
import { fixedSectionKeys, sectionKeys } from '../../src/board/sections.js'
import { gridPage } from '../../src/board/grid-pages.js'

const symbols = parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf-8'))
const byKey = Object.fromEntries(symbols.map(s => [s.symbol_id, s]))

describe('words no adult can hide', () => {
  it('are oya, gufasha, kubabara and umusarani, all in the catalogue and on the home row', () => {
    expect(LOCKED_KEYS.map(key => byKey[key].label_rw)).toEqual(['oya', 'gufasha', 'kubabara', 'umusarani'])
    for (const key of LOCKED_KEYS) expect(HOME_KEYS).toContain(key)
    expect(isLockedKey('NO')).toBe(true)
    expect(isLockedKey('WATER')).toBe(false)
  })
  it('are added to any choice of words, once, after the caregiver’s own', () => {
    expect(withLockedKeys([])).toEqual([...LOCKED_KEYS])
    expect(withLockedKeys(['I', 'WATER'])).toEqual(['I', 'WATER', ...LOCKED_KEYS])
    expect(withLockedKeys(['HELP', 'I', 'HELP'])).toEqual(['HELP', 'I', 'NO', 'HURT', 'TOILET'])
  })
  it('stay on the everyday board when every word was cleared, in every place, even a place list without them', () => {
    const cleared = new Set(withLockedKeys([]))
    const places = [...ENVIRONMENTS.map(place => [place.id, {}]), ['clinic', { clinic: ['DOCTOR', 'MEDICINE'] }]]
    for (const [place, lists] of [['all', {}], ...places]) {
      const allowed = placeVocabulary(symbols, cleared, place, lists)
      expect([...allowed].sort()).toEqual([...LOCKED_KEYS].sort())
      const words = place === 'all' ? null : Object.hasOwn(lists, place) ? lists[place] : ENVIRONMENTS.find(e => e.id === place).keys
      expect(sectionKeys('core', symbols, words).filter(key => allowed.has(key)).sort()).toEqual([...LOCKED_KEYS].sort())
    }
  })
  it('remain reachable in every fixed section without moving that section’s original words', () => {
    const cleared = new Set(withLockedKeys([]))
    for (const section of ['all', ...CATEGORY_ORDER]) {
      for (const placeWords of [null, ['DOCTOR', 'MEDICINE']]) {
        const original = sectionKeys(section, symbols, placeWords)
        const fixed = fixedSectionKeys(section, symbols, placeWords)
        expect(fixed.slice(0, original.length)).toEqual(original)
        expect(new Set(fixed).size).toBe(fixed.length)
        expect(fixed.filter(key => cleared.has(key)).sort()).toEqual([...LOCKED_KEYS].sort())
      }
    }
  })
  it('leaves the fixed animals board usable after clear-all while preserving its learned slots', () => {
    const original = sectionKeys('animals', symbols)
    const fixed = fixedSectionKeys('animals', symbols)
    const allowed = new Set(withLockedKeys([]))
    const slots = fixed.map(key => allowed.has(key) ? key : null)
    expect(slots.slice(0, original.length)).toEqual(original.map(() => null))
    const first = gridPage(slots, [3, 3])
    const reachable = Array.from({ length: first.pages }, (_, page) => gridPage(slots, [3, 3], page).cells).flat().filter(Boolean)
    expect(reachable.sort()).toEqual([...LOCKED_KEYS].sort())
    expect(fixedSectionKeys('core', symbols)).toEqual(sectionKeys('core', symbols))
    expect(fixedSectionKeys('all', symbols)).toEqual(sectionKeys('all', symbols))
  })
})
