import { localizedError } from '../shared/errors-rw.js'
import { stopped } from './voices.js'

// Plays one prepared part and settles only when it has finished, failed or been stopped, always
// releasing the media element, the object URL and the abort listener.
export function playSpeechPart(part, signal) {
  return new Promise((resolve, reject) => {
    let audio, utterance, url, timer, settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancelled)
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause() }
      if (utterance) { utterance.onend = null; utterance.onerror = null }
      if (url) URL.revokeObjectURL(url)
    }
    const complete = () => { if (settled) return; settled = true; cleanup(); resolve() }
    const fail = message => { if (settled) return; settled = true; cleanup(); if (!part.blob) globalThis.speechSynthesis?.cancel(); reject(localizedError(message)) }
    const failed = error => fail(error?.name === 'NotAllowedError' || error?.error === 'not-allowed'
      ? 'Mushakisha yahagaritse ijwi. Emerera uru rubuga gukoresha amajwi, wongere ukande Vuga. Ubutumwa buracyahari.'
      : 'Ijwi ntiryabashije gukina. Reba indangururamajwi, hanyuma ugerageze ijwi mu igenamiterere ry’umurezi. Ubutumwa buracyahari.')
    const cancelled = () => fail(stopped().message)
    if (signal?.aborted) { cancelled(); return }
    signal?.addEventListener('abort', cancelled, { once: true })
    timer = setTimeout(() => fail('Ijwi ntiryabashije kurangira. Gerageza ijwi mu igenamiterere ry’umurezi. Ubutumwa buracyahari.'), 30000)
    try {
      if (part.blob) {
        url = URL.createObjectURL(part.blob)
        audio = new Audio(url)
        audio.onended = complete
        audio.onerror = failed
        audio.play().catch(failed)
      } else {
        utterance = new SpeechSynthesisUtterance(part.text)
        utterance.voice = part.voice
        utterance.lang = part.voice.lang
        utterance.rate = 0.9
        utterance.onend = complete
        utterance.onerror = failed
        globalThis.speechSynthesis.speak(utterance)
      }
    } catch (error) { failed(error) }
  })
}
