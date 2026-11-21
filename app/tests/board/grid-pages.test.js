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

// The board's own step (Board.jsx): every word keeps its slot, and a word hidden for the child is null.
const slots = (all, hidden) => all.split('').map(key => (hidden.includes(key) ? null : word(key)))
const pagesOf = (board, shape) => Array.from({ length: gridPage(board, shape).pages }, (_, page) => keys(gridPage(board, shape, page).cells))

describe('grid pages', () => {
  it('pads only the end of a short last page, so tiles keep one size', () => {
    const symbols = 'ABCDEFGHIJ'.split('').map(word)
    expect(gridPage(symbols, [2, 2], 2)).toMatchObject({ page: 2, pages: 3, empty: 2 })
    expect(keys(gridPage(symbols, [2, 2], 2).cells)).toEqual(['I', 'J'])
  })
  it('leaves a hidden picture’s key empty, so the pictures after it do not move', () => {
    expect(keys(gridPage(slots('ABCDE', 'B'), [2, 2]).cells)).toEqual(['A', null, 'C', 'D'])
    expect(gridPage(slots('ABCDE', 'B'), [2, 2], 1)).toMatchObject({ empty: 3 })
    expect(keys(gridPage(slots('ABCDE', 'B'), [2, 2], 1).cells)).toEqual(['E'])
    // Several hidden across pages: each page keeps its pictures where they were.
    expect(pagesOf(slots('ABCDEFGHIJ', 'BDEG'), [2, 2])).toEqual([['A', null, 'C', null], [null, 'F', null, 'H'], ['I', 'J']])
    // Shown again, a picture is back in its own place and nothing else has moved.
    expect(keys(gridPage(slots('ABCDE', ''), [2, 2]).cells)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('keeps every shown picture on the same key of its page, whatever is hidden, and skips a page with nothing to show', () => {
    const all = 'ABCDEFGHIJKLMNOPQRSTU'
    const pages = pagesOf(slots(all, 'CFGHIJKLQ'), [3, 2])
    // G to L were all hidden, so their page is skipped; the pages around it are unchanged.
    expect(pages).toEqual([['A', 'B', null, 'D', 'E', null], ['M', 'N', 'O', 'P', null, 'R'], ['S', 'T', 'U']])
    for (const cells of pages) cells.forEach((key, index) => { if (key) expect(all.indexOf(key) % 6).toBe(index) })
  })
  it('keeps a page within the pages there are, as when hiding words empties the open page', () => {
    const symbols = slots('ABCDEFGHIJ', 'EFGHIJ')
    expect(gridPage(symbols, [2, 2], 2)).toMatchObject({ page: 0, pages: 1 })
    expect(gridPage(symbols, [2, 2], -3).page).toBe(0)
    expect(gridPage(symbols, [2, 2], Number.NaN).page).toBe(0)
  })
  it('shows an empty view, one page, when every picture is hidden', () => {
    expect(gridPage(slots('ABCD', 'ABCD'), [2, 2])).toMatchObject({ cells: [], pages: 1, page: 0, empty: 4 })
  })
})
