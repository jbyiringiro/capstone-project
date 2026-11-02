import { HOME_KEYS } from './categories.js'

// Where the child is decides which naming words (people, food, things, places, clothes, animals)
// the board shows. Core words never change: pronouns, verbs, describing, feelings, the body,
// time, questions, social words and the everyday page stay in every place, so a child can always
// say "I want", "it hurts" or "no". The place's words lead the board (sectionKeys), and naming
// words for other places leave it, so the child finds what they need here on the first page.
export const FRINGE_CATEGORIES = Object.freeze(['people', 'food_drink', 'things', 'places', 'clothes', 'animals'])
export const MAX_ENVIRONMENT_WORDS = 80

export const ENVIRONMENTS = Object.freeze([
  { id: 'home', rw: 'Mu rugo', symbol: 'HOME', keys: ['MUM', 'DAD', 'CHILD', 'BOY', 'GIRL', 'PERSON', 'FRIEND', 'HOME', 'HOUSE', 'TOILET', 'BED', 'CHAIR', 'TABLE', 'TV', 'PHONE', 'BOOK', 'BALL', 'MUSIC', 'SONG', 'THING', 'CUP', 'PLATE', 'SPOON', 'SOAP', 'MEDICINE', 'CLOTHES', 'SHIRT', 'TROUSERS', 'SHOES', 'FOOD', 'WATER', 'MILK', 'TEA', 'JUICE', 'PORRIDGE', 'BREAD', 'RICE', 'BEANS', 'POTATOES', 'BANANA', 'MEAT', 'FRUIT', 'SUGAR', 'CAT', 'DOG', 'CHICKEN', 'COW'] },
  { id: 'school', rw: 'Ku ishuri', symbol: 'SCHOOL', keys: ['TEACHER', 'FRIEND', 'CHILD', 'BOY', 'GIRL', 'PERSON', 'MUM', 'DAD', 'SCHOOL', 'PLAYGROUND', 'TOILET', 'HOME', 'BOOK', 'PEN', 'CHAIR', 'TABLE', 'BALL', 'MUSIC', 'SONG', 'THING', 'WATER', 'FOOD', 'BREAD', 'FRUIT', 'BANANA', 'PORRIDGE', 'CUP', 'SOAP', 'CLOTHES', 'SHOES'] },
  { id: 'meal', rw: 'Igihe cyo kurya', symbol: 'FOOD', keys: ['MUM', 'DAD', 'FOOD', 'WATER', 'MILK', 'TEA', 'JUICE', 'PORRIDGE', 'BREAD', 'RICE', 'BEANS', 'POTATOES', 'BANANA', 'MEAT', 'FRUIT', 'SUGAR', 'CUP', 'PLATE', 'SPOON', 'TABLE', 'CHAIR', 'SOAP', 'TOILET'] },
  { id: 'play', rw: 'Igihe cyo gukina', symbol: 'PLAYGROUND', keys: ['FRIEND', 'CHILD', 'BOY', 'GIRL', 'MUM', 'DAD', 'TEACHER', 'BALL', 'BICYCLE', 'MUSIC', 'SONG', 'PHONE', 'TV', 'BOOK', 'PEN', 'PLAYGROUND', 'HOME', 'TOILET', 'WATER', 'DOG', 'CAT', 'BIRD', 'COW', 'CHICKEN'] },
  { id: 'clinic', rw: 'Kwa muganga', symbol: 'DOCTOR', keys: ['DOCTOR', 'MUM', 'DAD', 'PERSON', 'MEDICINE', 'WATER', 'CUP', 'TOILET', 'BED', 'CHAIR', 'HOME', 'PHONE', 'CLOTHES', 'SHOES'] },
  { id: 'outside', rw: 'Hanze', symbol: 'ROAD', keys: ['MUM', 'DAD', 'FRIEND', 'PERSON', 'CHILD', 'ROAD', 'CAR', 'BICYCLE', 'HOME', 'SCHOOL', 'PLAYGROUND', 'HOUSE', 'TOILET', 'WATER', 'FOOD', 'BANANA', 'FRUIT', 'JUICE', 'DOG', 'CAT', 'BIRD', 'COW', 'CHICKEN', 'SHOES', 'CLOTHES', 'PHONE', 'BALL'] }
].map(Object.freeze))

export const environmentById = id => ENVIRONMENTS.find(environment => environment.id === id) ?? null

// The naming words chosen for one place: the caregiver's own list when there is one.
export function environmentWords(id, custom = {}) {
  return Object.hasOwn(custom, id) ? custom[id] : (environmentById(id)?.keys ?? [])
}

export const isCoreWord = symbol => HOME_KEYS.includes(symbol.symbol_id) || !FRINGE_CATEGORIES.includes(symbol.category)

// The keys a child can use here: their own vocabulary, narrowed to the place when one is chosen.
export function placeVocabulary(symbols, enabled, environment = 'all', custom = {}) {
  const words = environment === 'all' || !environmentById(environment) ? null : new Set(environmentWords(environment, custom))
  return new Set(symbols.filter(symbol => enabled.has(symbol.symbol_id) && (!words || isCoreWord(symbol) || words.has(symbol.symbol_id)))
    .map(symbol => symbol.symbol_id))
}
