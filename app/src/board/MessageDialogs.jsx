import { forwardRef, useLayoutEffect, useRef } from 'react'
import { categoryOf } from '../symbols/categories.js'
import { Chevron, Icon, SymbolArtwork } from '../shared/ui.jsx'
import { cardLayout } from './message-cards.js'

// Sizes the cards to the room the open dialog leaves them. The observer hears the dialog open and
// runs before the screen is drawn, so the cards never show at a passing size.
function useCardLayout(area, count) {
  useLayoutEffect(() => {
    const element = area.current
    if (!element || !('ResizeObserver' in window)) return
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || !element.clientHeight) return
      const { columns, size } = cardLayout(count, element.clientWidth, element.clientHeight)
      element.style.setProperty('--columns', columns)
      element.style.setProperty('--card', `${size}px`)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [area, count])
}

// Erekana: the message full screen, to show a listener when sound is not possible. The pictures
// take all the room left, so one picture fills the screen and a long message still fits.
export const ShowMessageDialog = forwardRef(function ShowMessageDialog({ message, byKey, realistic, sentence }, ref) {
  const cards = useRef(null)
  useCardLayout(cards, message.length)
  const close = () => ref.current?.close()
  return <dialog ref={ref} className="message-dialog board-dialog" aria-labelledby="show-title">
    <button className="dialog-close" onClick={close} aria-label="Funga ubutumwa">×</button>
    <h2 id="show-title">Ubutumwa bwanjye</h2><p className="dialog-subtitle">Amashusho yanjye. Amagambo yanjye.</p>
    {sentence && <p className="display-sentence">{sentence}</p>}
    <div ref={cards} className="display-message"><div className="display-cards">{message.map((key, index) => <span className="display-chip" key={index} style={{ '--chip': categoryOf(byKey[key]?.category).colour }}>
      <SymbolArtwork symbol={byKey[key]} realistic={realistic} /><b>{byKey[key]?.label_rw ?? key}</b>
    </span>)}</div></div>
    <div className="dialog-footer"><span>Ereka undi muntu ubu butumwa.</span><button className="button-primary" onClick={close}><Chevron />Subira ku kibaho</button></div>
  </dialog>
})

// Shown when speech could not play: the message is kept and can still be shown.
export const SpeechFailedDialog = forwardRef(function SpeechFailedDialog({ message, byKey, explanation, onClosed, onShow, onOpenAudioSettings }, ref) {
  return <dialog ref={ref} className="audio-dialog board-dialog" aria-labelledby="audio-title" aria-describedby="audio-explanation" onClose={onClosed}>
    <button className="dialog-close" onClick={() => ref.current?.close()} aria-label="Funga amakuru y'ijwi">×</button>
    <div className="notice-mark"><Icon name="speaker" /></div><p className="dialog-eyebrow">UBUTUMWA BWAWE BURACYAHARI</p>
    <h2 id="audio-title">Erekana ubutumwa bwawe.</h2><p id="audio-explanation" className="dialog-subtitle">{explanation}</p>
    <div className="audio-message">{message.map(key => byKey[key]?.label_rw ?? key).join(' / ')}</div>
    <div className="dialog-footer"><button className="button-outline" onClick={onOpenAudioSettings}>Igenamiterere ry'ijwi</button><button className="button-primary" onClick={onShow}><Icon name="eye" />Erekana</button></div>
  </dialog>
})
