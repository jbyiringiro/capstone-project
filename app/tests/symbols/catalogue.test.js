import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SymbolCatalogue, customBoardSymbol, parseCsv, parseSymbols } from '../../src/symbols/catalogue.js'
import { centreSquare, checkPictureFile } from '../../src/symbols/picture.js'

describe('symbol catalogue', () => {
  it('parses quoted CSV fields with commas, quotes and CRLF line endings', () => {
    expect(parseCsv('a,b\r\n"yego, ndabishaka","say ""hi"""\r\n\r\n')).toEqual([['a', 'b'], ['yego, ndabishaka', 'say "hi"']])
    expect(parseSymbols('symbol_id,label_rw\nYES,yego\n')).toEqual([{ symbol_id: 'YES', label_rw: 'yego' }])
  })
  it('reads all 188 bundled words with every column', () => {
    const symbols = parseSymbols(readFileSync(new URL('../../../vocab/symbols.csv', import.meta.url), 'utf-8'))
    expect(symbols).toHaveLength(188)
    expect(new Set(symbols.map(s => s.symbol_id)).size).toBe(188)
    for (const s of symbols) expect(s.symbol_id && s.label_rw && s.category).toBeTruthy()
  })
  it('merges custom words after the bundled ones and looks both up by key', () => {
    const bundled = [{ symbol_id: 'WATER', label_rw: 'amazi', category: 'food_drink' }]
    const custom = customBoardSymbol({ symbol_id: 'CUSTOM-1A2B3C4D', label_rw: 'nyogokuru', category: 'people' }, 'blob:x')
    const catalogue = new SymbolCatalogue(bundled, [custom])
    expect(catalogue.keys).toEqual(['WATER', 'CUSTOM-1A2B3C4D'])
    expect(catalogue.get('CUSTOM-1A2B3C4D')).toMatchObject({ custom: true, image_url: 'blob:x' })
    expect(catalogue.has('TOILET')).toBe(false)
    expect(catalogue.custom).toHaveLength(1)
    expect(catalogue.bundledLabels).toEqual(['amazi'])
  })
})

describe('custom word pictures', () => {
  it('crops the largest centred square of landscape, portrait and square photos', () => {
    expect(centreSquare(4000, 3000)).toEqual({ x: 500, y: 0, side: 3000 })
    expect(centreSquare(1080, 1920)).toEqual({ x: 0, y: 420, side: 1080 })
    expect(centreSquare(512, 512)).toEqual({ x: 0, y: 0, side: 512 })
  })
  it('accepts only non-empty image files under 10 MB', () => {
    expect(() => checkPictureFile(new Blob(['x'], { type: 'application/pdf' }))).toThrow('JPG, PNG')
    expect(() => checkPictureFile(new Blob([], { type: 'image/jpeg' }))).toThrow('nta foto')
    expect(() => checkPictureFile(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/jpeg' }))).toThrow('MB 10')
    expect(() => checkPictureFile(new Blob(['jpeg'], { type: 'image/jpeg' }))).not.toThrow()
  })
})
