import { useEffect, useMemo, useState } from 'react'
import Board from './Board.jsx'
import Dashboard from './Dashboard.jsx'
import { benchPredictor } from './bench.js'
import { db } from './db.js'
import { loadPredictor } from './predictor.js'
import symbolsCsv from '../../vocab/symbols.csv?raw'

function parseSymbols(csv) {
  const [head, ...rows] = csv.trim().split(/\r?\n/)
  const cols = head.split(',')
  return rows.map(r => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])))
}

export default function App() {
  const symbols = useMemo(() => parseSymbols(symbolsCsv), [])
  const byKey = useMemo(() => Object.fromEntries(symbols.map(s => [s.symbol_id, s])), [symbols])

  const [view, setView] = useState('board')
  const [mode, setMode] = useState('static')
  const [profile, setProfile] = useState(null)
  const [enabledKeys, setEnabledKeys] = useState(null)   // null = whole vocabulary
  const [predictor, setPredictor] = useState(null)
  const [bench, setBench] = useState(null)

  useEffect(() => { loadPredictor().then(setPredictor) }, [])
  useEffect(() => {
    db.settings.get('mode').then(m => m && setMode(m.value))
    db.settings.get('profile').then(p => p && setProfile(p.value))
  }, [])
  useEffect(() => { db.settings.put({ key: 'mode', value: mode }) }, [mode])
  useEffect(() => {
    db.settings.put({ key: 'profile', value: profile })
    if (!profile) { setEnabledKeys(null); return }
    db.vocabulary.where('profile_id').equals(profile.profile_id).toArray()
      .then(rows => setEnabledKeys(rows.length ? new Set(rows.map(r => r.key)) : null))
  }, [profile, view])

  const allowed = enabledKeys ?? new Set(symbols.map(s => s.symbol_id))

  if (view === 'dashboard') {
    return (
      <Dashboard
        symbols={symbols} byKey={byKey}
        onClose={() => setView('board')} onSelectProfile={setProfile} activeProfile={profile}
        mode={mode} setMode={setMode} predictor={predictor}
        bench={bench} runBench={async () => setBench(await benchPredictor(predictor, [[], ['I'], ['I', 'WANT'], ['YOU', 'NOT'], ['I', 'WANT', 'EAT']]))}
      />
    )
  }
  return (
    <Board
      symbols={symbols} byKey={byKey} allowed={allowed} mode={mode}
      profileId={profile?.profile_id ?? 'demo'} predictor={predictor}
      onOpenAdult={() => setView('dashboard')}
    />
  )
}
