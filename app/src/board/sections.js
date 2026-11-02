import { CATEGORIES, CATEGORY_ORDER, HOME_KEYS } from '../symbols/categories.js'
import { isCoreWord } from '../symbols/environments.js'

// The pictures of one board section, in their fixed order. The everyday section starts with the
// home keys in the places the child has learned; 'all' is every section in turn, each picture once.
// With a place chosen, its naming words come first, in the caregiver's order: all of them on the
// everyday and 'all' boards, a naming section's own ones on that section. Naming words for other
// places leave the board, and the core words follow in their usual order.
export function sectionKeys(section, symbols, placeWords = null) {
  const keys = viewKeys(section, symbols)
  if (!placeWords) return keys
  const byKey = new Map(symbols.map(s => [s.symbol_id, s]))
  const inView = new Set(keys)
  const front = placeWords.filter(key => (section === 'all' || section === 'core' ? byKey.has(key) : inView.has(key)))
  const placed = new Set(front)
  return [...front, ...keys.filter(key => !placed.has(key) && isCoreWord(byKey.get(key)))]
}

function viewKeys(section, symbols) {
  const inCategory = category => symbols.filter(s => s.category === category).map(s => s.symbol_id)
  const home = [...HOME_KEYS, ...inCategory('core').filter(key => !HOME_KEYS.includes(key))]
  if (section === 'core') return home
  if (section !== 'all') return inCategory(section)
  const seen = new Set(home)
  return [...home, ...CATEGORY_ORDER.filter(category => category !== 'core').flatMap(inCategory).filter(key => !seen.has(key))]
}

export const sectionName = section => (section === 'all' ? 'Amashusho yose' : (CATEGORIES[section] ?? CATEGORIES.core).rw)
