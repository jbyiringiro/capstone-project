import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseSymbols } from '../../src/symbols/catalogue.js'

const catalogue = parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf8'))
const assetRoot = new URL('../../public/', import.meta.url)
const attribution = readFileSync(new URL('symbols/ATTRIBUTION.txt', assetRoot), 'utf8')

it('ships every catalogue-declared fallback pictogram with its PNG data and ARASAAC attribution', () => {
  const pictograms = catalogue.filter(symbol => symbol.image_path)
  expect(pictograms.length).toBeGreaterThan(0)
  for (const symbol of pictograms) {
    expect(symbol.image_path).toBe(`/symbols/${symbol.symbol_id}.png`)
    // Missing files must fail in an isolated checkout, even when photos normally hide
    // the missing fallback during a successful online board demonstration.
    const bytes = readFileSync(new URL(symbol.image_path.slice(1), assetRoot))
    expect(bytes.subarray(0, 8), symbol.symbol_id).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(bytes.toString('ascii', 12, 16), symbol.symbol_id).toBe('IHDR')
    expect(bytes.readUInt32BE(16), symbol.symbol_id).toBeGreaterThan(0)
    expect(bytes.readUInt32BE(20), symbol.symbol_id).toBeGreaterThan(0)
    expect(attribution, symbol.symbol_id).toMatch(new RegExp(`^${symbol.symbol_id} ${symbol.arasaac_id}$`, 'm'))
  }
})
