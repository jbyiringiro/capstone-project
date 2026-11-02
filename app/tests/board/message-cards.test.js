import { describe, expect, it } from 'vitest'
import { CARD_GAP, cardLayout } from '../../src/board/message-cards.js'

// A layout fits when its columns fit across and its rows of cards (25% taller than wide) fit down.
const fits = ({ columns, size }, count, width, height) => {
  const rows = Math.ceil(count / columns)
  return columns * size + (columns - 1) * CARD_GAP <= width && rows * size * 1.25 + (rows - 1) * CARD_GAP <= height
}

describe('Erekana cards', () => {
  it('gives one picture most of a tablet or phone screen', () => {
    const tablet = cardLayout(1, 1148, 520), phone = cardLayout(1, 326, 560)
    expect(tablet).toEqual({ columns: 1, size: 416 })
    expect(phone).toEqual({ columns: 1, size: 326 })
  })
  it('lays a sentence out in the columns that keep its pictures largest', () => {
    expect(cardLayout(3, 1148, 520)).toEqual({ columns: 3, size: 373 })
    expect(cardLayout(3, 326, 560)).toEqual({ columns: 2, size: 156 })
    expect(cardLayout(8, 1148, 520).columns).toBe(4)
    for (const [count, width, height] of [[2, 1148, 520], [5, 1148, 520], [8, 1148, 520], [12, 326, 560], [6, 800, 250]]) {
      const layout = cardLayout(count, width, height)
      expect(fits(layout, count, width, height)).toBe(true)
      expect(layout.size).toBeGreaterThanOrEqual(96)
    }
  })
  it('keeps a long message at about 2.5 cm a card and lets it scroll, never wider than the screen', () => {
    const layout = cardLayout(30, 326, 560)
    expect(layout.size).toBe(96)
    expect(layout.columns * layout.size + (layout.columns - 1) * CARD_GAP).toBeLessThanOrEqual(326)
  })
  it('stops one picture growing past a sensible size on a large screen', () => {
    expect(cardLayout(1, 1900, 1000).size).toBe(560)
  })
})
