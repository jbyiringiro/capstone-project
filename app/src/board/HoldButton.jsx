import { useEffect, useRef, useState } from 'react'

// A button that acts only after being held, so a child's passing tap cannot open the adult area.
// Keyboard and switch users activate it directly (a click with detail 0 has no pointer).
export default function HoldButton({ onHold, children, className, title, ariaLabel, disabled, buttonRef, ms = 1200 }) {
  const timer = useRef(null)
  const [progress, setProgress] = useState(false)
  const cancel = () => { setProgress(false); clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (disabled) cancel() }, [disabled])
  const start = event => {
    if (disabled || event.button !== 0) return
    cancel()
    setProgress(true)
    timer.current = setTimeout(() => { cancel(); onHold() }, ms)
  }
  return <button ref={buttonRef} className={`${className} ${progress ? 'holding' : ''}`} title={title} aria-label={ariaLabel} disabled={disabled}
    onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onBlur={cancel}
    onClick={event => { if (event.detail === 0) onHold() }} onContextMenu={event => event.preventDefault()}>{children}</button>
}
