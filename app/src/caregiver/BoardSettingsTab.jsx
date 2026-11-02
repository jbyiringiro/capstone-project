import { useState } from 'react'
import { GRID_OPTIONS, GRID_SIZES } from '../storage/board-preferences.js'
import { CATEGORIES, CATEGORY_ORDER } from '../symbols/categories.js'
import { sectionName } from '../board/sections.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { userError } from '../shared/errors-rw.js'
import { Heading, Setting } from './components.jsx'
import { useSerialTask } from './use-serial-task.js'
import './board-settings.css'

// The one section the child's board shows. The child has no tabs to change it; the caregiver
// chooses the section the moment calls for, or every picture in pages.
function SectionPicker({ value, byKey, realistic, disabled, onChange }) {
  return <fieldset className="dash-grid-size" disabled={disabled} aria-describedby="section-description">
    <legend><b>Icyiciro umwana abona</b></legend>
    <p id="section-description">Ikibaho cy’umwana nta tubuto tw’ibyiciro gifite. «Amashusho yose» yerekana amashusho yose ku mpapuro, buri shusho ahantu hayo. Hitamo icyiciro kimwe igihe bikenewe, nka «Ingenzi» ku magambo ya buri munsi.</p>
    <div className="dash-grid-options dash-section-options">{[...CATEGORY_ORDER, 'all'].map(option => {
      const symbol = byKey[CATEGORIES[option]?.symbol]
      return <label key={option} className={value === option ? 'active' : ''}>
        <input type="radio" name="board-section" checked={value === option} onChange={() => onChange(option)} />
        {symbol && <SymbolArtwork symbol={symbol} realistic={realistic} />}
        <b>{sectionName(option)}</b>
      </label>
    })}</div>
  </fieldset>
}

function GridSizePicker({ value, disabled, onChange }) {
  return <fieldset className="dash-grid-size" disabled={disabled} aria-describedby="grid-size-description">
    <legend><b>Amashusho agaragara icyarimwe</b></legend>
    <p id="grid-size-description">«Byikora» ishyira ku kibaho amashusho menshi ashoboka akaguma manini: telefoni yerekana make, tablet ikerekana menshi. Umubare uhamye utuma buri shusho iguma ahantu hamwe ku gikoresho icyo ari cyo cyose. Iyo amashusho y’icyiciro arenze urupapuro, umwana akoresha utubuto tw’impapuro.</p>
    <div className="dash-grid-options">{GRID_OPTIONS.map(option => {
      const [columns, rows] = GRID_SIZES[option] ?? []
      return <label key={option} className={value === option ? 'active' : ''}>
        <input type="radio" name="grid-size" checked={value === option} onChange={() => onChange(option)} />
        <b>{option === 'auto' ? 'Byikora' : option}</b>
        <small>{option === 'auto' ? 'Bihuza n’igikoresho' : `${columns} × ${rows}`}</small>
      </label>
    })}</div>
  </fieldset>
}

