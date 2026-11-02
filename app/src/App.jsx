import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Board from './board/Board.jsx'
import ChildBoard from './child/ChildBoard.jsx'
import ChildGame from './child/ChildGame.jsx'
import Dashboard from './caregiver/Dashboard.jsx'
import ParentAccess from './parent-access/ParentAccess.jsx'
import { useParentLock } from './parent-access/use-parent-lock.js'
import { benchPredictor, loadPredictor } from './prediction/index.js'
import { db } from './storage/db.js'
import { getVocabulary } from './storage/vocabulary.js'
import { DEFAULT_PREFERENCES, getBoardPreferences, saveBoardPreferences } from './storage/board-preferences.js'
import { getSpeechMode } from './storage/audio-preferences.js'
import { parseSymbols } from './symbols/catalogue.js'
import { placeVocabulary } from './symbols/environments.js'
import { saveToAccount } from './server/account-backup.js'
import { useSymbolCatalogue } from './symbols/use-symbol-catalogue.js'
import symbolsCsv from '../../vocab/symbols.csv?raw'

const BUNDLED_SYMBOLS = parseSymbols(symbolsCsv)
const BENCH_PREFIXES = [[], ['I'], ['I', 'WANT'], ['YOU', 'NOT'], ['I', 'WANT', 'EAT']]

