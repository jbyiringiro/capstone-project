import grammar from './grammar_rw.json'

// Turns the pictures of a message into the Kinyarwanda sentence the tablet says: I + WANT + WATER
// is spoken "Ndashaka amazi." rather than "njye gushaka amazi". The words come from the table that
// ml/scripts/export_grammar.py builds with the same morphology rules used to train the predictor;
// this class only decides word order and which form fits. Each part is either a picture's own word
// (its clip or a caregiver's recording) or a generated word with its own clip. Anything the rules
// do not cover is said word by word, as before, so no message is ever lost. A verb is only inflected
// for a person the message names (I, you, Mama...): a picture on its own, or a verb with no person,
// keeps its own word, so WANT alone is still "gushaka", never "ndashaka".
export const clipName = text => text.replaceAll(' ', '_')

export function wordByWord(keys, byKey) {
  const parts = keys.map(key => ({ text: byKey[key]?.label_rw ?? key, keys: [key] }))
  return { text: parts.map(part => part.text).join(' '), parts }
}

export class SentenceBuilder {
  constructor(table = grammar) {
    this.g = table
    this.complements = new Set(table.complement_verbs)
    this.requests = new Set(table.request_verbs)
    this.interjections = new Set(table.interjections)
    this.questions = new Set(table.questions)
  }

  build(keys, byKey) {
    return new Sentence(this, keys, byKey).realise()
  }
}

// One message being realised, left to right, with the subject carried from clause to clause.
class Sentence {
  constructor(builder, keys, byKey) {
    Object.assign(this, { b: builder, g: builder.g, keys, byKey })
    this.parts = []
    this.subject = null          // person of the current clause ('1sg', '3sg', ...)
    this.infinitive = false      // after "want", "need", "go"... the next verb stays an infinitive
    this.question = false
  }

  realise() {
    let i = 0
    while (i < this.keys.length) i = this.step(i)
    if (!this.parts.length) return { text: '', parts: [] }
    const words = this.parts.map((part, index) => part.text + (part.comma && index < this.parts.length - 1 ? ',' : ''))
    const text = words.join(' ')
    return { text: text[0].toLocaleUpperCase('rw') + text.slice(1) + (this.question ? '?' : '.'), parts: this.parts.map(({ comma, ...part }) => part) }
  }

  // --- reading the table
  verb(key) { return this.g.verbs[key] }
  noun(key) { return this.g.nouns[key] }
  person(key) { return this.g.persons[key] }
  label(key) { return this.byKey[key]?.label_rw ?? key }
  startsClause(key) { return key === undefined || this.person(key) !== undefined || this.b.interjections.has(key) }

  // --- writing parts
  word(key) { return { text: this.label(key), keys: [key] } }
  generated(text, keys) {
    return keys.length === 1 && text === this.label(keys[0]) ? this.word(keys[0]) : { text, keys, clip: clipName(text) }
  }
  push(part) { this.parts.push(part) }
  comma() { if (this.parts.length) this.parts[this.parts.length - 1].comma = true }

