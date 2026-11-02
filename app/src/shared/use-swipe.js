import { useEffect, useLayoutEffect, useRef } from 'react'

// Turns a sideways swipe of one finger across an element into a step: 1 for a swipe to the left
// (the next page) and -1 to the right. It must cross 60 px, mostly sideways, within a second, so a
// tap that slips does not count. Sideways moves are claimed from the browser, which would otherwise
// treat a quick swipe as a fling and swallow the tap after it; moves up and down still scroll. A
// click left over from a swipe is dropped, so swiping across pictures chooses none of them.
const DISTANCE = 60, CLAIM = 10, SIDEWAYS = 1.5, TIME = 1000, CLICK_AFTER = 500

export function useSwipe(ref, onSwipe, enabled = true) {
  const latest = useRef(onSwipe)
  useLayoutEffect(() => { latest.current = onSwipe })
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    let start = null, swipedAt = -Infinity
    const begin = event => {
      swipedAt = -Infinity
      const touch = event.touches[0]
      start = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, at: event.timeStamp } : null
    }
    const move = event => {
      if (!start) return
      if (event.touches.length !== 1) { start = null; return }
      const across = Math.abs(event.touches[0].clientX - start.x), down = Math.abs(event.touches[0].clientY - start.y)
      if (down > CLAIM && down >= across) start = null
      else if (across > CLAIM && event.cancelable) event.preventDefault()
    }
    const end = event => {
      const from = start
      start = null
      if (!from || event.touches.length) return
      const touch = event.changedTouches[0]
      const across = touch.clientX - from.x, down = touch.clientY - from.y
      if (Math.abs(across) < DISTANCE || Math.abs(across) < SIDEWAYS * Math.abs(down) || event.timeStamp - from.at > TIME) return
      swipedAt = event.timeStamp
      latest.current(across < 0 ? 1 : -1)
    }
    const cancel = () => { start = null }
    // Only the click a swipe leaves behind is dropped: any new press or key belongs to a new choice.
    const fresh = () => { swipedAt = -Infinity }
    const click = event => {
      if (event.timeStamp - swipedAt < CLICK_AFTER) { event.preventDefault(); event.stopPropagation() }
    }
    element.addEventListener('touchstart', begin, { passive: true })
    element.addEventListener('touchmove', move, { passive: false })
    element.addEventListener('touchend', end)
    element.addEventListener('touchcancel', cancel)
    element.addEventListener('pointerdown', fresh, true)
    element.addEventListener('keydown', fresh, true)
    element.addEventListener('click', click, true)
    return () => {
      element.removeEventListener('touchstart', begin)
      element.removeEventListener('touchmove', move)
      element.removeEventListener('touchend', end)
      element.removeEventListener('touchcancel', cancel)
      element.removeEventListener('pointerdown', fresh, true)
      element.removeEventListener('keydown', fresh, true)
      element.removeEventListener('click', click, true)
    }
  }, [ref, enabled])
}
