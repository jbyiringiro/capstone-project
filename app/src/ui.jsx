import { useEffect, useState } from 'react'
import { fallbackGlyph } from './emoji.js'

const ICONS = new Set(['back', 'eye', 'feelings', 'finish', 'food', 'happy', 'help', 'home', 'leaf', 'me', 'more', 'no', 'offline', 'pain', 'people', 'play', 'sad', 'settings', 'speaker', 'stop', 'thanks', 'toilet', 'want', 'water', 'yes'])

export function Icon({ name, size = 24, className = '' }) {
  const key = ICONS.has(name) ? name : 'more'
  return <span className={`icon ${className}`} aria-hidden="true">
    <img src={`/design/icons/${key}.svg`} alt="" width={size} height={size} draggable="false" />
  </span>
}

export function Brand({ onClick, disabled = false }) {
  const contents = <><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span className="wordmark">vuga</span></>
  return onClick
    ? <button type="button" className="brand" onClick={onClick} disabled={disabled} aria-label="Ikibaho cya Vuga">{contents}</button>
    : <div className="brand" aria-label="Vuga">{contents}</div>
}

export function SymbolArtwork({ symbol, realistic = true }) {
  const [failed, setFailed] = useState(new Set())
  useEffect(() => setFailed(new Set()), [symbol?.symbol_id, realistic])
  // Bundle every photograph locally. A missing image still leaves the familiar
  // pictogram available, including when the device has no connection.
  const photo = realistic && symbol?.symbol_id ? `/photos/${symbol.symbol_id}.webp` : null
  const paths = [photo, symbol?.image_path].filter(Boolean)
  const src = paths.find(path => !failed.has(path))
  return <span className={`symbol-artwork ${src && src === photo ? 'symbol-artwork--photo' : ''}`} aria-hidden="true">
    {src ? <img src={src} alt="" draggable="false" onError={() => setFailed(previous => new Set([...previous, src]))} />
      : <span className="glyph">{symbol ? fallbackGlyph(symbol) : '▫'}</span>}
  </span>
}
