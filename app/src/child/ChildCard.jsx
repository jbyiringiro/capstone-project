import { categoryOf } from '../symbols/categories.js'
import { SymbolArtwork } from '../shared/ui.jsx'

const STARS = Array.from({ length: 8 }, (_, i) => i)

// One big picture on the child's board. `pulse`, `wiggle` and `celebrate` are changing numbers
// that restart their animation each time, so the same card can react to repeated taps.
export default function ChildCard({ symbol, onPress, realistic, pulse, wiggle, celebrate, hint = false, disabled = false, showLabel = true }) {
  return <button type="button" className={`child-card ${hint ? 'is-hint' : ''} ${showLabel ? '' : 'no-label'}`} style={{ '--card-accent': categoryOf(symbol.category).colour }}
    onClick={() => onPress(symbol.symbol_id)} aria-label={symbol.label_rw} data-symbol={symbol.symbol_id} disabled={disabled}>
    <span className="child-card-body" key={`${pulse ?? 0}:${wiggle ?? 0}`} data-pulse={pulse ? '' : undefined} data-wiggle={wiggle ? '' : undefined}>
      <span className="child-card-picture"><SymbolArtwork symbol={symbol} realistic={realistic} /></span>
      {showLabel && <span className="child-card-label">{symbol.label_rw}</span>}
    </span>
    {celebrate ? <span className="child-stars" key={celebrate} aria-hidden="true">{STARS.map(i => <i key={i} style={{ '--i': i }}>★</i>)}</span> : null}
  </button>
}
