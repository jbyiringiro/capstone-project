// Words a caregiver adds for one child's life (FR3): a picture taken on the device, a Kinyarwanda
// label and a category. They live on this device, and in the caregiver's account backup once
// they sign in (storage/backup.js), like caregiver recordings.
import { db } from './db.js'
import { localizedError } from '../shared/errors-rw.js'
import { CATEGORIES } from '../symbols/categories.js'

export const CUSTOM_PREFIX = 'CUSTOM-'
export const MAX_LABEL_LENGTH = 40

export const isCustomKey = key => typeof key === 'string' && key.startsWith(CUSTOM_PREFIX)
export const normaliseLabel = label => String(label ?? '').trim().replace(/\s+/g, ' ')
const sameLabel = (a, b) => normaliseLabel(a).toLocaleLowerCase('rw') === normaliseLabel(b).toLocaleLowerCase('rw')

export function validateCustomWord({ label, category, image }, existingLabels = []) {
  const text = normaliseLabel(label)
  if (!text) throw localizedError('Andika izina ry’ijambo mu Kinyarwanda.')
  if (text.length > MAX_LABEL_LENGTH) throw localizedError(`Izina ry’ijambo ntirigomba kurenza inyuguti ${MAX_LABEL_LENGTH}.`)
  if (!CATEGORIES[category]) throw localizedError('Hitamo icyiciro cy’iri jambo.')
  if (!(image instanceof Blob) || !image.size || !image.type.startsWith('image/')) throw localizedError('Banza ufate cyangwa uhitemo ifoto y’iri jambo.')
  if (existingLabels.some(existing => sameLabel(existing, text))) throw localizedError(`Ijambo “${text}” risanzwe ku kibaho.`)
  return { label: text, category, image }
}

export async function listCustomSymbols() {
  return db.custom_symbols.orderBy('created_at').toArray()
}

// `existingLabels` are the bundled words' labels; custom labels are checked inside the
// transaction so two quick saves cannot create the same word twice.
export async function addCustomSymbol(input, { existingLabels = [], profileId = null } = {}) {
  const word = validateCustomWord(input, existingLabels)
  return db.transaction('rw', db.custom_symbols, db.vocabulary, db.settings, async () => {
    const custom = await db.custom_symbols.toArray()
    if (custom.some(symbol => sameLabel(symbol.label_rw, word.label))) throw localizedError(`Ijambo “${word.label}” risanzwe ku kibaho.`)
    const symbol = {
      symbol_id: `${CUSTOM_PREFIX}${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      label_rw: word.label, category: word.category, image: word.image, created_at: new Date().toISOString()
    }
    await db.custom_symbols.add(symbol)
    // A profile with a hand-picked vocabulary would otherwise not show the word just made for it.
    if (profileId && (await db.settings.get(`vocabulary:${profileId}`))) {
      await db.vocabulary.put({ profile_id: profileId, key: symbol.symbol_id })
    }
    return symbol
  })
}

export async function deleteCustomSymbol(key) {
  if (!isCustomKey(key)) throw localizedError('Amagambo azanye na Vuga ntasibwa. Ushobora kuyakura ku kibaho mu gice cy’Amashusho.')
  await db.transaction('rw', db.custom_symbols, db.recordings, db.vocabulary, async () => {
    await db.custom_symbols.delete(key)
    await db.recordings.delete(key)
    await db.vocabulary.where('key').equals(key).delete()
  })
}
