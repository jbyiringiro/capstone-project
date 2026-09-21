// Fallback glyphs shown only while a symbol has no ARASAAC pictogram (fetch_pictograms.py).
const BY_KEY = {
  I: '👉', YOU: '👆', HE_SHE: '🧍', WE: '👥', YOU_PL: '👐', THEY: '👫', NOT: '🚫', YES: '✅', NO: '❌',
  WANT: '🙏', LIKE: '❤️', NEED: '❗', HAVE: '🤲', EAT: '🍽️', DRINK: '🥤', PLAY: '⚽', SLEEP: '😴', WAKE_UP: '🌅',
  GO: '🚶', GO_HOME: '🏠', COME: '👋', HELP: '🆘', SEE: '👀', LOOK: '🔍', HEAR: '👂', SAY: '🗣️', DO: '🔧',
  LEARN: '📚', READ: '📖', WRITE: '✏️', DRAW: '🎨', COUNT: '🔢', WAIT: '⏳', STAND: '🧍', SIT: '🪑', DRESS: '👕',
  WASH_HANDS: '🧼', BATHE: '🛁', CLEAN: '🧹', GO_OUT: '🚪', ENTER: '➡️', OPEN: '📂', CLOSE: '📁', GIVE: '🎁',
  TAKE: '✊', PUT: '📥', BRING: '📦', CARRY: '🎒', HAPPY: '😊', CRY: '😢', LAUGH: '😂', SICK: '🤒', HURT: '🤕',
  HUNGRY: '🍞', COLD: '🥶', HOT: '🥵', TIRED: '😩', AFRAID: '😨', ANGRY: '😠', REFUSE: '🙅', ASK_FOR: '🙋',
  ASK: '❓', REPEAT: '🔁', START: '▶️', FINISH: '🏁', STOP: '✋', DANCE: '💃', SING: '🎤', WALK: '🚶', RUN: '🏃',
  JUMP: '🤸', KNOW: '💡', REMEMBER: '🧠', FORGET: '💭', THINK: '🤔', BUY: '🛒', CALL: '📞', HURRY: '⏩', BE: '🟰',
  CAN: '💪', MUST: '📌', MUM: '👩', DAD: '👨', TEACHER: '👩‍🏫', CHILD: '🧒', FRIEND: '🤝', GIRL: '👧', BOY: '👦',
  DOCTOR: '🩺', PERSON: '🧑', WATER: '💧', MILK: '🥛', FOOD: '🍲', BREAD: '🍞', FRUIT: '🍎', BANANA: '🍌',
  TEA: '🍵', RICE: '🍚', BEANS: '🫘', POTATOES: '🥔', MEAT: '🍖', SUGAR: '🍬', BALL: '⚽', BOOK: '📕', PEN: '🖊️',
  SCHOOL: '🏫', HOME: '🏠', HOUSE: '🏡', TOILET: '🚽', BED: '🛏️', CHAIR: '🪑', TABLE: '🪑', CAR: '🚗',
  BICYCLE: '🚲', DOG: '🐕', CAT: '🐈', COW: '🐄', CHICKEN: '🐔', BIRD: '🐦', PHONE: '📱', TV: '📺', MUSIC: '🎵',
  SONG: '🎶', PLAYGROUND: '🛝', ROAD: '🛣️', RAIN: '🌧️', SUN: '☀️', HEAD: '🙂', HAND: '✋', LEG: '🦵', EYE: '👁️',
  EAR: '👂', STOMACH: '🫃', TOOTH: '🦷', MOUTH: '👄', NOSE: '👃', HAIR: '💇', SHIRT: '👕', SHOES: '👟',
  TROUSERS: '👖', CLOTHES: '🧥', NIGHT: '🌙', MORNING: '🌄', EVENING: '🌆', THANK_YOU: '🙏', HELLO: '👋',
  GOOD_MORNING: '🌞', GOOD_AFTERNOON: '🌤️', GOODBYE: '👋', GOOD: '👍', BAD: '👎', VERY: '‼️', SLOWLY: '🐢',
  QUICKLY: '🐇', MANY: '🔢', FEW: '🤏', BIG: '🐘', SMALL: '🐭', NEW: '✨', ALL: '🌐', ONLY: '1️⃣', HERE: '📍',
  THERE: '👉', WHERE: '🗺️', WHAT: '❓', WHO: '🙋', WHEN: '📅', WHY: '🤷', HOW: '🛠️', NOW: '⏱️', TOMORROW: '📆',
  AGAIN: '🔁', ALSO: '➕', THIS: '👇', TIME: '🕒', BEFORE: '⏮️', AFTER: '⏭️', PROBLEM: '⚠️', THING: '📦', DAY: '📅',
  EVERY: '♾️'
}
const BY_CATEGORY = { people: '🧑', actions: '🏃', feelings: '😊', describe: '🔵', food_drink: '🍽️', things: '📦',
  body: '🖐️', clothes: '👕', animals: '🐾', places: '📍', time_place: '⏰', questions: '❓', social: '👋', core: '⭐' }

export function fallbackGlyph(symbol) { return BY_KEY[symbol.symbol_id] ?? BY_CATEGORY[symbol.category] ?? '▫️' }
