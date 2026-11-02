import { useEffect, useMemo, useRef, useState } from 'react'
import { useWordSpeaker } from '../child/use-word-speaker.js'
import { categoryOf } from '../symbols/categories.js'
import { reviewSets } from '../symbols/review-words.js'
import { SymbolArtwork } from '../shared/ui.jsx'
import { useSwipe } from '../shared/use-swipe.js'
import './vocabulary-review.css'

// The vocabulary review interview (RQ1): one bundled word at a time, with its picture, label and
// voice exactly as the board has them, in the order of the paper review sheet. Answers are written
// on the sheet, so nothing here is stored or logged.
export default function VocabularyReview({ symbols, byKey, realistic, onClose }) {
  const dialog = useRef(null)
  const sets = useMemo(() => reviewSets(symbols), [symbols])
  const [setId, setSetId] = useState(sets[0]?.id), [index, setIndex] = useState(0)
  const speak = useWordSpeaker(byKey)
  const keys = (sets.find(set => set.id === setId) ?? sets[0])?.keys ?? []
  const symbol = byKey[keys[index]]

  useEffect(() => { if (!dialog.current.open) dialog.current.showModal() }, [])

  const go = step => setIndex(current => Math.min(keys.length - 1, Math.max(0, current + step)))
  // On a tablet, a sideways swipe moves between words like the arrow keys and the step buttons.
  useSwipe(dialog, go)
  function choose(id) { setSetId(id); setIndex(0) }
  function keyDown(event) {
    if (event.target.tagName === 'SELECT') return
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
  }

  return <dialog ref={dialog} className="review-dialog" aria-label="Gusuzuma amagambo" onClose={onClose} onKeyDown={keyDown}>
    <div className="review-top">
      <div><p className="review-eyebrow">Gusuzuma amagambo</p>
        <label className="review-set"><span>Urutonde</span><select aria-label="Urutonde" value={setId} onChange={event => choose(event.target.value)}>
          {sets.map(set => <option key={set.id} value={set.id}>{set.rw} ({set.keys.length})</option>)}
        </select></label></div>
      <button type="button" className="review-close" onClick={() => dialog.current.close()} aria-label="Funga isuzuma">×</button>
    </div>
    {symbol && <>
      <figure className="review-word" data-symbol={symbol.symbol_id} style={{ '--card-accent': categoryOf(symbol.category).colour }}>
        <SymbolArtwork symbol={symbol} realistic={realistic} />
        <figcaption>{symbol.label_rw}</figcaption>
      </figure>
      <p className="review-progress" aria-live="polite">Ijambo {index + 1} / {keys.length}</p>
      <div className="review-controls">
        <button type="button" className="review-step" onClick={() => go(-1)} disabled={index === 0} >Ijambo ribanziriza</button>
        <button type="button" className="button-primary review-speak" onClick={() => speak(symbol.symbol_id)}>Vuga ijambo</button>
        <button type="button" className="review-step next" onClick={() => go(1)} disabled={index === keys.length - 1} >Ijambo rikurikira</button>
      </div>
    </>}
    <p className="review-note">Nta gisubizo kibikwa muri Vuga. Andika ibisubizo ku rupapuro rwo gusuzuma.</p>
  </dialog>
}
