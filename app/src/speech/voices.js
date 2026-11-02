import { localizedError } from '../shared/errors-rw.js'

export const stopped = () => localizedError('Ijwi ryahagaritswe. Ubutumwa bwawe buracyahari.')

export function kinyarwandaVoice(voices) {
  return voices.find(voice => /^rw(?:[-_]|$)/i.test(voice.lang)) ?? null
}

// Browsers can return an empty list until their voice service has loaded.
export function loadVoices(signal, timeout = 1000) {
  const synth = globalThis.speechSynthesis
  if (signal?.aborted) return Promise.reject(stopped())
  if (!synth) return Promise.resolve([])
  const available = synth.getVoices()
  if (available.length) return Promise.resolve(available)
  return new Promise((resolve, reject) => {
    let timer
    const clean = () => { clearTimeout(timer); synth.removeEventListener?.('voiceschanged', changed); signal?.removeEventListener('abort', cancel) }
    const finish = voices => { clean(); resolve(voices) }
    const changed = () => { const voices = synth.getVoices(); if (voices.length) finish(voices) }
    const cancel = () => { clean(); reject(stopped()) }
    synth.addEventListener?.('voiceschanged', changed)
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(() => finish(synth.getVoices()), timeout)
    changed()
  })
}
