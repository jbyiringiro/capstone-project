// The words a board can show: the bundled vocabulary from vocab/symbols.csv plus any words a
// caregiver added on this device. Components look symbols up here instead of in the CSV.
import { isCustomKey } from '../storage/custom-symbols.js'

// RFC 4180 fields: quoted values may contain commas, line breaks and doubled quotes, so a future
// label such as "yego, ndabishaka" cannot shift the columns of its row.
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const endField = () => { row.push(field); field = '' }
  const endRow = () => { endField(); rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') endField()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else field += c
  }
  if (field || row.length) endRow()
  return rows.filter(cells => cells.some(cell => cell !== ''))
}

export function parseSymbols(csv) {
  const [head, ...rows] = parseCsv(csv)
  return rows.map(cells => Object.fromEntries(head.map((column, i) => [column, cells[i] ?? ''])))
}

// Shape a stored custom word like a bundled symbol; its picture is an object URL for the blob.
export function customBoardSymbol(record, imageUrl) {
  return {
    symbol_id: record.symbol_id, label_rw: record.label_rw, label_en: '', category: record.category,
    arasaac_id: '', image_path: '', image_url: imageUrl, custom: true
  }
}

export class SymbolCatalogue {
  constructor(bundled, custom = []) {
    this.bundled = bundled
    this.symbols = [...bundled, ...custom]
    this.byKey = Object.fromEntries(this.symbols.map(symbol => [symbol.symbol_id, symbol]))
  }
  get(key) { return this.byKey[key] ?? null }
  has(key) { return key in this.byKey }
  get custom() { return this.symbols.filter(symbol => isCustomKey(symbol.symbol_id)) }
  get keys() { return this.symbols.map(symbol => symbol.symbol_id) }
  get bundledLabels() { return this.bundled.map(symbol => symbol.label_rw) }
}