  step(i) {
    const { keys } = this, key = keys[i], next = keys[i + 1], symbol = this.byKey[key]
    if (!symbol || symbol.custom) { this.push(this.word(key)); return i + 1 }

    if (this.b.interjections.has(key)) {
      this.push(this.word(key))
      this.subject = null; this.infinitive = false
      if (next !== undefined) this.comma()
      if (this.noun(next)?.vocative) {
        this.push(this.generated(this.noun(next).vocative, [next]))
        if (keys[i + 2] !== undefined) this.comma()
        return i + 2
      }
      return i + 1
    }

    // "where is ...?": the noun leads, then the agreeing "is where" (umusarani uri he, papa ari he)
    if (key === 'WHERE' && this.noun(next)) return this.where(next, i + 2)
    if (this.noun(key) && next === 'WHERE') return this.where(key, i + 2)
    if (this.b.questions.has(key)) { this.question = true; this.push(this.word(key)); return i + 1 }

    // a name before a request is a call: "Mama, ngwino hano"
    if (this.noun(key)?.vocative && this.b.requests.has(next)) {
      this.push(this.generated(this.noun(key).vocative, [key]))
      this.comma()
      return this.request(i + 1)
    }
    // a person before a verb is its subject: "Mama ararwaye"
    if (this.noun(key)?.class === 1 && this.verb(next)) {
      this.push(this.word(key))
      this.subject = '3sg'; this.infinitive = false
      return this.finite(i + 1, '3sg', false, [], false)
    }

    if (key === 'YOU' && this.b.requests.has(next)) return this.request(i + 1)
    if (this.person(key)) {
      const negative = next === 'NOT', verbAt = i + (negative ? 2 : 1)
      if (this.verb(keys[verbAt])) {
        this.subject = this.person(key); this.infinitive = false
        return this.finite(verbAt, this.subject, negative, keys.slice(i, verbAt), false)
      }
      this.push(this.word(key))
      return i + 1
    }
    if (key === 'NOT' && this.verb(next) && !this.infinitive && this.subject) return this.finite(i + 1, this.subject, true, [key], true)

    if (this.verb(key)) {
      if (this.infinitive) return this.infinitiveAt(i)
      // "help me" names the person: HELP + I is "Mfasha"
      if (!this.parts.length && next === 'I' && this.verb(key).imperative_me) return this.request(i)
      // a new clause carries the last subject (ndananiwe, ndashaka kuryama); with none, the word stays
      if (this.subject) return this.finite(i, this.subject, false, [], true)
    }
    this.push(this.word(key))
    return i + 1
  }

  where(nounKey, after) {
    this.question = true
    this.push(this.word(nounKey))
    this.push(this.generated(this.noun(nounKey).where, ['WHERE']))
    return after
  }

  // A verb with its subject: one inflected word (ndashaka, sinkunda, ndananiwe), then a place
  // for "go" (ngiye ku ishuri). Missing forms fall back to the pictures' own words.
  finite(at, person, negative, leading, newClause) {
    const { keys } = this, key = keys[at], entry = this.verb(key), after = keys[at + 1]
    const form = negative ? entry.neg?.[person] : (this.startsClause(after) ? entry.final : entry.before)?.[person]
    if (!form) {
      leading.concat(key).forEach(k => this.push(this.word(k)))
      return at + 1
    }
    if (newClause) this.comma()
    this.push(this.generated(form, [...leading, key]))
    this.subject = person
    this.infinitive = this.b.complements.has(key)
    if (key === 'GO' && this.noun(after)?.locative) {
      this.push(this.generated(this.noun(after).locative, [after]))
      return at + 2
    }
    return at + 1
  }

  // After "want", "need" or "go" a verb stays an infinitive; "go" before a place or another verb
  // is kujya (ndashaka kujya mu rugo, ndashaka kujya gukina).
  infinitiveAt(at) {
    const { keys } = this, key = keys[at], after = keys[at + 1]
    if (key === 'GO' && (this.noun(after)?.locative || this.verb(after))) {
      this.push(this.generated(this.verb('GO').with_place.infinitive, [key]))
      if (this.noun(after)?.locative) { this.push(this.generated(this.noun(after).locative, [after])); return at + 2 }
      return at + 1
    }
    this.push(this.word(key))
    return at + 1
  }

  // A request to the listener: ngwino, tegereza, mfasha (help me), mpa amazi (give me water).
  request(at) {
    const { keys } = this, key = keys[at], entry = this.verb(key), after = keys[at + 1]
    this.subject = '2sg'
    this.infinitive = this.b.complements.has(key)
    if (after === 'I' && entry.imperative_me) {
      this.push(this.generated(entry.imperative_me, [key, after]))
      return at + 2
    }
    const form = entry.imperative_alone ?? entry.imperative
    this.push(form ? this.generated(form, [key]) : this.word(key))
    return at + 1
  }
}

export const sentenceBuilder = new SentenceBuilder()
