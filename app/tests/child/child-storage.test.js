import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/storage/db.js'
import { DEFAULT_PREFERENCES, getBoardPreferences, saveBoardPreferences } from '../../src/storage/board-preferences.js'
import { SyncState, countPendingUploads, getLocalSummary } from '../../src/storage/messages.js'
import { gameProgress, listGameSessions, saveGameSession, wordHistory } from '../../src/storage/game-sessions.js'
import { logChildWord } from '../../src/child/child-log.js'

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })

describe('child mode storage', () => {
  it('keeps a valid chosen board per profile and refuses malformed boards', async () => {
    await saveBoardPreferences('local-a', { ...DEFAULT_PREFERENCES, childMode: true, childPreset: 'custom', childBoard: ['WATER', 'CUSTOM-1A2B3C4D'] })
    expect(await getBoardPreferences('local-a')).toMatchObject({ childMode: true, childPreset: 'custom', childBoard: ['WATER', 'CUSTOM-1A2B3C4D'] })
    expect((await getBoardPreferences('local-b')).childMode).toBe(false)
    for (const childBoard of [[], ['WATER', 'WATER'], Array.from({ length: 13 }, (_, i) => `W${i}`), 'WATER', [3]]) {
      expect((await saveBoardPreferences('local-a', { childBoard })).childBoard).toEqual(DEFAULT_PREFERENCES.childBoard)
    }
    expect((await saveBoardPreferences('local-a', { childPreset: 'nowhere' })).childPreset).toBe('essentials')
  })
  it('logs each child-mode tap as a one-word message that stays on the device', async () => {
    await logChildWord('local-a', 'WATER', '2026-10-23T09:00:00.000Z')
    await logChildWord('local-a', 'WATER', '2026-10-23T09:00:05.000Z')
    await logChildWord('local-a', 'EAT', '2026-10-23T09:00:09.000Z')
    const messages = await db.messages.toArray()
    expect(messages).toHaveLength(3)
    expect(messages.every(m => m.board_mode === 'child' && m.synced === SyncState.DEVICE_ONLY && m.tap_count === 2)).toBe(true)
    expect(await countPendingUploads()).toBe(0)
    const summary = await getLocalSummary('local-a')
    expect(summary.by_board_mode.child.messages).toBe(3)
    expect(summary.symbol_frequency).toEqual({ WATER: 2, EAT: 1 })
  })
  it('summarises game progress and the words that need practice', async () => {
    await saveGameSession('local-a', '2026-10-23T09:00:00.000Z', [{ target: 'WATER', misses: 2, hinted: true }, { target: 'EAT', misses: 0, hinted: false }])
    await saveGameSession('local-a', '2026-10-23T10:00:00.000Z', [{ target: 'WATER', misses: 1, hinted: false }, { target: 'PLAY', misses: 0, hinted: false }])
    await saveGameSession('local-b', '2026-10-23T10:00:00.000Z', [{ target: 'NO', misses: 3, hinted: true }])
    const sessions = await listGameSessions('local-a')
    expect(sessions).toHaveLength(2)
    expect(wordHistory(sessions)).toEqual({ WATER: { asked: 2, firstTry: 0 }, EAT: { asked: 1, firstTry: 1 }, PLAY: { asked: 1, firstTry: 1 } })
    const progress = gameProgress(sessions)
    expect(progress.totalStars).toBe(4)
    expect(progress.practice).toEqual([{ key: 'WATER', asked: 2, firstTry: 0 }])
    expect(progress.games[0]).toMatchObject({ stars: 2, firstTry: 1, hints: 0 })
  })
})
