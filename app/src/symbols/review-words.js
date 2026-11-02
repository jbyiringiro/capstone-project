import reviewCsv from '../../../vocab/review_words.csv?raw'
import { CATEGORIES, CATEGORY_ORDER } from './categories.js'

// The words adults review in the vocabulary interview, in the order of the paper review sheet.
// vocab/review_words.csv is the one list: the analysis script (analyse_vocabulary_review.py) reads it too.
export function parseReviewWords(text) {
  const [header = '', ...rows] = text.trim().split(/\r?\n/)
  if (header.trim() !== 'symbol_id') throw new Error('review_words.csv must start with a symbol_id header')
  return rows.map(row => row.trim()).filter(Boolean)
}

export const REVIEW_WORDS = parseReviewWords(reviewCsv)

// The lists a researcher can step through: the review sheet, every bundled word by category, then
// one category at a time. Custom words belong to one family, so they are never part of the review.
export function reviewSets(symbols, reviewWords = REVIEW_WORDS) {
  const bundled = symbols.filter(symbol => !symbol.custom)
  const known = new Set(bundled.map(symbol => symbol.symbol_id))
  const inCategory = category => bundled.filter(symbol => symbol.category === category).map(symbol => symbol.symbol_id)
  const ordered = [...CATEGORY_ORDER, ...new Set(bundled.map(symbol => symbol.category).filter(category => !CATEGORY_ORDER.includes(category)))]
  const sets = [
    { id: 'review', rw: 'Amagambo yo gusuzuma', keys: reviewWords.filter(key => known.has(key)) },
    { id: 'all', rw: 'Amashusho yose', keys: ordered.flatMap(inCategory) },
    ...CATEGORY_ORDER.map(category => ({ id: category, rw: CATEGORIES[category].rw, keys: inCategory(category) }))
  ]
  return sets.filter(set => set.keys.length)
}
