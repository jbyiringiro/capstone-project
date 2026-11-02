// Stable category order and warm colour accents. Text and pictures also identify each category.
// `key` is the board key colour by word type (a modified Fitzgerald key):
// people and pronouns yellow, actions green, describing and feelings blue, naming words orange,
// time tan, questions purple, social words pink.
export const CATEGORIES = {
  core:       { rw: 'Ingenzi',     en: 'Everyday',    colour: '#F9E5A4', key: '#FBF29B', icon: 'more', symbol: 'I' },
  people:     { rw: 'Abantu',      en: 'People',      colour: '#F9E5A4', key: '#FBF29B', icon: 'people', symbol: 'MUM' },
  actions:    { rw: 'Ibikorwa',    en: 'Actions',     colour: '#DDEDE2', key: '#C3F0A6', icon: 'play', symbol: 'PLAY' },
  feelings:   { rw: 'Uko numva',   en: 'Feelings',    colour: '#E7DFF4', key: '#C8DAF7', icon: 'feelings', symbol: 'HAPPY' },
  describe:   { rw: 'Uko bimeze',  en: 'Describing',  colour: '#DDEBF4', key: '#C8DAF7', icon: 'more', symbol: 'BIG' },
  food_drink: { rw: 'Ibiryo',      en: 'Food, drink', colour: '#F5D5B8', key: '#FFBE73', icon: 'food', symbol: 'FOOD' },
  things:     { rw: 'Ibintu',      en: 'Things',      colour: '#F5D5B8', key: '#FFBE73', icon: 'more', symbol: 'BOOK' },
  body:       { rw: 'Umubiri',     en: 'Body',        colour: '#F5D5B8', key: '#FFBE73', icon: 'help', symbol: 'HAND' },
  clothes:    { rw: 'Imyenda',     en: 'Clothes',     colour: '#F5D5B8', key: '#FFBE73', icon: 'people', symbol: 'SHIRT' },
  animals:    { rw: 'Inyamaswa',   en: 'Animals',     colour: '#F5D5B8', key: '#FFBE73', icon: 'leaf', symbol: 'COW' },
  places:     { rw: 'Ahantu',      en: 'Places',      colour: '#DDEBF4', key: '#FFBE73', icon: 'home', symbol: 'HOME' },
  time_place: { rw: 'Igihe',       en: 'Time, place', colour: '#EFE3D2', key: '#E9D3B3', icon: 'more', symbol: 'TIME' },
  questions:  { rw: 'Ibibazo',     en: 'Questions',   colour: '#E7DFF4', key: '#D9D2F6', icon: 'more', symbol: 'WHAT' },
  social:     { rw: 'Indamukanyo', en: 'Social',      colour: '#F6DCDD', key: '#F9CFE0', icon: 'thanks', symbol: 'HELLO' }
}

export const CATEGORY_ORDER = ['core', 'people', 'actions', 'feelings', 'food_drink', 'things', 'places', 'body',
  'clothes', 'animals', 'describe', 'questions', 'time_place', 'social']

// The redesigned first twelve keep a stable location; every existing home/core word remains available.
export const HOME_KEYS = ['I', 'WANT', 'HELP', 'WATER', 'EAT', 'PLAY', 'YES', 'NO', 'AGAIN', 'HURT', 'TOILET', 'FINISH',
  'YOU', 'NOT', 'LIKE', 'DRINK', 'GO', 'THANK_YOU', 'MUM', 'TEACHER']

export function categoryOf(key) { return CATEGORIES[key] ?? { rw: 'Ibindi', en: 'Other', colour: '#E9E9EF', key: '#FFFFFF', icon: 'more' } }
