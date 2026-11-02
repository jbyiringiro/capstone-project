import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSymbols } from '../../src/symbols/catalogue.js'
import { HOME_KEYS } from '../../src/symbols/categories.js'
import { environmentById } from '../../src/symbols/environments.js'
import { sectionKeys, sectionName } from '../../src/board/sections.js'

const symbols = parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf-8'))

describe('board sections', () => {
  it('starts the everyday section with the home keys in their learned places', () => {
    const keys = sectionKeys('core', symbols)
    expect(keys.slice(0, HOME_KEYS.length)).toEqual(HOME_KEYS)
    expect(keys).toContain('HE_SHE')
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('shows one category in file order', () => {
    expect(sectionKeys('things', symbols)).toEqual(symbols.filter(s => s.category === 'things').map(s => s.symbol_id))
  })
  it('puts every picture once in "all", everyday words first', () => {
    const keys = sectionKeys('all', symbols)
    expect(keys.slice(0, HOME_KEYS.length)).toEqual(HOME_KEYS)
    expect(new Set(keys).size).toBe(symbols.length)
    expect(keys).toHaveLength(symbols.length)
  })
  it('puts the chosen place’s words first and leaves other places’ naming words out', () => {
    const meal = environmentById('meal').keys
    const keys = sectionKeys('all', symbols, meal)
    expect(keys.slice(0, meal.length)).toEqual(meal)
    expect(keys.slice(meal.length, meal.length + 3)).toEqual(['I', 'WANT', 'HELP'])
    expect(keys).toContain('HURT')
    expect(keys).not.toContain('PEN')
    expect(new Set(keys).size).toBe(keys.length)
    expect(sectionKeys('core', symbols, meal).slice(0, meal.length + 1)).toEqual([...meal, 'I'])
    expect(sectionKeys('food_drink', symbols, meal)).toEqual(meal.filter(key => symbols.find(s => s.symbol_id === key).category === 'food_drink'))
    expect(sectionKeys('actions', symbols, meal)).toEqual(sectionKeys('actions', symbols))
  })
  it('names sections in Kinyarwanda', () => {
    expect(sectionName('all')).toBe('Amashusho yose')
    expect(sectionName('food_drink')).toBe('Ibiryo')
    expect(sectionName('core')).toBe('Ingenzi')
  })
})
