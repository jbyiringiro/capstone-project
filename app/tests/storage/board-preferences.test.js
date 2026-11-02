import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db } from '../../src/storage/db.js'
import { DEFAULT_PREFERENCES, getBoardPreferences, saveBoardPreferences } from '../../src/storage/board-preferences.js'

beforeEach(async () => { await db.settings.clear() })

it('keeps board preferences separate for each profile and the demo board', async () => {
  const chosen = { motion: false, largeTiles: true, realisticImages: false, gridSize: 9, personalSuggestions: true }
  await saveBoardPreferences('local-p1', chosen)
  expect(await getBoardPreferences('local-p1')).toEqual({ ...DEFAULT_PREFERENCES, ...chosen })
  expect(await getBoardPreferences('local-p2')).toEqual(DEFAULT_PREFERENCES)
  expect(await getBoardPreferences(null)).toEqual(DEFAULT_PREFERENCES)
  await db.settings.put({ key: 'mode', value: 'predictive' })
  await saveBoardPreferences(null, { ...DEFAULT_PREFERENCES, motion: false })
  expect((await db.settings.get('mode')).value).toBe('predictive')
  expect((await getBoardPreferences('local-p1')).largeTiles).toBe(true)
})

it('recovers defaults from malformed stored preferences', async () => {
  await db.settings.put({ key: 'appearance:local-p1', value: { motion: 'false', largeTiles: null, realisticImages: false, gridSize: 7, personalSuggestions: 'yes', unknown: true } })
  expect(await getBoardPreferences('local-p1')).toEqual({ ...DEFAULT_PREFERENCES, realisticImages: false })
})

it('accepts only the supported grid sizes from 4 to 40 cells', async () => {
  for (const gridSize of ['auto', 4, 6, 9, 12, 20, 24, 40]) {
    expect((await saveBoardPreferences('local-p1', { gridSize })).gridSize).toBe(gridSize)
  }
  for (const gridSize of [0, 3, 41, '9', null]) {
    expect((await saveBoardPreferences('local-p1', { gridSize })).gridSize).toBe('auto')
  }
})

it('keeps settings saved before the grid and personal options existed', async () => {
  await db.settings.put({ key: 'appearance:local-p1', value: { motion: false, largeTiles: true, illustratedSymbols: false } })
  expect(await getBoardPreferences('local-p1')).toEqual({ ...DEFAULT_PREFERENCES, motion: false, largeTiles: true })
  await saveBoardPreferences('local-p1', { ...(await getBoardPreferences('local-p1')), realisticImages: false })
  expect((await getBoardPreferences('local-p1')).realisticImages).toBe(false)
})

it('keeps next words, speaking on tap and the place per child, and rejects malformed lists', async () => {
  const chosen = { relatedWords: true, speakOnTap: true, environment: 'meal', relatedLists: { DRINK: ['MILK', 'CUP'], EAT: [] }, environmentLists: { meal: ['CUP'] } }
  expect(await saveBoardPreferences('local-p1', chosen)).toEqual({ ...DEFAULT_PREFERENCES, ...chosen })
  expect((await getBoardPreferences('local-p2')).environment).toBe('all')
  const bad = { relatedWords: 'yes', speakOnTap: 1, environment: 'market', relatedLists: { DRINK: ['MILK', 'MILK'] }, environmentLists: { market: ['CUP'] } }
  expect(await saveBoardPreferences('local-p1', bad)).toEqual(DEFAULT_PREFERENCES)
  for (const relatedLists of [[], { DRINK: 'MILK' }, { DRINK: [''] }, { DRINK: Array.from({ length: 25 }, (_, i) => `K${i}`) }]) {
    expect((await saveBoardPreferences('local-p1', { relatedLists })).relatedLists).toEqual({})
  }
})

it('says each picture on tap and shows the section tabs unless a caregiver chooses one section', async () => {
  expect(DEFAULT_PREFERENCES).toMatchObject({ speakOnTap: true, section: 'all', sectionTabs: true })
  for (const section of ['all', 'core', 'food_drink', 'animals']) expect((await saveBoardPreferences('local-p1', { section })).section).toBe(section)
  for (const section of ['', 'kitchen', null, 3]) expect((await saveBoardPreferences('local-p1', { section })).section).toBe('all')
  expect((await saveBoardPreferences('local-p1', { sectionTabs: false })).sectionTabs).toBe(false)
  expect((await saveBoardPreferences('local-p1', { sectionTabs: 'yes' })).sectionTabs).toBe(true)
  // A child set up before tabs were the default keeps the board the caregiver saved.
  await db.settings.put({ key: 'appearance:local-p2', value: { ...DEFAULT_PREFERENCES, sectionTabs: false } })
  expect((await getBoardPreferences('local-p2')).sectionTabs).toBe(false)
})

it('shows each picture with its word unless a caregiver chooses pictures only', async () => {
  expect(DEFAULT_PREFERENCES.showLabels).toBe(true)
  expect((await saveBoardPreferences('local-p1', { showLabels: false })).showLabels).toBe(false)
  expect((await saveBoardPreferences('local-p1', { showLabels: 'no' })).showLabels).toBe(true)
})

it('turns pages with a swipe unless a caregiver switches swiping off', async () => {
  expect(DEFAULT_PREFERENCES.swipePages).toBe(true)
  expect((await saveBoardPreferences('local-p1', { swipePages: false })).swipePages).toBe(false)
  expect((await saveBoardPreferences('local-p1', { swipePages: 'off' })).swipePages).toBe(true)
})
