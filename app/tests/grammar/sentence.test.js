import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import grammar from '../../src/grammar/grammar_rw.json'
import { SentenceBuilder, clipName, sentenceBuilder, wordByWord } from '../../src/grammar/sentence.js'
import { customBoardSymbol, parseSymbols } from '../../src/symbols/catalogue.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf-8')
const byKey = Object.fromEntries(parseSymbols(read('../../../vocab/symbols.csv')).map(s => [s.symbol_id, s]))
const study = JSON.parse(read('../../../docs/study/message_sets.json'))
const say = (...keys) => sentenceBuilder.build(keys, byKey).text

describe('Kinyarwanda sentences from pictures', () => {
  it('says every study message as the sentence printed on its card', () => {
    const rows = [...study.practice.rows, ...study.A.rows, ...study.B.rows]
    expect(rows).toHaveLength(23)
    for (const row of rows) expect(say(...row.keys), row.keys.join(' ')).toBe(row.sentence_rw)
  })
  it('joins subject and verb into one word and keeps the verb after "want" an infinitive', () => {
    const { parts } = sentenceBuilder.build(['I', 'WANT', 'EAT', 'BREAD'], byKey)
    expect(parts).toEqual([
      { text: 'ndashaka', keys: ['I', 'WANT'], clip: 'ndashaka' },
      { text: 'kurya', keys: ['EAT'] },
      { text: 'umugati', keys: ['BREAD'] }
    ])
  })
  it('uses the end-of-sentence form when nothing follows, and the corpus form before an object', () => {
    expect(say('I', 'LIKE')).toBe('Ndakunda.')
    expect(say('I', 'LIKE', 'DOG')).toBe('Nkunda imbwa.')
    expect(say('WE', 'WANT', 'WATER')).toBe('Turashaka amazi.')
    expect(say('I', 'NEED', 'WATER')).toBe('Nkeneye amazi.')
  })
  it('keeps every picture’s own word when alone, adds no "I" the message does not name, and carries a named subject on', () => {
    for (const key of Object.keys(byKey)) expect(sentenceBuilder.build([key], byKey).parts, key).toEqual([{ text: byKey[key].label_rw, keys: [key] }])
    expect(say('WANT', 'WATER')).toBe('Gushaka amazi.')
    expect(say('NOT', 'WANT', 'RICE')).toBe('Ntabwo gushaka umuceri.')
    expect(say('I', 'NOT', 'WANT', 'RICE')).toBe('Sinshaka umuceri.')
    expect(say('YOU', 'HUNGRY', 'WANT', 'EAT')).toBe('Urashonje, urashaka kurya.')
    expect(say('I', 'TIRED', 'NOT', 'WANT', 'PLAY')).toBe('Ndananiwe, sinshaka gukina.')
  })
  it('makes requests after a name or "you", including "me" forms', () => {
    expect(say('HELP', 'I')).toBe('Mfasha.')
    expect(say('YOU', 'GIVE', 'I', 'WATER')).toBe('Mpa amazi.')
    expect(say('FRIEND', 'COME')).toBe('Nshuti, ngwino.')
    expect(say('YOU', 'WAIT')).toBe('Tegereza.')
  })
  it('agrees with a person subject and asks "where" with the noun class', () => {
    expect(say('MUM', 'SICK')).toBe('Mama ararwaye.')
    expect(say('SCHOOL', 'WHERE')).toBe('Ishuri riri he?')
    expect(say('WHERE', 'WATER')).toBe('Amazi ari he?')
    expect(say('I', 'GO', 'SCHOOL')).toBe('Ngiye ku ishuri.')
    expect(say('I', 'WANT', 'GO', 'PLAY')).toBe('Ndashaka kujya gukina.')
  })
  it('falls back to the pictures’ own words for anything the rules do not cover, custom words included', () => {
    const custom = customBoardSymbol({ symbol_id: 'CUSTOM-1A2B3C4D', label_rw: 'nyogokuru', category: 'people' }, 'blob:x')
    const keys = { ...byKey, [custom.symbol_id]: custom }
    expect(sentenceBuilder.build(['I', 'WANT', custom.symbol_id], keys).text).toBe('Ndashaka nyogokuru.')
    expect(say('BIG', 'DOG')).toBe('Kinini imbwa.')
    expect(say('WHAT')).toBe('N\'iki?')
    const thin = new SentenceBuilder({ ...grammar, verbs: { ...grammar.verbs, WANT: { ...grammar.verbs.WANT, final: {}, before: {} } } })
    expect(thin.build(['I', 'WANT'], byKey).parts).toEqual([{ text: 'njye', keys: ['I'] }, { text: 'gushaka', keys: ['WANT'] }])
  })
  it('only ever asks for clips the audio generator makes', () => {
    const clips = new Set(grammar.clips.map(clipName))
    const keys = Object.keys(byKey)
    const sample = [...study.A.rows, ...study.B.rows].map(row => row.keys)
    for (const a of ['I', 'YOU', 'HE_SHE', 'WE', 'THEY']) for (const v of Object.keys(grammar.verbs)) sample.push([a, v], [a, v, 'WATER'], [a, 'NOT', v])
    for (const n of Object.keys(grammar.nouns)) sample.push(['WHERE', n], ['HELLO', n], [n, 'COME'], ['GO', n])
    for (const message of sample) {
      for (const part of sentenceBuilder.build(message, byKey).parts) {
        if (part.clip) expect(clips.has(part.clip), `${message.join(' ')} -> ${part.text}`).toBe(true)
        for (const key of part.keys) expect(keys).toContain(key)
      }
    }
  })
  it('keeps the old word-by-word speech available', () => {
    expect(wordByWord(['I', 'WANT', 'WATER'], byKey)).toEqual({ text: 'njye gushaka amazi', parts: [{ text: 'njye', keys: ['I'] }, { text: 'gushaka', keys: ['WANT'] }, { text: 'amazi', keys: ['WATER'] }] })
    expect(sentenceBuilder.build([], byKey)).toEqual({ text: '', parts: [] })
  })
})
