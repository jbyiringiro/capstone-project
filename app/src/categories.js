// Stable category order and warm colour accents. Text and pictures also identify each category.
export const CATEGORIES = {
  core:       { rw: 'Ingenzi',     en: 'Everyday',    colour: '#F9E5A4', icon: 'more', symbol: 'I' },
  people:     { rw: 'Abantu',      en: 'People',      colour: '#F9E5A4', icon: 'people', symbol: 'MUM' },
  actions:    { rw: 'Ibikorwa',    en: 'Actions',     colour: '#DDEDE2', icon: 'play', symbol: 'PLAY' },
  feelings:   { rw: 'Uko numva',   en: 'Feelings',    colour: '#E7DFF4', icon: 'feelings', symbol: 'HAPPY' },
  describe:   { rw: 'Uko bimeze',  en: 'Describing',  colour: '#DDEBF4', icon: 'more', symbol: 'BIG' },
  food_drink: { rw: 'Ibiryo',      en: 'Food, drink', colour: '#F5D5B8', icon: 'food', symbol: 'FOOD' },
  things:     { rw: 'Ibintu',      en: 'Things',      colour: '#F5D5B8', icon: 'more', symbol: 'BOOK' },
  body:       { rw: 'Umubiri',     en: 'Body',        colour: '#F5D5B8', icon: 'help', symbol: 'HAND' },
  clothes:    { rw: 'Imyenda',     en: 'Clothes',     colour: '#F5D5B8', icon: 'people', symbol: 'SHIRT' },
  animals:    { rw: 'Inyamaswa',   en: 'Animals',     colour: '#F5D5B8', icon: 'leaf', symbol: 'COW' },
  places:     { rw: 'Ahantu',      en: 'Places',      colour: '#DDEBF4', icon: 'home', symbol: 'HOME' },
  time_place: { rw: 'Igihe',       en: 'Time, place', colour: '#EFE3D2', icon: 'more', symbol: 'TIME' },
  questions:  { rw: 'Ibibazo',     en: 'Questions',   colour: '#E7DFF4', icon: 'more', symbol: 'WHAT' },
  social:     { rw: 'Indamukanyo', en: 'Social',      colour: '#F6DCDD', icon: 'thanks', symbol: 'HELLO' }
}

export const CATEGORY_ORDER = ['core', 'people', 'actions', 'feelings', 'food_drink', 'things', 'places', 'body',
  'clothes', 'animals', 'describe', 'questions', 'time_place', 'social']

// The redesigned first twelve keep a stable location; every existing home/core word remains available.
export const HOME_KEYS = ['I', 'WANT', 'HELP', 'WATER', 'EAT', 'PLAY', 'YES', 'NO', 'AGAIN', 'HURT', 'TOILET', 'FINISH',
  'YOU', 'NOT', 'LIKE', 'DRINK', 'GO', 'THANK_YOU', 'MUM', 'TEACHER']

export function categoryOf(key) { return CATEGORIES[key] ?? { rw: 'Ibindi', en: 'Other', colour: '#E9E9EF', icon: 'more' } }
