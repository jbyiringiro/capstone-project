import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db } from '../src/db.js'
import { DEFAULT_APPEARANCE, getAppearance, saveAppearance } from '../src/appearance.js'

beforeEach(async () => { await db.settings.clear() })

it('keeps appearance preferences separate for each profile and the demo board', async () => {
  await saveAppearance('local-p1', { motion: false, largeTiles: true, realisticImages: false })
  expect(await getAppearance('local-p1')).toEqual({ motion: false, largeTiles: true, realisticImages: false })
  expect(await getAppearance('local-p2')).toEqual(DEFAULT_APPEARANCE)
  expect(await getAppearance(null)).toEqual(DEFAULT_APPEARANCE)
  await db.settings.put({ key: 'mode', value: 'predictive' })
  await saveAppearance(null, { ...DEFAULT_APPEARANCE, motion: false })
  expect((await db.settings.get('mode')).value).toBe('predictive')
  expect((await getAppearance('local-p1')).largeTiles).toBe(true)
})

it('recovers defaults from malformed stored preferences', async () => {
  await db.settings.put({ key: 'appearance:local-p1', value: { motion: 'false', largeTiles: null, realisticImages: false, unknown: true } })
  expect(await getAppearance('local-p1')).toEqual({ motion: true, largeTiles: false, realisticImages: false })
})

it('enables the new photo set for existing profiles without resetting motion or tile size', async () => {
  await db.settings.put({ key: 'appearance:local-p1', value: { motion: false, largeTiles: true, illustratedSymbols: false } })
  expect(await getAppearance('local-p1')).toEqual({ motion: false, largeTiles: true, realisticImages: true })
  await saveAppearance('local-p1', { ...(await getAppearance('local-p1')), realisticImages: false })
  expect((await getAppearance('local-p1')).realisticImages).toBe(false)
})
