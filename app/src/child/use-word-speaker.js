import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioWarmer, playSpeechPart, prepareSpeech } from '../speech/index.js'
import { getRecording } from '../storage/recordings.js'

// Speaks one word at once. A new tap stops the word still playing, because a child tapping again
// means the new word, not a queue. Resolves to whether the word was heard to the end.
export function useWordSpeaker(byKey) {
  const controller = useRef(null)
  const warmer = useRef(null)
  if (!warmer.current) warmer.current = new AudioWarmer()
  useEffect(() => {
    warmer.current.prepare()
    return () => { controller.current?.abort(); warmer.current.close() }
  }, [])
  return useCallback(async key => {
    controller.current?.abort()
    const playback = new AbortController()
    controller.current = playback
    warmer.current.touch()
    try {
      for (const part of await prepareSpeech([key], byKey, getRecording, playback.signal)) await playSpeechPart(part, playback.signal)
      return true
    } catch {
      return false
    } finally {
      if (controller.current === playback) controller.current = null
    }
  }, [byKey])
}

export function useMediaQuery(query) {
  const read = () => typeof matchMedia === 'function' && matchMedia(query).matches
  const [matches, setMatches] = useState(read)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(query)
    const change = () => setMatches(list.matches)
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [query])
  return matches
}
