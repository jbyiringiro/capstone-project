import { localizedError } from './errors-rw.js'

const stopped = () => localizedError('Ijwi ryahagaritswe. Ubutumwa bwawe buracyahari.')

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

export async function prepareSpeech(keys, byKey, getRecording, signal) {
  const checkStopped = () => {
    if (signal?.aborted) throw stopped()
  }
  checkStopped()
  let voices
  const parts = []
  for (const key of keys) {
    let blob = await getRecording(key)
    checkStopped()
    if (!blob) {
      // Explicitly installed/recorded words take precedence over synthetic clips.
      for (const path of [`/audio/${encodeURIComponent(key)}.wav`, `/audio/rw/${encodeURIComponent(key)}.wav`]) {
        try {
          const response = await fetch(path, { signal })
          if (response.ok && response.headers.get('content-type')?.startsWith('audio/')) blob = await response.blob()
        } catch { checkStopped() }
        checkStopped()
        if (blob?.size) break
      }
    }
    checkStopped()
    if (blob?.size) parts.push({ blob })
    else {
      voices ??= await loadVoices(signal)
      checkStopped()
      const voice = kinyarwandaVoice(voices)
      const text = byKey[key]?.label_rw
      if (voice && text) parts.push({ text, voice })
      else throw localizedError(`Ijwi ry’Ikinyarwanda rya “${byKey[key]?.label_rw ?? 'iri jambo'}” ntiribonetse. Fungura igenamiterere ry’umurezi, ujye mu majwi, wongeremo ijwi. Ubutumwa bwawe buracyahari.`)
    }
  }
  return parts
}

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
