import { db } from './db.js'

export const DEFAULT_SPEECH_MODE = 'kinyarwanda'
export const normaliseSpeechMode = () => DEFAULT_SPEECH_MODE
export async function getSpeechMode() {
  // Migrate installations that previously opted into the removed English demo.
  if ((await db.settings.get('speech-mode'))?.value !== DEFAULT_SPEECH_MODE) {
    await db.settings.put({ key: 'speech-mode', value: DEFAULT_SPEECH_MODE })
  }
  return DEFAULT_SPEECH_MODE
}
export async function saveSpeechMode(value) {
  const mode = normaliseSpeechMode(value)
  await db.settings.put({ key: 'speech-mode', value: mode })
  return mode
}
