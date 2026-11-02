import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db } from '../src/db.js'
import { getSpeechMode, saveSpeechMode } from '../src/audio-preferences.js'

beforeEach(async () => { await db.settings.clear() })

it('starts in Kinyarwanda and keeps Kinyarwanda across profile changes', async () => {
  expect(await getSpeechMode()).toBe('kinyarwanda')
  await saveSpeechMode('kinyarwanda')
  expect(await getSpeechMode()).toBe('kinyarwanda')
  await db.settings.put({ key: 'profile', value: { profile_id: 'local-p1' } })
  expect(await getSpeechMode()).toBe('kinyarwanda')
})
it('recovers a known speech mode from invalid stored data', async () => {
  await db.settings.put({ key: 'speech-mode', value: { invalid: true } })
  expect(await getSpeechMode()).toBe('kinyarwanda')
})
it('migrates an older English demo setting without allowing English to be enabled again', async () => {
  await db.settings.put({ key: 'speech-mode', value: 'english-demo' })
  expect(await getSpeechMode()).toBe('kinyarwanda')
  expect((await db.settings.get('speech-mode')).value).toBe('kinyarwanda')
  await saveSpeechMode('english-demo')
  expect((await db.settings.get('speech-mode')).value).toBe('kinyarwanda')
})
