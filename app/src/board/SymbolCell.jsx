import { categoryOf } from '../symbols/categories.js'
import { SymbolArtwork } from '../shared/ui.jsx'

// One key: the word on top, the picture below, coloured by word type.
// Without its word (a caregiver's choice) the picture fills the key; the key still says the word.
export default function SymbolCell({ symbol, onPress, suggested = false, disabled = false, selected = false, realistic = true, showLabel = true }) {
  return (
    <button className={`cell ${suggested ? 'suggestion-tile suggest' : 'symbol-tile'} ${selected ? 'selected' : ''} ${realistic || symbol.custom ? 'photo-cell' : ''} ${showLabel ? '' : 'no-label'}`}
      style={{ '--key': categoryOf(symbol.category).key }} onClick={() => onPress(symbol.symbol_id, suggested)}
      aria-label={symbol.label_rw} disabled={disabled} data-symbol={symbol.symbol_id}>
      <span className="tile-body">
        {showLabel && <span className="label">{symbol.label_rw}</span>}
        <span className="picture-frame pic"><SymbolArtwork symbol={symbol} realistic={realistic} /></span>
      </span>
    </button>
  )
}
