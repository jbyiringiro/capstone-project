import { useEffect, useState } from 'react'
import { getLocalSummary } from '../storage/messages.js'
import { userError } from '../shared/errors-rw.js'
import { Heading } from './components.jsx'

const MODE_LABELS = { predictive: 'Amagambo afasha', static: 'Ikibaho gisanzwe', child: 'Uburyo bw’umwana' }

// FR8: completed messages per board mode and how often each word was chosen. No scores, targets
// or comparisons between children.
export default function SummaryTab({ activeProfile, byKey, setError, onClose }) {
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let current = true
    setSummary(null)
    getLocalSummary(activeProfile?.profile_id ?? 'demo').then(value => { if (current) setSummary(value) }).catch(e => setError(userError(e)))
    return () => { current = false }
  }, [activeProfile])
  if (!summary) return <p role="status">Incamake irimo gupakira…</p>
  const modes = Object.entries(summary.by_board_mode)
  const frequency = Object.entries(summary.symbol_frequency).sort((a, b) => b[1] - a[1])
  const max = frequency[0]?.[1] ?? 1
  return <>
    <Heading eyebrow={`Incamake · ${activeProfile?.code ?? 'Igerageza'}`} title="Reba ubutumwa bw’umwana.">Incamake y’ubutumwa bwarangije kuvugwa kuri iki gikoresho. Nta manota cyangwa intego zihabwa umwana, kandi nta kugereranya abana.</Heading>
    {!modes.length ? <div className="dash-empty"><h2>Buri kiganiro kigira aho gitangirira.</h2><p>Nta butumwa burarangiza kuvugwa. Kwerekana ubutumwa bw’amashusho na byo ni uburyo bwo kuganira; ntibibarwa nk’ubutumwa bwavuzwe.</p><button className="button-outline" onClick={onClose}>Subira ku kibaho</button></div> : <div className="two">
    <div className="card">
      <h2>Ubutumwa bwarangiye · {activeProfile?.code ?? 'Igerageza'}<small>Ubutumwa bwarangije kuvugwa bukabikwa kuri iki gikoresho. Gukanda bibarirwamo guhindura ibyiciro, gukosora no gukanda Vuga.</small></h2>
      <div className="table-scroll"><table>
        <thead><tr><th>Uburyo</th><th>Ubutumwa</th><th>Gukanda kuri buri butumwa</th><th>Amasegonda kuri buri butumwa</th></tr></thead>
        <tbody>{modes.map(([mode, values]) => <tr key={mode}><td>{MODE_LABELS[mode] ?? 'Uburyo butazwi'}</td><td>{values.messages}</td><td>{values.taps_per_message.toFixed(2)}</td><td>{values.seconds_per_message.toFixed(1)}</td></tr>)}</tbody>
      </table></div>
      <p className="muted">Iyi mibare ntigaragaza ubushobozi bw’umwana bwo kuvuga cyangwa impinduka mu buzima bwe.</p>
    </div>
    <div className="card">
      <h2>Amashusho akunze gukoreshwa<small>Amashusho yatoranyijwe mu butumwa bwarangiye, harimo n’ayaje gukosorwa</small></h2>
      {!frequency.length && <p className="muted">Amashusho yakoreshejwe azagaragara ubutumwa bumaze kuvugwa.</p>}
      {frequency.slice(0, 15).map(([key, n]) => <div className="bar" key={key}><span>{byKey[key]?.label_rw ?? 'Ijambo ritazwi'}</span><i style={{ width: `${n / max * 100}%` }} /><b>{n}</b></div>)}
    </div>
    </div>}
    <p className="dash-summary-note">Iyi mibare ntipima ubushobozi bw’umwana, iterambere rye mu kuvuga cyangwa impinduka mu buzima bwe. Ubutumwa bwerekanwe nta jwi ntibubarwa nk’ubwavuzwe.</p>
  </>
}
