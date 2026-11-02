import { GRID_SIZES } from '../storage/board-preferences.js'

// Preferred key size when the grid fits the screen ('auto'), and the grid line between keys, in CSS
// px. Rounding to the nearest count keeps every key at least three quarters of that size, above the
// 2 cm (76 px) NFR3 floor.
const TILE = { normal: 124, large: 172 }
const GAP = 1

// Columns x rows for a grid area of width x height. A fixed size (NFR3: 4 to 40 cells) is the
// caregiver's choice and keeps every picture in one place on any screen; 'auto' fits as many keys
// as the area holds, up to 12 across and 7 down, so phones get fewer, larger keys.
export function gridShape(gridSize, width, height, large = false) {
  if (GRID_SIZES[gridSize]) return GRID_SIZES[gridSize]
  const tile = large ? TILE.large : TILE.normal
  const fit = (length, min, max) => Math.min(max, Math.max(min, Math.round((length + GAP) / (tile + GAP))))
  return [fit(width, 2, 12), fit(height, 2, 7)]
}

// One page of a board view. A slot is a symbol, or null for a word hidden on this board: hidden
// words leave their place empty, so the pictures around them never move when a caregiver hides or
// adds words. Pages with nothing to show are skipped, and a short last page is padded with empty
// slots so tiles keep one size and position.
export function gridPage(slots, [columns, rows], page = 0) {
  const size = columns * rows
  const pages = []
  for (let start = 0; start < slots.length; start += size) {
    const cells = slots.slice(start, start + size)
    if (cells.some(Boolean)) pages.push(cells)
  }
  const current = Math.min(Math.max(page, 0), Math.max(pages.length - 1, 0))
  const cells = pages[current] ?? []
  return { cells, empty: size - cells.length, page: current, pages: Math.max(pages.length, 1), columns, rows }
}
