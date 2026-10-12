import { afterEach, describe, expect, it, vi } from 'vitest'
import { kinyarwandaVoice, loadVoices, playSpeechPart, prepareSpeech } from '../src/speech.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Kinyarwanda playback preparation', () => {
  it('never uses an arbitrary browser voice for Kinyarwanda text', () => {
    expect(kinyarwandaVoice([{ lang: 'en-US' }, { lang: 'fr-FR' }])).toBeNull()
    const rw = { lang: 'rw-RW' }
    expect(kinyarwandaVoice([{ lang: 'en-US' }, rw])).toBe(rw)
  })
  it('uses the local recording without requesting a packaged clip', async () => {
    const blob = new Blob(['audio'], { type: 'audio/wav' })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const parts = await prepareSpeech(['I'], { I: { label_rw: 'njye' } }, async () => blob)
    expect(parts).toEqual([{ blob }])
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects HTML fallback pages and keeps unavailable speech out of completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } })))
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'en-US' }] })
    await expect(prepareSpeech(['I'], { I: { label_rw: 'njye' } }, async () => null)).rejects.toThrow('Ijwi ry’Ikinyarwanda')
  })
  it('cancels a pending clip request instead of falling through to a device voice', async () => {
    const controller = new AbortController()
    const fetch = vi.fn((_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'rw-RW' }] })
    const result = expect(prepareSpeech(['I'], { I: { label_rw: 'njye' } }, async () => null, controller.signal))
      .rejects.toThrow('Ijwi ryahagaritswe')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
    controller.abort()
    await result
  })
})

describe('Available audio and playback', () => {
  it('waits for voiceschanged before concluding that device voices are missing', async () => {
    const synth = new EventTarget()
    let voices = []
    synth.getVoices = () => voices
    vi.stubGlobal('speechSynthesis', synth)
    const pending = loadVoices(undefined, 100)
    voices = [{ lang: 'rw-RW', name: 'Kinyarwanda' }]
    synth.dispatchEvent(new Event('voiceschanged'))
    expect(await pending).toBe(voices)
  })
  it('can stop while the voice service is still loading', async () => {
    const synth = new EventTarget()
    synth.getVoices = () => []
    vi.stubGlobal('speechSynthesis', synth)
    const controller = new AbortController()
    const pending = expect(loadVoices(controller.signal)).rejects.toThrow('Ijwi ryahagaritswe')
    controller.abort()
    await pending
  })
  it('uses bundled Kinyarwanda clips without requiring a browser voice', async () => {
    const fetch = vi.fn(async path => path.startsWith('/audio/rw/')
      ? new Response('kinyarwanda-audio', { headers: { 'content-type': 'audio/wav' } })
      : new Response('missing', { status: 404 }))
    const local = vi.fn(async () => null)
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [] })
    const parts = await prepareSpeech(['WATER'], { WATER: { label_rw: 'amazi', label_en: 'water' } }, local)
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/audio/WATER.wav', '/audio/rw/WATER.wav'])
    expect(local).toHaveBeenCalledWith('WATER')
    expect(await parts[0].blob.text()).toBe('kinyarwanda-audio')
  })
  it('uses only Kinyarwanda text and a matching voice even with a legacy English argument', async () => {
    const english = { lang: 'en-US', localService: true }
    const rw = { lang: 'rw-RW', localService: true }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })))
    vi.stubGlobal('speechSynthesis', { getVoices: () => [english, rw] })
    const parts = await prepareSpeech(['WATER'], { WATER: { label_rw: 'amazi', label_en: 'water' } }, async () => null, undefined, 'english-demo')
    expect(parts).toEqual([{ text: 'amazi', voice: rw }])
  })
  it('cannot fall back to English when no Kinyarwanda audio exists', async () => {
    const fetch = vi.fn(async () => new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'en-US' }] })
    await expect(prepareSpeech(['WATER'], { WATER: { label_rw: 'amazi', label_en: 'water' } }, async () => null, undefined, 'english-demo')).rejects.toMatchObject({ localized: true })
    expect(fetch.mock.calls.every(([path]) => !path.includes('en-demo'))).toBe(true)
  })
  it('does not treat a rejected play request as successful audio', async () => {
    vi.stubGlobal('Audio', class { play() { return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })) } pause() {} })
    await expect(playSpeechPart({ blob: new Blob(['clip']) })).rejects.toThrow('Mushakisha yahagaritse ijwi')
  })
  it('stops actual media playback and releases its object URL on cancellation', async () => {
    let media
    vi.stubGlobal('Audio', class { constructor() { media = this; this.pause = vi.fn() } play() { return Promise.resolve() } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const controller = new AbortController()
    const pending = expect(playSpeechPart({ blob: new Blob(['clip']) }, controller.signal)).rejects.toThrow('Ijwi ryahagaritswe')
    controller.abort()
    await pending
    expect(media.pause).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledOnce()
    expect(media.onended).toBeNull()
  })
  it('resolves playback only when the media emits ended', async () => {
    let media
    vi.stubGlobal('Audio', class { constructor() { media = this } play() { return Promise.resolve() } pause() {} })
    const finished = vi.fn()
    const pending = playSpeechPart({ blob: new Blob(['clip']) }).then(finished)
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    media.onended()
    await pending
    expect(finished).toHaveBeenCalledOnce()
  })
})
