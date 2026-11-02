import { localizedError } from '../shared/errors-rw.js'
import { ClipSource, GeneratedClipSource, InstalledClipSource, RecordingSource, SystemVoiceSource } from './audio-sources.js'
import { stopped } from './voices.js'

const missingSpeech = symbol => localizedError(`Ijwi ry’Ikinyarwanda rya “${symbol?.label_rw ?? 'iri jambo'}” ntiribonetse. Fungura igenamiterere ry’umurezi, ujye mu majwi, wongeremo ijwi. Ubutumwa bwawe buracyahari.`)

// Resolves every word of a message to speech before anything plays, so a missing word is reported
// while the message is still intact and Erekana can be offered instead of half a sentence. The
// message is a list of picture keys, or of sentence parts ({ keys, clip }) from the sentence
// builder: a part with a generated clip (ndashaka) plays it, and falls back to its pictures' own
// words if the clip is missing.
export class SpeechPlanner {
  constructor(sources, generated = null) {
    this.sources = sources
    this.generated = generated
  }

  async plan(message, byKey, signal) {
    const checkStopped = () => { if (signal?.aborted) throw stopped() }
    checkStopped()
    const parts = []
    for (const item of message) {
      const { keys, clip } = typeof item === 'string' ? { keys: [item] } : item
      const generated = clip && this.generated ? await this.generated.resolve(clip, null, signal) : null
      checkStopped()
      if (generated) { parts.push(generated); continue }
      for (const key of keys) parts.push(await this.#resolve(key, byKey[key], signal, checkStopped))
    }
    return parts
  }

  async #resolve(key, symbol, signal, checkStopped) {
    for (const source of this.sources) {
      const part = await source.resolve(key, symbol, signal)
      checkStopped()
      if (part) return part
    }
    throw missingSpeech(symbol)
  }
}

// Playback order: a caregiver's recording, an installation's clip, the bundled Kinyarwanda clip,
// then a Kinyarwanda system voice. English is never a fallback.
export function defaultSources(getRecording, installed = new InstalledClipSource('/audio')) {
  return [new RecordingSource(getRecording), installed, new ClipSource('/audio/rw'), new SystemVoiceSource()]
}

// `message` is picture keys (one word each) or sentence parts from the sentence builder. A board
// passes its own `installed` source, so installed.json is read once rather than on every word.
export function prepareSpeech(message, byKey, getRecording, signal, { installed } = {}) {
  return new SpeechPlanner(defaultSources(getRecording, installed), new GeneratedClipSource()).plan(message, byKey, signal)
}
