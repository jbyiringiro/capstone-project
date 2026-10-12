import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.jsx'
import Dashboard from './Dashboard.jsx'
import ParentAccess from './ParentAccess.jsx'
import { PARENT_IDLE_MS } from './parent-access.js'
import { benchPredictor } from './bench.js'
import { db, getVocabulary } from './db.js'
import { loadPredictor } from './predictor.js'
import { DEFAULT_APPEARANCE, getAppearance, saveAppearance } from './appearance.js'
import { getSpeechMode } from './audio-preferences.js'
import symbolsCsv from '../../vocab/symbols.csv?raw'

function parseSymbols(csv) {
  const [head, ...rows] = csv.trim().split(/\r?\n/)
  const cols = head.split(',')
  return rows.map(row => Object.fromEntries(row.split(',').map((value, i) => [cols[i], value])))
}

export default function App() {
  const symbols = useMemo(() => parseSymbols(symbolsCsv), [])
  const byKey = useMemo(() => Object.fromEntries(symbols.map(s => [s.symbol_id, s])), [symbols])
  const [view, setView] = useState('board')
  const [parentUnlocked, setParentUnlocked] = useState(false)
  const [caregiverTab, setCaregiverTab] = useState('children')
  const [mode, setMode] = useState('static')
  const [profile, setProfile] = useState(null)
  const [enabledKeys, setEnabledKeys] = useState(null)
  const [predictor, setPredictor] = useState(null)
  const [bench, setBench] = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE)
  const profileRef = useRef(null)
  const appearanceRef = useRef(DEFAULT_APPEARANCE)
  const closeParent = useCallback(() => { setParentUnlocked(false); setView('board') }, [])

  useEffect(() => {
    if (!parentUnlocked) return
    let timeout
    const renew = () => { clearTimeout(timeout); timeout = setTimeout(closeParent, PARENT_IDLE_MS) }
    const visibility = () => { if (document.hidden) closeParent() }
    renew()
    window.addEventListener('pointerdown', renew)
    window.addEventListener('keydown', renew)
    window.addEventListener('pagehide', closeParent)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('pointerdown', renew)
      window.removeEventListener('keydown', renew)
      window.removeEventListener('pagehide', closeParent)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [parentUnlocked, closeParent])

  useEffect(() => { loadPredictor().then(setPredictor).catch(() => setPredictor(null)) }, [])
  useEffect(() => {
    let current = true
    async function restore() {
      try {
        const [savedMode, savedProfile] = await Promise.all([db.settings.get('mode'), db.settings.get('profile'), getSpeechMode()])
        const selected = savedProfile?.value ?? null
        const [keys, savedAppearance] = await Promise.all([
          selected ? getVocabulary(selected.profile_id) : null,
          getAppearance(selected?.profile_id)
        ])
        if (!current) return
        setMode(savedMode?.value === 'predictive' ? 'predictive' : 'static')
        setProfile(selected)
        profileRef.current = selected
        setEnabledKeys(keys === null ? null : new Set(keys))
        setAppearance(savedAppearance)
        appearanceRef.current = savedAppearance
      } catch { if (current) setError('Ububiko bw’iki gikoresho ntibukora. Emerera mushakisha kubika amakuru, wongere ufungure porogaramu.') }
      finally { if (current) setReady(true) }
    }
    restore()
    return () => { current = false }
  }, [])

  async function selectProfile(next) {
    const [keys, nextAppearance] = await Promise.all([
      next ? getVocabulary(next.profile_id) : null,
      getAppearance(next?.profile_id)
    ])
    await db.settings.put({ key: 'profile', value: next })
    setProfile(next)
    profileRef.current = next
    setEnabledKeys(keys === null ? null : new Set(keys))
    setAppearance(nextAppearance)
    appearanceRef.current = nextAppearance
  }
  async function changeMode(next) {
    await db.settings.put({ key: 'mode', value: next })
    setMode(next)
  }
  function openCaregiver(tab = 'children') {
    setCaregiverTab(tab === 'audio' ? 'audio' : 'children')
    setParentUnlocked(false)
    setView('parent')
  }
  async function changeAppearance(patch) {
    const profileId = profileRef.current?.profile_id
    const next = await saveAppearance(profileId, { ...appearanceRef.current, ...patch })
    if (profileId === profileRef.current?.profile_id) {
      appearanceRef.current = next
      setAppearance(next)
    }
  }
  const allowed = useMemo(() => enabledKeys ?? new Set(symbols.map(s => s.symbol_id)), [enabledKeys, symbols])
  if (!ready) return <main className="loading" role="status">Vuga · Birimo gupakira…</main>
  if (error) return <main className="loading"><h1>Vuga</h1><p role="alert">{error}</p><button className="ghost" onClick={() => location.reload()}>Ongera ufungure</button></main>
  return <div className={`app-shell ${appearance.motion ? '' : 'no-motion'}`}>
    {/* Keep the message session mounted during a caregiver visit. Switching
        profile or board mode starts a separate session through the key. */}
    <div className="board-view" hidden={view !== 'board'}>
      <Board key={`${profile?.profile_id ?? 'demo'}:${mode}`} symbols={symbols} byKey={byKey}
        allowed={allowed} mode={mode} profileId={profile?.profile_id ?? 'demo'} profileCode={profile?.code ?? 'Igerageza'}
        predictor={predictor} appearance={appearance} visible={view === 'board'} onOpenAdult={openCaregiver} />
    </div>
    {view !== 'board' && !parentUnlocked && <ParentAccess onClose={closeParent} onUnlock={() => { setParentUnlocked(true); setView('dashboard') }} />}
    {view === 'dashboard' && parentUnlocked && <Dashboard initialTab={caregiverTab} symbols={symbols} byKey={byKey} onClose={closeParent}
      onSelectProfile={selectProfile} activeProfile={profile} mode={mode} setMode={changeMode}
      onVocabularySaved={keys => setEnabledKeys(new Set(keys))} predictor={predictor} bench={bench}
      appearance={appearance} setAppearance={changeAppearance}
      runBench={async () => setBench(await benchPredictor(predictor, [[], ['I'], ['I', 'WANT'], ['YOU', 'NOT'], ['I', 'WANT', 'EAT']]))} />}
  </div>
}
