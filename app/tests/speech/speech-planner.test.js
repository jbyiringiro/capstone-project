import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioSource, ClipSource, GeneratedClipSource, InstalledClipSource, SpeechPlanner, SystemVoiceSource, prepareSpeech } from '../../src/speech/index.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

class Fixed extends AudioSource {
  constructor(parts) { super(); this.parts = parts; this.calls = [] }
  async resolve(key) { this.calls.push(key); return this.parts[key] ?? null }
}

describe('speech source chain', () => {
  it('asks each source in order and stops at the first that can speak the word', async () => {
    const first = new Fixed({ I: { blob: 'mine' } }), second = new Fixed({ I: { blob: 'other' }, WATER: { blob: 'clip' } })
    const parts = await new SpeechPlanner([first, second]).plan(['I', 'WATER'], {}, undefined)
    expect(parts).toEqual([{ blob: 'mine' }, { blob: 'clip' }])
    expect(first.calls).toEqual(['I', 'WATER'])
    expect(second.calls).toEqual(['WATER'])
  })
  it('reports the first word nobody can speak, by its Kinyarwanda label', async () => {
    const planner = new SpeechPlanner([new Fixed({ I: { blob: 'mine' } })])
    await expect(planner.plan(['I', 'TOILET'], { TOILET: { label_rw: 'umusarani' } })).rejects.toThrow('umusarani')
  })
  it('plays a sentence word’s generated clip, and its pictures’ own words when that clip is missing', async () => {
    const words = new Fixed({ I: { blob: 'njye' }, WANT: { blob: 'gushaka' }, WATER: { blob: 'amazi' } })
    const generated = new Fixed({ ndashaka: { blob: 'ndashaka' } })
    const planner = new SpeechPlanner([words], generated)
    const sentence = [{ keys: ['I', 'WANT'], clip: 'ndashaka' }, { keys: ['WATER'] }]
    expect(await planner.plan(sentence, {})).toEqual([{ blob: 'ndashaka' }, { blob: 'amazi' }])
    expect(await planner.plan([{ keys: ['I', 'WANT'], clip: 'nshaka' }], {})).toEqual([{ blob: 'njye' }, { blob: 'gushaka' }])
    expect(words.calls).toEqual(['WATER', 'I', 'WANT'])
  })
  it('fetches generated clips as MP3 by name', async () => {
    const fetch = vi.fn(async () => new Response(new Blob(['mp3']), { headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetch)
    expect((await new GeneratedClipSource().resolve('uri_he')).blob.size).toBe(3)
    expect(fetch.mock.calls[0][0]).toBe('/audio/rw/forms/uri_he.mp3')
    fetch.mockImplementationOnce(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))
    expect(await new GeneratedClipSource().resolve('missing')).toBeNull()
  })
  it('requires concrete sources to implement resolve', async () => {
    await expect(new AudioSource().resolve('I')).rejects.toThrow('must implement resolve')
  })
  it('never requests packaged clips for a caregiver’s custom word', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await new ClipSource('/audio/rw').resolve('CUSTOM-1', { custom: true, label_rw: 'nyogokuru' })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requests an installed clip only when installed.json lists it, reading the list once', async () => {
    const fetch = vi.fn(async path => path === '/audio/installed.json'
      ? Response.json({ clips: ['WATER'] })
      : new Response('reviewed-clip', { headers: { 'content-type': 'audio/wav' } }))
    vi.stubGlobal('fetch', fetch)
    const installed = new InstalledClipSource('/audio')
    expect(await installed.resolve('I', { label_rw: 'njye' })).toBeNull()
    expect(await (await installed.resolve('WATER', { label_rw: 'amazi' })).blob.text()).toBe('reviewed-clip')
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/audio/installed.json', '/audio/WATER.wav'])
  })
  it('treats a missing or non-JSON installed.json as an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } })))
    expect(await new InstalledClipSource('/audio').resolve('WATER', { label_rw: 'amazi' })).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await new InstalledClipSource('/audio').resolve('WATER', { label_rw: 'amazi' })).toBeNull()
  })
  it('loads device voices once for a whole message', async () => {
    const load = vi.fn(async () => [{ lang: 'rw-RW' }])
    const voice = new SystemVoiceSource(load)
    const parts = await new SpeechPlanner([voice]).plan(['I', 'WANT'], { I: { label_rw: 'njye' }, WANT: { label_rw: 'ndashaka' } })
    expect(parts.map(part => part.text)).toEqual(['njye', 'ndashaka'])
    expect(load).toHaveBeenCalledOnce()
  })
  it('speaks a custom word from its recording, then from a Kinyarwanda device voice', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'rw-RW' }] })
    const byKey = { 'CUSTOM-1': { custom: true, label_rw: 'nyogokuru' } }
    const blob = new Blob(['grandmother'], { type: 'audio/webm' })
    expect(await prepareSpeech(['CUSTOM-1'], byKey, async () => blob)).toEqual([{ blob }])
    expect(await prepareSpeech(['CUSTOM-1'], byKey, async () => null)).toEqual([{ text: 'nyogokuru', voice: { lang: 'rw-RW' } }])
    expect(fetch).not.toHaveBeenCalled()
  })
})
