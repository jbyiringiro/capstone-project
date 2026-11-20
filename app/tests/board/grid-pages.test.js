import { describe, expect, it } from 'vitest'
import { gridPage, gridShape } from '../../src/board/grid-pages.js'

const word = key => ({ symbol_id: key })
const keys = cells => cells.map(cell => cell?.symbol_id ?? null)

describe('grid shape', () => {
  it('keeps a caregiver’s fixed size on every screen', () => {
    expect(gridShape(9, 390, 600)).toEqual([3, 3])
    expect(gridShape(40, 1280, 700)).toEqual([8, 5])
    expect(gridShape(40, 390, 600)).toEqual([8, 5])
  })
  it('fits a dense grid on a tablet and fewer, larger keys on a phone, never below 2 cm', () => {
    const phone = gridShape('auto', 370, 560), tablet = gridShape('auto', 1248, 700), sideways = gridShape('auto', 820, 250)
    expect(phone).toEqual([3, 4])
    expect(tablet).toEqual([10, 6])
    expect(sideways).toEqual([7, 2])
    for (const [[columns, rows], width, height] of [[phone, 370, 560], [tablet, 1248, 700], [sideways, 820, 250]]) {
      expect((width - (columns - 1)) / columns).toBeGreaterThanOrEqual(76)
      expect((height - (rows - 1)) / rows).toBeGreaterThanOrEqual(76)
    }
  })
  it('uses fewer columns and rows for large keys, within 2 to 12 across and 2 to 7 down', () => {
    expect(gridShape('auto', 1248, 700, true)).toEqual([7, 4])
    expect(gridShape('auto', 120, 120)).toEqual([2, 2])
    expect(gridShape('auto', 4000, 3000)).toEqual([12, 7])
  })
})

// The board's own step (Board.jsx): words hidden for the child are left out, in order, before paging.
const shown = (all, hidden) => all.split('').filter(key => !hidden.includes(key)).map(word)

describe('grid pages', () => {
  it('pads only the end of a short last page, so tiles keep one size', () => {
    const symbols = 'ABCDEFGHIJ'.split('').map(word)
    expect(gridPage(symbols, [2, 2], 2)).toMatchObject({ page: 2, pages: 3, empty: 2 })
    expect(keys(gridPage(symbols, [2, 2], 2).cells)).toEqual(['I', 'J'])
  })
  it('closes up behind a hidden picture, keeping the others in order with no gap', () => {
    expect(keys(gridPage(shown('ABCDE', 'B'), [2, 2]).cells)).toEqual(['A', 'C', 'D', 'E'])
    // Several hidden across pages: the next page's pictures move up, and a page goes away.
    const several = shown('ABCDEFGHIJ', 'BDEG')
    expect(keys(several)).toEqual(['A', 'C', 'F', 'H', 'I', 'J'])
    expect(gridPage(several, [2, 2])).toMatchObject({ pages: 2, empty: 0 })
    expect(keys(gridPage(several, [2, 2], 1).cells)).toEqual(['I', 'J'])
    // Shown again, a picture takes its own place back.
    expect(keys(gridPage(shown('ABCDE', ''), [2, 2]).cells)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('has no empty page and no gap on any page but the end of the last', () => {
    const symbols = shown('ABCDEFGHIJKLMNOPQRSTU', 'CFGHIJKLQ')
    const { pages } = gridPage(symbols, [3, 2])
    const all = Array.from({ length: pages }, (_, page) => gridPage(symbols, [3, 2], page))
    expect(all.map(page => page.cells.length)).toEqual([6, 6])
    expect(all.flatMap(page => keys(page.cells))).toEqual(keys(symbols))
  })
  it('keeps a page within the pages there are, as when hiding words removes the open page', () => {
    const symbols = shown('ABCDEFGHIJ', 'EFGHIJ')
    expect(gridPage(symbols, [2, 2], 2)).toMatchObject({ page: 0, pages: 1 })
    expect(gridPage(symbols, [2, 2], -3).page).toBe(0)
    expect(gridPage(symbols, [2, 2], Number.NaN).page).toBe(0)
  })
  it('shows an empty view, one page, when every picture is hidden', () => {
    expect(gridPage(shown('ABCD', 'ABCD'), [2, 2])).toMatchObject({ cells: [], pages: 1, page: 0, empty: 4 })
  })
})