export default function App() {
  const catalogue = useSymbolCatalogue(BUNDLED_SYMBOLS)
  const [view, setView] = useState('board')
  const [gameRounds, setGameRounds] = useState(5)
  const [parentUnlocked, setParentUnlocked] = useState(false)
  const [caregiverTab, setCaregiverTab] = useState('children')
  const [mode, setMode] = useState('static')
  const [profile, setProfile] = useState(null)
  const [enabledKeys, setEnabledKeys] = useState(null)
  const [predictor, setPredictor] = useState(null)
  const [bench, setBench] = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES)
  const profileRef = useRef(null)
  const preferencesRef = useRef(DEFAULT_PREFERENCES)
  // Leaving the caregiver area keeps the account copy up to date when the adult is signed in.
  const closeParent = useCallback(() => { setParentUnlocked(false); setView('board'); saveToAccount().catch(() => {}) }, [])
  useParentLock(parentUnlocked, closeParent)

  function applyProfile(next, keys, nextPreferences) {
    setProfile(next)
    profileRef.current = next
    setEnabledKeys(keys === null ? null : new Set(keys))
    setPreferences(nextPreferences)
    preferencesRef.current = nextPreferences
  }
  const loadProfile = next => Promise.all([next ? getVocabulary(next.profile_id) : null, getBoardPreferences(next?.profile_id)])
  // The board mode, the open child, their words and their settings as this device stores them.
  async function readDevice() {
    const [savedMode, savedProfile] = await Promise.all([db.settings.get('mode'), db.settings.get('profile'), getSpeechMode()])
    const selected = savedProfile?.value ?? null
    const [keys, savedPreferences] = await loadProfile(selected)
    return [savedMode?.value === 'predictive' ? 'predictive' : 'static', selected, keys, savedPreferences]
  }
  // After the account's copy came back onto this device.
  async function deviceRestored() {
    const [savedMode, selected, keys, savedPreferences] = await readDevice()
    setMode(savedMode)
    applyProfile(selected, keys, savedPreferences)
  }

  useEffect(() => { loadPredictor().then(setPredictor).catch(() => setPredictor(null)) }, [])
  useEffect(() => {
    let current = true
    async function restore() {
      try {
        const [savedMode, selected, keys, savedPreferences] = await readDevice()
        if (!current) return
        setMode(savedMode)
        applyProfile(selected, keys, savedPreferences)
      } catch { if (current) setError('Ububiko bw’iki gikoresho ntibukora. Emerera mushakisha kubika amakuru, wongere ufungure porogaramu.') }
      finally { if (current) setReady(true) }
    }
    restore()
    return () => { current = false }
  }, [])

  async function selectProfile(next) {
    const [keys, nextPreferences] = await loadProfile(next)
    await db.settings.put({ key: 'profile', value: next })
    applyProfile(next, keys, nextPreferences)
  }
  // Keys from the vocabulary tab, or a re-read after a custom word was added or deleted.
  async function vocabularyChanged(keys) {
    const profileId = profileRef.current?.profile_id
    const next = keys ?? (profileId ? await getVocabulary(profileId) : null)
    setEnabledKeys(next === null ? null : new Set(next))
  }
  async function changeMode(next) {
    await db.settings.put({ key: 'mode', value: next })
    setMode(next)
  }
  function openCaregiver(tab = 'children') {
    setCaregiverTab(['audio', 'child'].includes(tab) ? tab : 'children')
    setParentUnlocked(false)
    setView('parent')
  }
  async function changePreferences(patch) {
    const profileId = profileRef.current?.profile_id
    const next = await saveBoardPreferences(profileId, { ...preferencesRef.current, ...patch })
    if (profileId === profileRef.current?.profile_id) {
      preferencesRef.current = next
      setPreferences(next)
    }
  }
  // Starting the game leaves (and so locks) the caregiver area; the game returns to the board.
  function startGame(rounds) {
    setGameRounds(rounds)
    setParentUnlocked(false)
    setView('game')
  }
  // The child's own words, narrowed to the naming words for where they are when a caregiver chose a place.
  const allowed = useMemo(() => placeVocabulary(catalogue.symbols, enabledKeys ?? new Set(catalogue.keys), preferences.environment, preferences.environmentLists),
    [enabledKeys, catalogue, preferences.environment, preferences.environmentLists])
  if (!ready) return <main className="loading" role="status">Vuga · Birimo gupakira…</main>
  if (error) return <main className="loading"><h1>Vuga</h1><p role="alert">{error}</p><button className="ghost" onClick={() => location.reload()}>Ongera ufungure</button></main>
  return <div className={`app-shell ${preferences.motion ? '' : 'no-motion'}`}>
    {/* Keep the message session mounted during a caregiver visit. Switching
        profile or board mode starts a separate session through the key. */}
    <div className="board-view" hidden={view !== 'board'}>
      {preferences.childMode ? <ChildBoard key={profile?.profile_id ?? 'demo'} byKey={catalogue.byKey} profileId={profile?.profile_id ?? 'demo'}
        preferences={preferences} visible={view === 'board'} onOpenAdult={() => openCaregiver('child')} /> : <Board key={`${profile?.profile_id ?? 'demo'}:${mode}`} symbols={catalogue.symbols} byKey={catalogue.byKey}
        allowed={allowed} mode={mode} profileId={profile?.profile_id ?? 'demo'} profileCode={profile?.code ?? 'Igerageza'}
        predictor={predictor} preferences={preferences} visible={view === 'board'} onOpenAdult={openCaregiver} />}
    </div>
    {view === 'game' && <ChildGame byKey={catalogue.byKey} profileId={profile?.profile_id ?? 'demo'} preferences={preferences}
      rounds={gameRounds} onFinish={() => setView('board')} onOpenAdult={() => openCaregiver('child')} />}
    {(view === 'parent' || view === 'dashboard') && !parentUnlocked && <ParentAccess onClose={closeParent} onUnlock={() => { setParentUnlocked(true); setView('dashboard') }} />}
    {view === 'dashboard' && parentUnlocked && <Dashboard initialTab={caregiverTab} catalogue={catalogue} onClose={closeParent}
      onSelectProfile={selectProfile} onDeviceRestored={deviceRestored} activeProfile={profile} mode={mode} setMode={changeMode}
      onVocabularyChanged={vocabularyChanged} predictor={predictor} bench={bench}
      preferences={preferences} setPreferences={changePreferences} onStartGame={startGame}
      runBench={async () => setBench(await benchPredictor(predictor, BENCH_PREFIXES))} />}
  </div>
}
