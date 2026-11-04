import { useEffect, useRef, useState } from 'react'
import { getRecording } from '../storage/recordings.js'
import { AudioWarmer, InstalledClipSource, playSpeechPart, prepareSpeech, whenIdle } from '../speech/index.js'
import { sentenceBuilder, wordByWord } from '../grammar/sentence.js'

// The board's speech: each picture said as it is chosen, and the message made ready while the child
// is still choosing, then played, and stopped on request or when the board is hidden. `busy` stays
// set while a message is spoken and saved, and the board ignores taps meanwhile.
export function useBoardSpeech({ message, byKey, sentences, visible }) {
  const [speaking, setSpeaking] = useState(false)
  const busy = useRef(false)
  const controller = useRef(null)
  const word = useRef(null)
  const warmer = useRef(null)
  // The message's speech, made ready while the child is still choosing: { id, parts } (see speak).
  const prepared = useRef(null)
  const installed = useRef(null)
  if (!warmer.current) warmer.current = new AudioWarmer()
  if (!installed.current) installed.current = new InstalledClipSource('/audio')
  const toSpeech = keys => (sentences ? sentenceBuilder.build(keys, byKey) : wordByWord(keys, byKey))
  const plan = (parts, signal) => prepareSpeech(parts, byKey, getRecording, signal, { installed: installed.current })
  const speechId = keys => `${sentences}:${keys.join(' ')}`
  useEffect(() => () => { controller.current?.abort(); word.current?.abort(); warmer.current?.close() }, [])
  useEffect(() => {
    if (visible) warmer.current.prepare()
    else {
      controller.current?.abort()
      word.current?.abort()
    }
  }, [visible])
  // Vuga then only has to play: on an emulated low-end phone, finding and reading the clips after
  // the press took most of the time to the first sound (NFR2: within 300 ms). Showing the board
  // again (after the caregiver area, where voices may change) prepares it afresh.
  useEffect(() => {
    prepared.current = null
    if (!visible || !message.length) return
    const keys = [...message], preparing = new AbortController()
    const cancel = whenIdle(() => {
      prepared.current = { id: speechId(keys), parts: plan(toSpeech(keys).parts, preparing.signal).catch(() => null) }
    }, 300)
    return () => { cancel(); preparing.abort() }
  }, [message, visible, sentences, byKey])

  // Each picture is said as it is chosen, so the child hears the word. A new tap stops the word before.
  async function sayWord(key) {
    word.current?.abort()
    const playback = new AbortController()
    word.current = playback
    try {
      for (const part of await plan([key], playback.signal)) await playSpeechPart(part, playback.signal)
    } catch {
      // The word is still in the message; Vuga reports a missing voice when the message is spoken.
    } finally {
      if (word.current === playback) word.current = null
    }
  }
  // Says the message, then runs `afterwards` (saving it) before the board takes taps again. The board
  // redraws as speaking once the sound has started, and `onSound` runs then: on a slow tablet,
  // redrawing every key first held the sound back. Returns null, or what went wrong: the error,
  // whether the message had already played and whether it was stopped.
  async function speak(keys, { onSound, afterwards }) {
    const playback = new AbortController()
    let played = false, shown = false
    busy.current = true
    word.current?.abort()
    controller.current = playback
    const showSpeaking = () => {
      if (shown) return
      shown = true
      setSpeaking(true)
      onSound()
    }
    try {
      const ready = prepared.current?.id === speechId(keys) ? await prepared.current.parts : null
      const parts = ready ?? await plan(toSpeech(keys).parts, playback.signal)
      for (const part of parts) await playSpeechPart(part, playback.signal, showSpeaking)
      played = true
      await afterwards()
      return null
    } catch (error) {
      return { error, played, stopped: playback.signal.aborted }
    } finally {
      busy.current = false
      setSpeaking(false)
      controller.current = null
    }
  }
  return {
    speaking, busy, sayWord, speak,
    stop: () => controller.current?.abort(),
    touch: () => warmer.current.touch()
  }
}
