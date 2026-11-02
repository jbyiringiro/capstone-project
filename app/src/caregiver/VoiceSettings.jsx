import { useEffect, useRef, useState } from 'react'
import { loadVoices, kinyarwandaVoice, playSpeechPart, prepareSpeech } from './speech.js'
import { getRecording } from './db.js'
import { localizedError, userError } from './errors-rw.js'
import { Icon } from './ui.jsx'
import './voice-settings.css'

export default function VoiceSettings() {
  const [testing, setTesting] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [hasDeviceVoice, setHasDeviceVoice] = useState(null)
  const playback = useRef(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const update = () => {
      if (mounted.current) setHasDeviceVoice(Boolean(kinyarwandaVoice(globalThis.speechSynthesis?.getVoices() ?? [])))
    }
    loadVoices(controller.signal).then(update).catch(() => {})
    globalThis.speechSynthesis?.addEventListener('voiceschanged', update)
    return () => {
      mounted.current = false
      controller.abort()
      playback.current?.abort()
      globalThis.speechSynthesis?.removeEventListener('voiceschanged', update)
    }
  }, [])

  async function test(kind) {
    if (playback.current) return
    const controller = new AbortController()
    playback.current = controller
    setTesting(kind); setError(''); setStatus('')
    try {
      let parts
      if (kind === 'word') {
        parts = await prepareSpeech(['WATER'], { WATER: { label_rw: 'amazi' } }, getRecording, controller.signal)
      } else {
        const response = await fetch('/audio/speaker-test.wav', { signal: controller.signal })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
          throw localizedError('Ijwi ryo kugerageza indangururamajwi ntiryafungutse. Ongera ugerageze.')
        }
        const blob = await response.blob()
        if (!blob.size) throw localizedError('Ijwi ryo kugerageza indangururamajwi ntiryafungutse. Ongera ugerageze.')
        parts = [{ blob }]
      }
      for (const part of parts) await playSpeechPart(part, controller.signal)
      if (mounted.current) setStatus(kind === 'word'
        ? 'Ijambo “amazi” rirangiye. Niba utaryumvise, genzura ko amajwi y’iki gikoresho n’ay’uru rubuga afunguye.'
        : 'Ijwi ryo kugerageza rirangiye. Niba utaryumvise, genzura indangururamajwi n’uko amajwi y’iki gikoresho afunguye.')
    } catch (cause) {
      if (mounted.current) {
        if (controller.signal.aborted) setStatus('Ijwi ryarahagaze.')
        else setError(userError(cause, 'Ijwi ntiryumvikanye. Genzura indangururamajwi, wongere ugerageze.'))
      }
    } finally {
      if (playback.current === controller) playback.current = null
      if (mounted.current) setTesting(null)
    }
  }

  return <section className="dash-card voice-settings" aria-labelledby="voice-settings-title">
    <h2 id="voice-settings-title"><Icon name="speaker" />Ijwi ry’Ikinyarwanda</h2>
    <p>Vuga ivuga amagambo mu Kinyarwanda. Ijwi ryawe wabikiye ijambo rikoreshwa mbere y’ijwi rizananye na Vuga. Igihe ayo majwi adahari, hakoreshwa ijwi ry’Ikinyarwanda riri kuri iki gikoresho, iyo ribonetse.</p>
    <p>Amajwi azananye na Vuga yakozwe na mudasobwa ikoresheje <a href="https://huggingface.co/facebook/mms-tts-kin" target="_blank" rel="noreferrer">Meta MMS</a>. Aracyakeneye gusuzumwa n’umuntu uzi Ikinyarwanda. Ushobora kuyasimbuza amajwi yawe. Aya majwi atangwa ku ruhushya rwa <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">CC BY-NC 4.0</a>, mu bikorwa bitagamije ubucuruzi.</p>
    <p className="voice-availability">{hasDeviceVoice === null ? 'Amajwi y’iki gikoresho aragenzurwa…' : hasDeviceVoice ? 'Iki gikoresho gifite ijwi ry’Ikinyarwanda.' : 'Nta jwi ry’Ikinyarwanda ryabonetse mu majwi y’iki gikoresho. Amajwi yabitswe muri Vuga aracyakora.'}</p>
    <div className="voice-test-options">
      <div><button type="button" className="button-primary" onClick={() => testing === 'word' ? playback.current?.abort() : test('word')} disabled={testing !== null && testing !== 'word'}><Icon name={testing === 'word' ? 'stop' : 'speaker'} />{testing === 'word' ? 'Hagarika ijambo' : 'Umva “amazi”'}</button><small className="voice-test-help">Gerageza uko ijambo rivugwa mu Kinyarwanda.</small></div>
      <div><button type="button" className="button-outline" onClick={() => testing === 'tone' ? playback.current?.abort() : test('tone')} disabled={testing !== null && testing !== 'tone'}><Icon name={testing === 'tone' ? 'stop' : 'speaker'} />{testing === 'tone' ? 'Hagarika kugerageza' : 'Gerageza indangururamajwi'}</button><small className="voice-test-help">Ijwi rigufi ritagira amagambo rigufasha kugenzura indangururamajwi.</small></div>
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {status && <p className="voice-test-status" role="status">{status}</p>}
  </section>
}
