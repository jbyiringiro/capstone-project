import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FindGame, HINT_AFTER_MISSES } from '../../src/child/find-game.js'
import { CHILD_PRESETS, MAX_CHILD_BOARD, childGridShape } from '../../src/child/child-boards.js'
import { parseSymbols } from '../../src/symbols/catalogue.js'

const seeded = (seed = 3) => () => (seed = (seed * 48271) % 2147483647) / 2147483647

describe('picture-finding game', () => {
  it('runs the chosen number of rounds and gives one star per picture found', () => {
    const game = new FindGame(['WATER', 'EAT', 'PLAY'], { rounds: 5, random: seeded() })
    for (let i = 1; i <= 5; i++) {
      expect(game.round).toBe(i)
      expect(game.answer(game.target)).toMatchObject({ correct: true })
    }
    expect(game.finished).toBe(true)
    expect(game.stars).toBe(5)
    expect(() => game.answer('WATER')).toThrow('finished')
  })
  it('never asks for the same picture twice in a row', () => {
    const game = new FindGame(['WATER', 'EAT'], { rounds: 40, random: seeded(9) })
    let previous = null
    while (!game.finished) {
      expect(game.target).not.toBe(previous)
      previous = game.target
      game.answer(game.target)
    }
  })
  it('keeps the round open after a miss and highlights the picture after two misses', () => {
    const game = new FindGame(['WATER', 'EAT', 'PLAY'], { rounds: 1, random: seeded() })
    const wrong = ['WATER', 'EAT', 'PLAY'].find(key => key !== game.target)
    expect(game.answer(wrong)).toEqual({ correct: false, hint: false })
    expect(game.answer(wrong)).toEqual({ correct: false, hint: true })
    expect(game.answer(game.target)).toMatchObject({ correct: true, finished: true })
    expect(game.results).toEqual([{ target: expect.any(String), misses: HINT_AFTER_MISSES, hinted: true }])
    expect(game.stars).toBe(1)
  })
  it('asks more often for words the child found less easily before', () => {
    const history = { WATER: { asked: 6, firstTry: 0 }, EAT: { asked: 6, firstTry: 6 }, PLAY: { asked: 6, firstTry: 6 } }
    const counts = { WATER: 0, EAT: 0, PLAY: 0 }
    const random = seeded(11)
    for (let trial = 0; trial < 300; trial++) {
      const game = new FindGame(['WATER', 'EAT', 'PLAY'], { rounds: 1, random, history })
      counts[game.target]++
    }
    expect(counts.WATER).toBeGreaterThan(counts.EAT * 2)
    expect(counts.WATER).toBeGreaterThan(counts.PLAY * 2)
  })
  it('needs at least two different pictures', () => {
    expect(() => new FindGame(['WATER', 'WATER'])).toThrow('two different pictures')
  })
})

describe('child boards', () => {
  const symbols = new Set(parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf-8')).map(s => s.symbol_id))
  it('ready-made boards use existing words, without repeats, within the size limit', () => {
    for (const preset of CHILD_PRESETS) {
      expect(preset.keys.length).toBeLessThanOrEqual(MAX_CHILD_BOARD)
      expect(new Set(preset.keys).size).toBe(preset.keys.length)
      for (const key of preset.keys) expect(symbols.has(key)).toBe(true)
    }
  })
  it('lays out every board size so all pictures fit', () => {
    for (let count = 1; count <= MAX_CHILD_BOARD; count++) {
      for (const portrait of [true, false]) {
        const [columns, rows] = childGridShape(count, portrait)
        expect(columns * rows).toBeGreaterThanOrEqual(count)
        expect(columns * rows - count).toBeLessThan(Math.max(columns, rows))
      }
    }
    expect(childGridShape(6, true)).toEqual([2, 3])
    expect(childGridShape(6, false)).toEqual([3, 2])
  })
})
