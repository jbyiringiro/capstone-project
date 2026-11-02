import { useEffect, useMemo, useRef, useState } from 'react'
import HoldButton from '../board/HoldButton.jsx'
import { Icon } from '../shared/ui.jsx'
import { gameProgress, listGameSessions, saveGameSession, wordHistory } from '../storage/game-sessions.js'
import ChildCard from './ChildCard.jsx'
import Mascot from './Mascot.jsx'
import { childGridShape } from './child-boards.js'
import { FindGame } from './find-game.js'
import { useMediaQuery, useWordSpeaker } from './use-word-speaker.js'
import './child.css'

const NEXT_ROUND_MS = 1400

// The "Shakisha" game on the child's own board: Vuga says a word, the child finds its picture.
// Correct finds earn a star and a celebration; a miss gets a gentle wiggle, and after two misses
// the right picture glows. Results are saved for the caregiver; they are not messages.
export default function ChildGame({ byKey, profileId, preferences, rounds = 5, onFinish, onOpenAdult }) {
  const keys = useMemo(() => preferences.childBoard.filter(key => byKey[key]), [preferences.childBoard, byKey])
  const [columns, rows] = childGridShape(keys.length, useMediaQuery('(orientation: portrait)'))
  const speak = useWordSpeaker(byKey)
  const game = useRef(null)
  const startedAt = useRef(new Date().toISOString())
  const [state, setState] = useState({ target: null, round: 0, stars: 0 })
  const [effects, setEffects] = useState({ celebrate: null, wiggle: null, hint: false })
  const [mood, setMood] = useState('idle')
  const [busy, setBusy] = useState(true)
  const [summary, setSummary] = useState(null)
  const realistic = preferences.realisticImages !== false
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let current = true
    listGameSessions(profileId).catch(() => []).then(sessions => {
      if (!current) return
      // The caregiver can only start the game with two or more pictures; a board edited since
      // then simply returns to the child's board.
      if (new Set(keys).size < 2) { onFinish(); return }
      game.current = new FindGame(keys, { rounds, history: wordHistory(sessions) })
      showRound()
    })
    return () => { current = false; mounted.current = false }
  }, [])

  function showRound() {
    const { target, round, stars } = game.current
    setState({ target, round, stars })
    setEffects({ celebrate: null, wiggle: null, hint: false })
    setMood('thinking')
    setBusy(false)
    speak(target)
  }

  async function press(key) {
    if (busy || !game.current || game.current.finished) return
    const result = game.current.answer(key)
    if (!result.correct) {
      setEffects(previous => ({ ...previous, wiggle: { key, at: performance.now() }, hint: result.hint }))
      setMood('thinking')
      return
    }
    setBusy(true)
    setEffects({ celebrate: { key, at: performance.now() }, wiggle: null, hint: false })
    setState(previous => ({ ...previous, stars: game.current.stars }))
    setMood('cheer')
    await speak(key)
    setTimeout(async () => {
      if (!mounted.current) return
      if (!game.current.finished) { showRound(); return }
      await saveGameSession(profileId, startedAt.current, game.current.results).catch(() => {})
      const progress = gameProgress(await listGameSessions(profileId).catch(() => []))
      if (mounted.current) setSummary({ stars: game.current.stars, total: progress.totalStars })
    }, NEXT_ROUND_MS)
  }

  const target = state.target && byKey[state.target]
  return <div className={`child-board child-game ${preferences.motion === false ? 'no-motion' : ''}`}>
    <header className="child-top">
      <Mascot mood={mood} />
      <div className="child-bubble">
        {target && <button type="button" className="child-prompt" onClick={() => speak(state.target)} aria-label={`Ongera wumve: ${target.label_rw}`}>
          <Icon name="speaker" /><span>Shakisha: <b>{target.label_rw}</b></span>
        </button>}
        {effects.wiggle && !busy && <span className="child-game-note" role="status" key={effects.wiggle.at}>Ongera ugerageze</span>}
        <span className="child-progress" aria-label={`Inyenyeri ${state.stars} kuri ${rounds}`}>
          {Array.from({ length: rounds }, (_, i) => <i key={i} className={i < state.stars ? 'on' : ''}>★</i>)}
        </span>
      </div>
      <HoldButton className="child-caregiver" onHold={onOpenAdult} title="Umurezi: komeza ukande mu gihe cy'isegonda rimwe n'ibice bibiri." ariaLabel="Igenamiterere ry'umurezi">
        <Icon name="parent" />
      </HoldButton>
    </header>
    <main className="child-grid" style={{ '--cols': columns, '--rows': rows }} aria-label="Umukino wo gushakisha amashusho">
      {keys.map(key => <ChildCard key={key} symbol={byKey[key]} realistic={realistic} showLabel={preferences.showLabels !== false} onPress={press} disabled={!!summary}
        celebrate={effects.celebrate?.key === key ? effects.celebrate.at : 0}
        wiggle={effects.wiggle?.key === key ? effects.wiggle.at : 0}
        hint={effects.hint && key === state.target} />)}
    </main>
    {summary && <div className="child-finish" role="dialog" aria-labelledby="child-finish-title">
      <div className="child-finish-card">
        <Mascot mood="cheer" />
        <h2 id="child-finish-title">Wakoze neza!</h2>
        <p className="child-finish-stars" aria-label={`Inyenyeri ${summary.stars}`}>{Array.from({ length: summary.stars }, (_, i) => <i key={i}>★</i>)}</p>
        <p>Inyenyeri zawe zose: <b>{summary.total}</b></p>
        <button type="button" className="button-primary child-finish-button" onClick={onFinish}><Icon name="yes" />Komeza</button>
      </div>
    </div>}
  </div>
}
