import { useEffect, useState } from 'react'
import { fallbackGlyph } from '../symbols/emoji.js'

const ICONS = new Set(['back', 'eye', 'feelings', 'finish', 'food', 'happy', 'help', 'home', 'leaf', 'me', 'more', 'no', 'offline', 'pain', 'parent', 'people', 'play', 'sad', 'settings', 'speaker', 'stop', 'thanks', 'toilet', 'trash', 'want', 'water', 'yes'])

export function Icon({ name, size = 24, className = '' }) {
  const key = ICONS.has(name) ? name : 'more'
  return <span className={`icon ${className}`} aria-hidden="true">
    <img src={`/design/icons/${key}.svg`} alt="" width={size} height={size} draggable="false" />
  </span>
}

// A left-pointing chevron for page and step buttons; flip it with CSS for "next".
export const Chevron = () => <svg className="chevron" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>

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
  // pictogram available, including when the device has no connection. A caregiver's
  // custom word has only its own photo, so it shows in both picture styles.
  const photo = realistic && symbol?.symbol_id && !symbol.custom ? `/photos/${symbol.symbol_id}.webp` : null
  const paths = [symbol?.image_url, photo, symbol?.image_path].filter(Boolean)
  const src = paths.find(path => !failed.has(path))
  return <span className={`symbol-artwork ${src && (src === photo || src === symbol.image_url) ? 'symbol-artwork--photo' : ''}`} aria-hidden="true">
    {src ? <img src={src} alt="" draggable="false" onError={() => setFailed(previous => new Set([...previous, src]))} />
      : <span className="glyph">{symbol ? fallbackGlyph(symbol) : '▫'}</span>}
  </span>
}
