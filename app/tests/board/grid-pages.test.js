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

describe('grid pages', () => {
  it('pads a short last page so tiles keep one size and place', () => {
    const slots = 'ABCDEFGHIJ'.split('').map(word)
    expect(gridPage(slots, [2, 2], 2)).toMatchObject({ page: 2, pages: 3, empty: 2 })
    expect(keys(gridPage(slots, [2, 2], 2).cells)).toEqual(['I', 'J'])
    expect(gridPage(slots, [2, 2], 9).page).toBe(2)
  })
  it('leaves a hidden word’s slot empty, so the pictures around it do not move', () => {
    const slots = [word('A'), null, word('C'), word('D')]
    expect(keys(gridPage(slots, [2, 2]).cells)).toEqual(['A', null, 'C', 'D'])
  })
  it('skips pages with nothing to show and reports an empty view', () => {
    const slots = [null, null, null, null, word('E'), null]
    expect(gridPage(slots, [2, 2])).toMatchObject({ pages: 1, page: 0, empty: 2 })
    expect(keys(gridPage(slots, [2, 2]).cells)).toEqual(['E', null])
    expect(gridPage([null, null], [2, 2])).toMatchObject({ cells: [], pages: 1, empty: 4 })
  })
})
