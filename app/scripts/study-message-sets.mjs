// Checks that the adult study's two message sets are matched (proposal 3.2.3): same number of
// words and the same navigation demand on the static board, with the predictive-board cost shown
// for information. Costs follow the app exactly: the category rail is always visible, every
// message starts on the home page (Ingenzi), a word not on the current page costs one category tap
// plus the word, a suggestion costs one tap without navigation, and Vuga is one more tap.
//
//   node scripts/study-message-sets.mjs [--out ../docs/study/message_sets.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KneserNeyTrigram } from '../src/prediction/index.js'
import { HOME_KEYS } from '../src/symbols/categories.js'
import { parseSymbols } from '../src/symbols/catalogue.js'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf-8')
const symbols = parseSymbols(read('../../vocab/symbols.csv'))
const byKey = Object.fromEntries(symbols.map(s => [s.symbol_id, s]))
const model = new KneserNeyTrigram(JSON.parse(read('../public/models/kn_trigram.json')))
const allowed = new Set(symbols.map(s => s.symbol_id))

export const PRACTICE = [['YES'], ['HELLO', 'FRIEND'], ['I', 'LIKE', 'CAT']]
export const SETS = {
  A: [['I', 'WANT', 'WATER'], ['I', 'WANT', 'EAT', 'BREAD'], ['I', 'HURT', 'HEAD'], ['I', 'WANT', 'GO', 'HOME'],
    ['MUM', 'COME', 'HERE'], ['I', 'NOT', 'LIKE', 'MILK'], ['I', 'WANT', 'PLAY', 'BALL'], ['WHERE', 'TOILET'],
    ['I', 'TIRED', 'WANT', 'SLEEP'], ['THANK_YOU', 'TEACHER']],
  B: [['YOU', 'HELP', 'I'], ['I', 'WANT', 'DRINK', 'TEA'], ['I', 'HURT', 'STOMACH'], ['I', 'WANT', 'GO', 'SCHOOL'],
    ['TEACHER', 'COME', 'HERE'], ['I', 'NOT', 'LIKE', 'RICE'], ['I', 'WANT', 'EAT', 'BANANA'], ['WHERE', 'DAD'],
    ['I', 'HUNGRY', 'WANT', 'EAT'], ['THANK_YOU', 'MUM']]
}

// What each picture sequence means as a sentence. The pictures' labels in order ("njye gushaka
// amazi") are not a Kinyarwanda sentence, so the card shows this sentence as the message and the
// pictures to press separately. It is also what the board says (app/src/grammar/sentence.js), and
// tests/grammar/sentence.test.js checks the two agree. Draft wording: a native speaker checks it
// before the cards are printed.
export const SENTENCES = {
  'YES': ['Yego.', 'Yes.'],
  'HELLO FRIEND': ['Muraho, nshuti.', 'Hello, friend.'],
  'I LIKE CAT': ['Nkunda injangwe.', 'I like cats.'],
  'I WANT WATER': ['Ndashaka amazi.', 'I want water.'],
  'I WANT EAT BREAD': ['Ndashaka kurya umugati.', 'I want to eat bread.'],
  'I HURT HEAD': ['Ndababara umutwe.', 'My head hurts.'],
  'I WANT GO HOME': ['Ndashaka kujya mu rugo.', 'I want to go home.'],
  'MUM COME HERE': ['Mama, ngwino hano.', 'Mum, come here.'],
  'I NOT LIKE MILK': ['Sinkunda amata.', 'I don’t like milk.'],
  'I WANT PLAY BALL': ['Ndashaka gukina umupira.', 'I want to play ball.'],
  'WHERE TOILET': ['Umusarani uri he?', 'Where is the toilet?'],
  'I TIRED WANT SLEEP': ['Ndananiwe, ndashaka kuryama.', 'I’m tired, I want to sleep.'],
  'THANK_YOU TEACHER': ['Murakoze, mwarimu.', 'Thank you, teacher.'],
  'YOU HELP I': ['Mfasha.', 'Help me.'],
  'I WANT DRINK TEA': ['Ndashaka kunywa icyayi.', 'I want to drink tea.'],
  'I HURT STOMACH': ['Ndababara inda.', 'My stomach hurts.'],
  'I WANT GO SCHOOL': ['Ndashaka kujya ku ishuri.', 'I want to go to school.'],
  'TEACHER COME HERE': ['Mwarimu, ngwino hano.', 'Teacher, come here.'],
  'I NOT LIKE RICE': ['Sinkunda umuceri.', 'I don’t like rice.'],
  'I WANT EAT BANANA': ['Ndashaka kurya umuneke.', 'I want to eat a banana.'],
  'WHERE DAD': ['Papa ari he?', 'Where is Dad?'],
  'I HUNGRY WANT EAT': ['Ndashonje, ndashaka kurya.', 'I’m hungry, I want to eat.'],
  'THANK_YOU MUM': ['Murakoze, mama.', 'Thank you, Mum.']
}

const home = new Set([...HOME_KEYS, ...symbols.filter(s => s.category === 'core').map(s => s.symbol_id)])
const visible = (key, page) => (page === 'core' ? home.has(key) : byKey[key].category === page)
const pagesWith = key => [...new Set(['core', byKey[key].category])].filter(page => visible(key, page))

// Fewest actions to compose `message` and press Vuga, by dynamic programming over the page shown.
function cost(message, predictive) {
  let states = new Map([['core', 0]])
  message.forEach((key, i) => {
    const suggested = predictive && model.topK(message.slice(0, i), 3, allowed).includes(key)
    const next = new Map()
    const keep = (page, actions) => { if (!next.has(page) || actions < next.get(page)) next.set(page, actions) }
    for (const [page, actions] of states) {
      if (suggested || visible(key, page)) keep(page, actions + 1)
      for (const target of pagesWith(key)) if (target !== page) keep(target, actions + 2)
    }
    states = next
  })
  return Math.min(...states.values()) + 1
}

function describe(messages) {
  const rows = messages.map(message => ({
    keys: message, kinyarwanda: message.map(key => byKey[key].label_rw).join(' '),
    english: message.map(key => byKey[key].label_en).join(' '),
    sentence_rw: SENTENCES[message.join(' ')][0], sentence_en: SENTENCES[message.join(' ')][1],
    words: message.length, static_actions: cost(message, false), predictive_actions: cost(message, true)
  }))
  const total = field => rows.reduce((sum, row) => sum + row[field], 0)
  return { rows, words: total('words'), static_actions: total('static_actions'), predictive_actions: total('predictive_actions') }
}

for (const key of [...PRACTICE, ...SETS.A, ...SETS.B].flat()) if (!byKey[key]) throw new Error(`unknown symbol ${key}`)
for (const message of [...PRACTICE, ...SETS.A, ...SETS.B]) if (!SENTENCES[message.join(' ')]) throw new Error(`no sentence for ${message.join(' ')}`)
const report = { practice: describe(PRACTICE), A: describe(SETS.A), B: describe(SETS.B) }
for (const name of ['A', 'B']) {
  const set = report[name]
  console.log(`Set ${name}: ${set.words} words, static ${set.static_actions} actions, predictive ${set.predictive_actions}`)
  for (const row of set.rows) console.log(`  ${row.kinyarwanda.padEnd(32)} ${row.english.padEnd(28)} words ${row.words}  static ${row.static_actions}  predictive ${row.predictive_actions}`)
}
const outIndex = process.argv.indexOf('--out')
if (outIndex > 0) {
  const out = fileURLToPath(new URL(process.argv[outIndex + 1], `file://${process.cwd().replaceAll('\\', '/')}/`))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
}
