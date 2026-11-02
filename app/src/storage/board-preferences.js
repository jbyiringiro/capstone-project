// How one child's board looks and behaves, chosen by a caregiver per profile. Stored under the
// original `appearance:` key so devices set up before the grid and personal options keep theirs.
import { db } from './db.js'
import { CHILD_PRESETS, MAX_CHILD_BOARD } from '../child/child-boards.js'
import { CATEGORY_ORDER } from '../symbols/categories.js'
import { ENVIRONMENTS, MAX_ENVIRONMENT_WORDS } from '../symbols/environments.js'
import { MAX_RELATED } from '../symbols/related-words.js'

// Fixed pages of columns x rows (NFR3: 4 to 40 cells); 'auto' fits as many large tiles as the
// screen holds, so a phone shows fewer, bigger pictures than a tablet.
export const GRID_SIZES = Object.freeze({ 4: [2, 2], 6: [3, 2], 9: [3, 3], 12: [4, 3], 20: [5, 4], 24: [6, 4], 40: [8, 5] })
export const GRID_OPTIONS = Object.freeze(['auto', ...Object.keys(GRID_SIZES).map(Number)])

// Child mode shows only the caregiver's chosen pictures (up to 12); each tap speaks at once.
// sentenceSpeech says a message as a Kinyarwanda sentence (Ndashaka amazi) instead of word by word.
// relatedWords opens the next-words page after a picture such as "kunywa"; speakOnTap says each
// picture as soon as it is tapped; environment narrows the naming words to where the child is.
// relatedLists and environmentLists hold the caregiver's own lists for this child. The child's
// board shows every picture in pages, or one section the caregiver chooses; sectionTabs puts the
// section tabs back.
// showLabels writes each picture's word on its key; off, the child sees larger pictures only.
// swipePages lets a sideways swipe across the pictures turn the page as the page buttons do.
export const DEFAULT_PREFERENCES = Object.freeze({
  motion: true, largeTiles: false, realisticImages: true, gridSize: 'auto', personalSuggestions: false, sentenceSpeech: true,
  childMode: false, childPreset: 'essentials', childBoard: CHILD_PRESETS[0].keys,
  relatedWords: false, relatedLists: Object.freeze({}), speakOnTap: true, environment: 'all', environmentLists: Object.freeze({}),
  section: 'all', sectionTabs: false, showLabels: true, swipePages: true
})

const validKeys = (value, max) => Array.isArray(value) && value.length <= max
  && value.every(key => typeof key === 'string' && key) && new Set(value).size === value.length
const validBoard = value => validKeys(value, MAX_CHILD_BOARD) && value.length > 0
const validLists = (value, max, validName) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).every(([name, keys]) => validName(name) && validKeys(keys, max))
const isEnvironment = id => ENVIRONMENTS.some(environment => environment.id === id)

const VALID = {
  motion: value => typeof value === 'boolean',
  largeTiles: value => typeof value === 'boolean',
  // The earlier illustratedSymbols setting controlled decorative icons, not photos, so it is not
  // migrated: existing profiles get the photo set with their other choices kept.
  realisticImages: value => typeof value === 'boolean',
  gridSize: value => GRID_OPTIONS.includes(value),
  personalSuggestions: value => typeof value === 'boolean',
  sentenceSpeech: value => typeof value === 'boolean',
  childMode: value => typeof value === 'boolean',
  childPreset: value => value === 'custom' || CHILD_PRESETS.some(preset => preset.id === value),
  childBoard: validBoard,
  relatedWords: value => typeof value === 'boolean',
  relatedLists: value => validLists(value, MAX_RELATED, name => !!name),
  speakOnTap: value => typeof value === 'boolean',
  environment: value => value === 'all' || isEnvironment(value),
  environmentLists: value => validLists(value, MAX_ENVIRONMENT_WORDS, isEnvironment),
  section: value => value === 'all' || CATEGORY_ORDER.includes(value),
  sectionTabs: value => typeof value === 'boolean',
  showLabels: value => typeof value === 'boolean',
  swipePages: value => typeof value === 'boolean'
}

export function normalisePreferences(value) {
  return Object.fromEntries(Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) =>
    [key, VALID[key](value?.[key]) ? value[key] : fallback]))
}

const settingKey = profileId => `appearance:${profileId ?? 'demo'}`

export async function getBoardPreferences(profileId) {
  return normalisePreferences((await db.settings.get(settingKey(profileId)))?.value)
}

export async function saveBoardPreferences(profileId, value) {
  const preferences = normalisePreferences(value)
  await db.settings.put({ key: settingKey(profileId), value: preferences })
  return preferences
}
