import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioWarmer } from '../../src/speech/audio-warmer.js'

afterEach(() => { vi.useRealTimers() })

function fakeContext() {
  const context = {
    state: 'running', destination: {},
    createBuffer: vi.fn(() => ({})),
    createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn() })),
    resume: vi.fn(async () => { context.state = 'running' }),
    suspend: vi.fn(async () => { context.state = 'suspended' }),
    close: vi.fn(async () => { context.state = 'closed' })
  }
  return context
}
const now = task => { task(); return () => {} }

describe('audio output warm-up', () => {
  it('builds the context in idle time, never inside a tap, and plays one silent sample', () => {
    const tasks = []
    const context = fakeContext()
    const createContext = vi.fn(() => context)
    const warmer = new AudioWarmer({ createContext, schedule: task => { tasks.push(task); return () => {} } })
    warmer.touch()
    warmer.prepare()
    expect(createContext).not.toHaveBeenCalled()
    expect(tasks).toHaveLength(1)
    tasks[0]()
    expect(createContext).toHaveBeenCalledOnce()
    expect(context.createBufferSource).toHaveBeenCalledOnce()
    warmer.touch()
    expect(createContext).toHaveBeenCalledOnce()
    warmer.close()
    expect(context.close).toHaveBeenCalledOnce()
  })
  it('suspends after a minute without taps and resumes, then reopens the output, on the next tap', async () => {
    vi.useFakeTimers()
    const context = fakeContext()
    const warmer = new AudioWarmer({ createContext: () => context, schedule: now })
    warmer.prepare()
    vi.advanceTimersByTime(59_000)
    warmer.touch()
    vi.advanceTimersByTime(59_000)
    expect(context.suspend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    await Promise.resolve()
    expect(context.state).toBe('suspended')
    warmer.touch()
    expect(context.resume).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(context.createBufferSource).toHaveBeenCalledTimes(2))
    warmer.close()
  })
  it('cancels a pending preparation when the board closes, and can prepare again after remounting', () => {
    const cancel = vi.fn()
    const schedule = vi.fn(() => cancel)
    const warmer = new AudioWarmer({ schedule })
    warmer.prepare()
    warmer.close()
    expect(cancel).toHaveBeenCalledOnce()
    warmer.prepare()
    expect(schedule).toHaveBeenCalledTimes(2)
  })
  it('does nothing when the browser has no Web Audio', () => {
    const warmer = new AudioWarmer({ createContext: () => { throw new Error('unsupported') }, schedule: now })
    expect(() => { warmer.prepare(); warmer.touch() }).not.toThrow()
    expect(warmer.context).toBeNull()
  })
})
