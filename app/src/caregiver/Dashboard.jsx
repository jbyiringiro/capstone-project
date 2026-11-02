import { useEffect, useState } from 'react'
import { DEFAULT_PREFERENCES } from '../storage/board-preferences.js'
import { ParentPinSettings } from '../parent-access/ParentAccess.jsx'
import { Brand } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import BoardSettingsTab from './BoardSettingsTab.jsx'
import ChildModeTab from './ChildModeTab.jsx'
import ChildrenTab from './ChildrenTab.jsx'
import CustomWordsTab from './CustomWordsTab.jsx'
import EnvironmentTab from './EnvironmentTab.jsx'
import RelatedWordsTab from './RelatedWordsTab.jsx'
import SpeechTab from './SpeechTab.jsx'
import SummaryTab from './SummaryTab.jsx'
import SyncTab from './SyncTab.jsx'
import VocabularyTab from './VocabularyTab.jsx'
import './dashboard.css'

export const TABS = [
  { id: 'children', rw: 'Abana' },
  { id: 'vocab', rw: 'Amashusho' },
  { id: 'custom', rw: 'Amagambo mashya' },
  { id: 'place', rw: 'Aho umwana ari' },
  { id: 'board', rw: 'Ikibaho' },
  { id: 'related', rw: 'Amagambo akurikira' },
  { id: 'child', rw: 'Uburyo bw’umwana' },
  { id: 'audio', rw: 'Ijwi' },
  { id: 'summary', rw: 'Incamake' },
  { id: 'sync', rw: 'Ohereza' },
  { id: 'access', rw: 'Kwinjira' }
]

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}

// The caregiver area: navigation, shared error banner and the tab being shown. Each tab owns its
// own data loading and saving.
export default function Dashboard({ catalogue, onClose, onSelectProfile, onDeviceRestored, activeProfile, mode, setMode, onVocabularyChanged, predictor, bench, runBench, preferences = DEFAULT_PREFERENCES, setPreferences, onStartGame, initialTab = 'children' }) {
  const [tab, setTab] = useState(initialTab)
  const [audioKey, setAudioKey] = useState(null)
  const online = useOnline()
  const [error, setError] = useState(''), [working, setWorking] = useState(false)
  const { symbols, byKey } = catalogue
  async function select(profile) {
    setWorking(true); setError('')
    try { await onSelectProfile(profile); if (profile) setTab('vocab') }
    catch (e) { setError(userError(e)) }
    finally { setWorking(false) }
  }
  function navigate(next, { key = null } = {}) { setTab(next); setAudioKey(key); setError('') }
  return <div className={`dash ${preferences.motion ? '' : 'dash-still'}`}>
    <header className="app-header dash-header"><Brand onClick={onClose} disabled={working} />
      <div className="app-title"><b>Umubyeyi / Umurezi</b><small>Dufashe buri mwana kuvuga icyo ashaka.</small></div>
      <div className="header-actions"><span className="dash-device-status">{activeProfile?.code ?? 'Igerageza'} · {online ? 'Interineti irahari' : 'Nta interineti'}</span><button className="button-outline" onClick={onClose} disabled={working}>Subira ku kibaho</button></div>
    </header>
    <div className="dash-layout"><aside className="dash-sidebar"><p className="dash-eyebrow">Ahagenewe umurezi</p>
      <nav aria-label="Ibyiciro by’umurezi">{TABS.map(t => <button key={t.id} className={`dash-nav-button ${tab === t.id ? 'active' : ''}`} aria-current={tab === t.id ? 'page' : undefined} disabled={working} onClick={() => navigate(t.id)}><span>{t.rw}</span></button>)}</nav>
      <div className="dash-device-note"><b>Ikibaho umwana amenyereye, aho ari hose.</b><p>Imyirondoro n’amashusho bibikwa kuri iki gikoresho. Konti si ngombwa.</p></div>
    </aside><main className="dash-main" aria-label={TABS.find(t => t.id === tab)?.rw}>
      {error && <div className="dash-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Funga ubutumwa bw’ikibazo">×</button></div>}
      {tab === 'children' && <ChildrenTab symbols={symbols} byKey={byKey} activeProfile={activeProfile} onSelect={select} setError={setError} working={working} onNavigate={navigate} preferences={preferences} />}
      {tab === 'vocab' && <VocabularyTab symbols={symbols} byKey={byKey} activeProfile={activeProfile} setError={setError} setWorking={setWorking} onSaved={onVocabularyChanged} onNavigate={navigate} preferences={preferences} />}
      {tab === 'custom' && <CustomWordsTab catalogue={catalogue} activeProfile={activeProfile} setError={setError} setWorking={setWorking} onNavigate={navigate} onVocabularyChanged={onVocabularyChanged} />}
      {tab === 'board' && <BoardSettingsTab byKey={byKey} mode={mode} setMode={setMode} predictor={predictor} bench={bench} runBench={runBench} setError={setError} setWorking={setWorking} activeProfile={activeProfile} preferences={preferences} setPreferences={setPreferences} onClose={onClose} />}
      {tab === 'place' && <EnvironmentTab symbols={symbols} byKey={byKey} activeProfile={activeProfile} preferences={preferences} setPreferences={setPreferences} setError={setError} setWorking={setWorking} />}
      {tab === 'related' && <RelatedWordsTab symbols={symbols} byKey={byKey} activeProfile={activeProfile} preferences={preferences} setPreferences={setPreferences} setError={setError} setWorking={setWorking} />}
      {tab === 'child' && <ChildModeTab symbols={symbols} byKey={byKey} activeProfile={activeProfile} preferences={preferences} setPreferences={setPreferences} setError={setError} setWorking={setWorking} onStartGame={onStartGame} />}
      {tab === 'audio' && <SpeechTab symbols={symbols} preferences={preferences} initialKey={audioKey} />}
      {tab === 'summary' && <SummaryTab activeProfile={activeProfile} byKey={byKey} setError={setError} onClose={onClose} />}
      {tab === 'sync' && <SyncTab online={online} setError={setError} onDeviceRestored={onDeviceRestored} onNavigate={navigate} />}
      {tab === 'access' && <ParentPinSettings onDeviceRestored={onDeviceRestored} />}
    </main></div>
    <footer className="dash-footer"><p><b>Bibitswe kuri iki gikoresho.</b> Gusiba amakuru ya mushakisha bisiba ibibitswe kuri iki gikoresho. Banza ukuremo ubutumwa mbere yo guhindura igikoresho.</p><p>Porogaramu y’igerageza · Ururimi, amashusho n’amajwi biracyakeneye gusuzumwa n’abazabikoresha. Amafoto yaturutse kuri interineti kandi afite uruhushya rwo gukoreshwa. Abantu bari ku mafoto si abana bakoresha Vuga. Hitamo amashusho umwana yumva kandi amenyereye. <a href="/photos/credits.html" target="_blank" rel="noreferrer">Abafashe amafoto n’uburenganzira bwo kuyakoresha</a>.</p><p>Ibishushanyo bisanzwe ushobora guhitamo: Sergio Palao / Government of Aragon, <a href="https://arasaac.org" target="_blank" rel="noreferrer">ARASAAC</a>, <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>. <a href="/symbols/ATTRIBUTION.txt">Abakoze amashusho</a>.</p></footer>
  </div>
}
