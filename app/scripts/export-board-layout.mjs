// The child's board as the app builds it, for the keystroke simulator in ml/vuga_ml/metrics.py
// (BoardLayout.from_json): the section tabs in their order, each with its pictures in board order,
// every bundled word enabled, no place chosen. The simulator cuts the pages by grid size, as the
// board does (board/grid-pages.js).
//
//   node scripts/export-board-layout.mjs [--out ../ml/data/processed/board_layout.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionKeys } from '../src/board/sections.js'
import { CATEGORY_ORDER } from '../src/symbols/categories.js'
import { parseSymbols } from '../src/symbols/catalogue.js'

const symbols = parseSymbols(readFileSync(new URL('../../vocab/symbols.csv', import.meta.url), 'utf-8'))
const known = new Set(symbols.map(symbol => symbol.symbol_id))
// As on the board: Ingenzi always, other sections only when they have pictures.
const sections = Object.fromEntries(CATEGORY_ORDER
  .map(section => [section, sectionKeys(section, symbols).filter(key => known.has(key))])
  .filter(([section, keys]) => section === 'core' || keys.length))
const layout = { source: 'app/src/board/sections.js and vocab/symbols.csv', words: known.size, sections }

const outIndex = process.argv.indexOf('--out')
const out = outIndex > 0 ? resolve(process.argv[outIndex + 1]) : fileURLToPath(new URL('../../ml/data/processed/board_layout.json', import.meta.url))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(layout, null, 2) + '\n')
console.log(`${Object.keys(sections).length} sections, ${known.size} words -> ${out}`)