export default function BoardSettingsTab({ byKey, mode, setMode, predictor, bench, runBench, setError, setWorking, activeProfile, preferences, setPreferences, onClose }) {
  const [running, setRunning] = useState(false), [status, setStatus] = useState('')
  const [busy, run] = useSerialTask(setError, setWorking)
  async function change(task) {
    const result = await run(async () => { setStatus('Birimo kubikwa…'); await task() })
    if (result !== 'ignored') setStatus(result === 'done' ? 'Ibyatoranyijwe byabitswe kuri iki gikoresho' : 'Ibyatoranyijwe ntibyashoboye kubikwa')
  }
  const update = patch => change(() => setPreferences(patch))
  async function benchmark() { setRunning(true); setError(''); try { await runBench() } catch (e) { setError(userError(e)) } finally { setRunning(false) } }
  const fixedGrid = preferences.gridSize !== 'auto'
  return <><Heading eyebrow={`Ikibaho · ${activeProfile?.code ?? 'Igerageza'}`} title="Ikibaho cyorohereza umwana kuvuga.">Hitamo uko ikibaho kigaragara kugira ngo cyorohere umwana kureba no gukoraho. Hindura ikintu kimwe icyarimwe, mugeragereze hamwe.</Heading>
    <div className="dash-settings-card"><SectionPicker value={preferences.section} byKey={byKey} realistic={preferences.realisticImages !== false} disabled={busy || preferences.sectionTabs} onChange={section => update({ section })} />
      <Setting id="section-tabs" title="Ibyiciro ku kibaho cy’umwana" checked={preferences.sectionTabs} disabled={busy} onChange={sectionTabs => update({ sectionTabs })}>Bifunguye, utubuto tw’ibyiciro tugaruka hejuru y’amashusho, umwana akihitiramo icyiciro. Bikenewe mu bushakashatsi ubutumwa bukoresha amagambo yo mu byiciro byinshi. Bifunze, abona icyiciro wahisemo gusa.</Setting>
      <Setting id="show-labels" title="Amagambo ku mashusho" checked={preferences.showLabels} disabled={busy} onChange={showLabels => update({ showLabels })}>Bifunguye, buri shusho yandikwaho ijambo ryayo hejuru. Bifunze, umwana abona amashusho gusa, kandi aba manini kurushaho. Iyo akanze ku ishusho, ijambo riracyavugwa.</Setting>
      <Setting id="word-suggestions" title="Amagambo afasha" checked={mode === 'predictive'} disabled={busy || (!predictor && mode !== 'predictive')} onChange={checked => change(() => setMode(checked ? 'predictive' : 'static'))}>Amagambo atatu afasha umwana agaragara hejuru y’ikibaho. Amashusho asanzwe aguma mu myanya yayo. Guhindura ibi bitangira ubutumwa bushya. {!predictor && 'Uburyo bwo gutanga amagambo afasha ntiburaboneka.'}</Setting>
      <Setting id="personal-suggestions" title="Amagambo umwana akunze gukoresha" checked={preferences.personalSuggestions} disabled={busy || mode !== 'predictive'} onChange={personalSuggestions => update({ personalSuggestions })}>Amagambo afasha ashyira imbere ayo uyu mwana akunze guhitamo, ayo aherutse gukoresha n’ayo akunze gukoresha akurikiranye. Bibarwa kuri iki gikoresho gusa, bivuye ku butumwa yavuze akoresheje amagambo afasha. {mode !== 'predictive' && 'Banza ufungure amagambo afasha.'}</Setting>
      <GridSizePicker value={preferences.gridSize} disabled={busy} onChange={gridSize => update({ gridSize })} />
      <Setting id="swipe-pages" title="Hindura urupapuro unyuza urutoki" checked={preferences.swipePages} disabled={busy} onChange={swipePages => update({ swipePages })}>Kunyuza urutoki ku mashusho ugana ibumoso bifungura urupapuro rukurikira; ugana iburyo bigarura urubanziriza. Utubuto tw’impapuro turacyakora. Bihagarike niba umwana ahindura impapuro atabishaka.</Setting>
      <Setting id="sentence-speech" title="Vuga interuro yuzuye" checked={preferences.sentenceSpeech} disabled={busy} onChange={sentenceSpeech => update({ sentenceSpeech })}>Vuga ihuza amashusho ikavuga interuro y’Ikinyarwanda: njye + gushaka + amazi bivugwa ngo «Ndashaka amazi». Bihagarike kugira ngo buri shusho ivugwe ukwayo.</Setting>
      <Setting id="speak-on-tap" title="Vuga buri shusho ikimara gukandwaho" checked={preferences.speakOnTap} disabled={busy} onChange={speakOnTap => update({ speakOnTap })}>Buri shusho ivugwa ako kanya umwana ayikozeho: kumva ijambo bimufasha kumenya aho riri. Vuga ikomeza kuvuga ubutumwa bwose.</Setting>
      <Setting id="gentle-motion" title="Amashusho anyeganyega buhoro" checked={preferences.motion} disabled={busy} onChange={motion => update({ motion })}>Kunyeganyega gake kw’ishusho byerekana ko yatoranyijwe. Bihagarike niba ushaka ikibaho kidanyeganyega.</Setting>
      <Setting id="large-tiles" title="Amashusho manini cyane" checked={preferences.largeTiles} disabled={busy || fixedGrid} onChange={largeTiles => update({ largeTiles })}>Iyo ikibaho kiri kuri «Byikora», shyira amashusho make kandi manini kuri ecran, kugira ngo yorohe kureba no gukoraho. {fixedGrid && 'Iyo wahisemo umubare w’amashusho ku rupapuro, ingano yayo ihita ihinduka.'}</Setting>
      <Setting id="realistic-images" title="Amafoto afatika" checked={preferences.realisticImages} disabled={busy} onChange={realisticImages => update({ realisticImages })}>Koresha amafoto yo kuri interineti afite uruhushya rwo gukoreshwa. Bihagarike kugira ngo ukoreshe ibishushanyo bisanzwe. Murebere hamwe niba umwana ayumva.</Setting></div>
    <p className="dash-save-note" role="status">{status || 'Uko ikibaho kigaragara bibikwa kuri uyu mwirondoro. Niba igikoresho cyashyizweho kutanyeganyeza amashusho, hano na ho ntanyeganyega.'}</p>
    <div className="dash-audio-note"><div><h2>Koresha ijwi umwana amenyereye.</h2><p>Kuvuga bisaba amajwi y’Ikinyarwanda yagenzuwe cyangwa ijwi ry’Ikinyarwanda riri kuri iki gikoresho. Kanda Erekana kugira ngo werekane ubutumwa nta jwi.</p></div></div>
    <details className="dash-benchmark"><summary>Umuvuduko wo gutanga amagambo afasha</summary><p>Pima igihe porogaramu imara itanga igisubizo. Iyi mibare ntipima iterambere ry’umwana mu kuvuga.</p><button className="button-outline" onClick={benchmark} disabled={!predictor || running}>{running ? 'Birimo gupimwa…' : 'Pima umuvuduko'}</button>{bench && !bench.error && <p role="status">Agaciro ko hagati <b>{bench.median_ms} ms</b> · 95 ku ijana by’ibisubizo biri munsi ya <b>{bench.p95_ms} ms</b><br /><small>Ibipimo {bench.n} · Byapimwe kuri iki gikoresho</small></p>}{bench?.error && <p role="status">{userError(bench.error)}</p>}</details>
    <div className="dash-bottom-actions"><span>Gerageza ikibaho nyuma ya buri mpinduka.</span><button className="button-primary" onClick={onClose} disabled={busy}>Subira ku kibaho</button></div>
  </>
}
