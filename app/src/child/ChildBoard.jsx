import { useEffect, useRef, useState } from 'react'
import HoldButton from '../board/HoldButton.jsx'
import { Icon, SymbolArtwork } from '../shared/ui.jsx'
import ChildCard from './ChildCard.jsx'
import Mascot from './Mascot.jsx'
import { childGridShape } from './child-boards.js'
import { logChildWord } from './child-log.js'
import { useMediaQuery, useWordSpeaker } from './use-word-speaker.js'
import './child.css'

// A second tap on the same picture this soon is treated as a slip of the hand, common with
// tremor or limited motor control, rather than as saying the word twice.
const REPEAT_GUARD_MS = 600

// The child's screen in child mode: only the pictures the caregiver chose. Each tap says the word
// at once and shows it large, so the person nearby can read it too. Everything else, including
// leaving this screen, is behind the caregiver's long press and PIN.
export default function ChildBoard({ byKey, profileId, preferences, visible = true, onOpenAdult }) {
  const keys = preferences.childBoard.filter(key => byKey[key])
  const [columns, rows] = childGridShape(keys.length, useMediaQuery('(orientation: portrait)'))
  const [last, setLast] = useState(null)
  const [mood, setMood] = useState('idle')
  const lastTap = useRef({ key: null, at: -Infinity })
  const speak = useWordSpeaker(byKey)
  const realistic = preferences.realisticImages !== false
  useEffect(() => {
    if (mood !== 'happy') return
    const timer = setTimeout(() => setMood('idle'), 1500)
    return () => clearTimeout(timer)
  }, [mood])

  async function press(key) {
    const now = performance.now()
    if (lastTap.current.key === key && now - lastTap.current.at < REPEAT_GUARD_MS) return
    lastTap.current = { key, at: now }
    setLast({ key, at: now })
    setMood('speaking')
    logChildWord(profileId, key).catch(() => {})
    await speak(key)
    if (lastTap.current.at === now) setMood('happy')
  }

  const symbol = last && byKey[last.key]
  return <div className={`child-board ${preferences.motion === false ? 'no-motion' : ''}`} hidden={!visible}>
    <header className="child-top">
      <Mascot mood={mood} />
      <div className="child-bubble" aria-live="polite">
        {symbol ? <span className="child-bubble-word" key={last.at}><SymbolArtwork symbol={symbol} realistic={realistic} /><b>{symbol.label_rw}</b></span>
          : <span className="child-bubble-hint">Kanda ku ishusho!</span>}
      </div>
      <HoldButton className="child-caregiver" onHold={onOpenAdult} disabled={!visible}
        title="Umurezi: komeza ukande mu gihe cy'isegonda rimwe n'ibice bibiri." ariaLabel="Igenamiterere ry'umurezi">
        <Icon name="parent" />
      </HoldButton>
    </header>
    <main className="child-grid" style={{ '--cols': columns, '--rows': rows }} aria-label="Amashusho yanjye">
      {keys.map(key => <ChildCard key={key} symbol={byKey[key]} realistic={realistic} showLabel={preferences.showLabels !== false} onPress={press}
        pulse={last?.key === key ? last.at : 0} />)}
      {!keys.length && <p className="child-empty">Umurezi azaguhitiramo amashusho.</p>}
    </main>
  </div>
}
