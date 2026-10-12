import { describe, expect, it, vi } from 'vitest'
import { createMessageSession } from '../src/message-session.js'

describe('message persistence', () => {
  it('keeps rapid taps in one draft in physical action order', async () => {
    const calls = []
    const storage = {
      startDraft: vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return 'draft-1' }),
      logAction: vi.fn(async (id, index, action, extra) => calls.push({ id, index, action, extra })),
      finaliseMessage: vi.fn(async () => {})
    }
    const session = createMessageSession(storage, 'P-01', 'static')
    const actions = [session.record('select', { symbol_key: 'I' }), session.record('select', { symbol_key: 'WANT' }), session.record('correct', { context: 'clear' }), session.record('select', { symbol_key: 'HELP' }), session.record('speak')]
    await Promise.all([...actions, session.finish()])
    expect(storage.startDraft).toHaveBeenCalledTimes(1)
    expect(calls.map(row => row.index)).toEqual([0, 1, 2, 3, 4])
    expect(calls.map(row => row.action)).toEqual(['select', 'select', 'correct', 'select', 'speak'])
    expect(calls.every(row => row.id === 'draft-1')).toBe(true)
    expect(storage.finaliseMessage).toHaveBeenCalledWith('draft-1', 5)
  })

  it('captures action time before queued writes and starts a fresh draft after completion', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const storage = { startDraft: vi.fn(async () => { await gate; return 'draft' }), logAction: vi.fn(async () => {}), finaliseMessage: vi.fn(async () => {}) }
    const session = createMessageSession(storage, 'demo', 'predictive')
    const ts = '2026-09-28T10:00:00.000Z'
    const action = session.record('select', { symbol_key: 'I', ts })
    release()
    await action
    expect(storage.startDraft).toHaveBeenCalledWith('demo', 'predictive', ts)
    expect(storage.logAction.mock.calls[0][3].ts).toBe(ts)
    await session.record('speak')
    await session.finish()
    await session.record('select', { symbol_key: 'YOU' })
    expect(storage.startDraft).toHaveBeenCalledTimes(2)
    expect(storage.logAction.mock.calls[2][1]).toBe(0)
  })

  it('does not finalise a message after any event failed to save', async () => {
    const storage = { startDraft: vi.fn(async () => 'draft'), logAction: vi.fn(async () => { throw new Error('Storage full') }), finaliseMessage: vi.fn(async () => {}) }
    const session = createMessageSession(storage, 'demo', 'static')
    await expect(session.record('select', { symbol_key: 'I' })).rejects.toThrow('Storage full')
    await expect(session.finish()).rejects.toThrow('Storage full')
    expect(storage.finaliseMessage).not.toHaveBeenCalled()
  })
})
