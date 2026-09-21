// Board categories: Kinyarwanda name first, English second, colour from the modified Fitzgerald
// key used across AAC systems (people yellow, actions green, describing words blue, nouns orange,
// social pink, questions purple, misc grey) so children who move between boards keep their bearings.
export const CATEGORIES = {
  core:       { rw: 'Ingenzi',       en: 'Core',        colour: '#E9E9EF', icon: '⭐' },
  people:     { rw: 'Abantu',        en: 'People',      colour: '#FFE99A', icon: '🧑‍🤝‍🧑' },
  actions:    { rw: 'Ibikorwa',      en: 'Actions',     colour: '#BFEBB4', icon: '🏃' },
  feelings:   { rw: 'Uko numva',     en: 'Feelings',    colour: '#BFDCFF', icon: '😊' },
  describe:   { rw: 'Uko bimeze',    en: 'Describing',  colour: '#BFDCFF', icon: '🔵' },
  food_drink: { rw: 'Ibiryo',        en: 'Food, drink', colour: '#FFD3A6', icon: '🍽️' },
  things:     { rw: 'Ibintu',        en: 'Things',      colour: '#FFD3A6', icon: '🎒' },
  body:       { rw: 'Umubiri',       en: 'Body',        colour: '#FFD3A6', icon: '🖐️' },
  clothes:    { rw: 'Imyenda',       en: 'Clothes',     colour: '#FFD3A6', icon: '👕' },
  animals:    { rw: 'Inyamaswa',     en: 'Animals',     colour: '#FFD3A6', icon: '🐄' },
  places:     { rw: 'Ahantu',        en: 'Places',      colour: '#FFD3A6', icon: '🏫' },
  time_place: { rw: 'Igihe',         en: 'Time, place', colour: '#EFE3D2', icon: '⏰' },
  questions:  { rw: 'Ibibazo',       en: 'Questions',   colour: '#DCCBFF', icon: '❓' },
  social:     { rw: 'Indamukanyo',   en: 'Social',      colour: '#FFC9DB', icon: '👋' }
}

export const CATEGORY_ORDER = ['core', 'people', 'actions', 'feelings', 'food_drink', 'things', 'places', 'body',
  'clothes', 'animals', 'describe', 'questions', 'time_place', 'social']

// Symbols shown on the home board ("Ingenzi"), in this order
export const HOME_KEYS = ['I', 'YOU', 'WANT', 'NOT', 'LIKE', 'HELP', 'YES', 'NO', 'EAT', 'DRINK', 'PLAY', 'GO',
  'FINISH', 'THANK_YOU', 'HURT', 'TOILET', 'WATER', 'MUM', 'TEACHER']

export function categoryOf(key) { return CATEGORIES[key] ?? { rw: key, en: key, colour: '#E9E9EF', icon: '▫️' } }
