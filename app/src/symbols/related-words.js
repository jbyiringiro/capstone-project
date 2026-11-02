// Next words after a picture, the second step of one choice: tapping "kunywa"
// (drink) adds the word and opens the pictures that usually follow it (amazi, amata, umutobe,
// igikombe…) in fixed positions. Choosing one returns the child to the page they came from.
// A caregiver can rewrite any list for one child; the lists below are the starting point.
export const MAX_RELATED = 24

export const RELATED_WORDS = Object.freeze({
  DRINK: ['WATER', 'MILK', 'JUICE', 'TEA', 'PORRIDGE', 'CUP', 'SUGAR', 'HOT', 'COLD'],
  EAT: ['FOOD', 'BREAD', 'RICE', 'BEANS', 'POTATOES', 'BANANA', 'MEAT', 'FRUIT', 'PORRIDGE', 'PLATE', 'SPOON', 'HUNGRY'],
  FOOD: ['BREAD', 'RICE', 'BEANS', 'POTATOES', 'BANANA', 'MEAT', 'FRUIT', 'PORRIDGE', 'MILK', 'SUGAR', 'PLATE', 'SPOON'],
  PLAY: ['BALL', 'FRIEND', 'PLAYGROUND', 'BICYCLE', 'MUSIC', 'SONG', 'DANCE', 'SING', 'RUN', 'JUMP', 'DRAW'],
  GO: ['HOME', 'SCHOOL', 'PLAYGROUND', 'TOILET', 'HOUSE', 'ROAD', 'GO_OUT', 'GO_HOME', 'CAR', 'BICYCLE', 'NOW', 'TOMORROW'],
  HURT: ['HEAD', 'STOMACH', 'TOOTH', 'EAR', 'EYE', 'MOUTH', 'NOSE', 'HAND', 'LEG', 'SICK', 'DOCTOR', 'MEDICINE'],
  SICK: ['DOCTOR', 'MEDICINE', 'HEAD', 'STOMACH', 'HOT', 'COLD', 'TIRED', 'SLEEP'],
  BATHE: ['WATER', 'SOAP', 'HOT', 'COLD', 'CLOTHES', 'WASH_HANDS'],
  WASH_HANDS: ['WATER', 'SOAP', 'HAND', 'TOILET', 'EAT'],
  DRESS: ['CLOTHES', 'SHIRT', 'TROUSERS', 'SHOES'],
  CLOTHES: ['SHIRT', 'TROUSERS', 'SHOES'],
  SLEEP: ['BED', 'NIGHT', 'TIRED', 'HOME', 'WAKE_UP'],
  READ: ['BOOK', 'TEACHER', 'SCHOOL'],
  WRITE: ['PEN', 'BOOK', 'TEACHER'],
  DRAW: ['PEN', 'BOOK'],
  LOOK: ['TV', 'BOOK', 'PHONE', 'BIRD', 'DOG', 'CAT', 'COW', 'CHICKEN', 'CAR'],
  SEE: ['TV', 'BOOK', 'PHONE', 'BIRD', 'DOG', 'CAT', 'COW', 'CHICKEN', 'CAR'],
  CALL: ['MUM', 'DAD', 'TEACHER', 'FRIEND', 'DOCTOR', 'PHONE'],
  COME: ['MUM', 'DAD', 'TEACHER', 'FRIEND', 'HERE', 'NOW'],
  GIVE: ['WATER', 'FOOD', 'CUP', 'SPOON', 'BALL', 'BOOK', 'PHONE', 'PEN'],
  BRING: ['WATER', 'FOOD', 'CUP', 'SPOON', 'BALL', 'BOOK', 'PHONE', 'PEN']
})

// The list a child sees after `key`: the caregiver's own list when there is one, else the default.
export function relatedWords(key, custom = {}) {
  return Object.hasOwn(custom, key) ? custom[key] : (RELATED_WORDS[key] ?? [])
}

// Words that open a next-words page for this child: the defaults plus any the caregiver added.
export function relatedTriggers(custom = {}) {
  return [...new Set([...Object.keys(RELATED_WORDS), ...Object.keys(custom)])]
}
