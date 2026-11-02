import VoiceSettings from './VoiceSettings.jsx'
import AudioSettings from './AudioSettings.jsx'
import { Heading } from './components.jsx'

export default function SpeechTab({ symbols, preferences, initialKey }) {
  return <>
    <Heading eyebrow="Ijwi" title="Ha amashusho ijwi.">Gerageza amajwi cyangwa wongeremo amajwi y’Ikinyarwanda umwana amenyereye.</Heading>
    <VoiceSettings />
    <AudioSettings symbols={symbols} preferences={preferences} initialKey={initialKey} />
  </>
}
