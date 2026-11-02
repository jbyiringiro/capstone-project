import { useEffect } from 'react'
import { PARENT_IDLE_MS } from './parent-access.js'

// While the adult area is open, lock it again after five minutes without input, when the app is
// hidden or backgrounded, and when the page is left.
export function useParentLock(unlocked, lock) {
  useEffect(() => {
    if (!unlocked) return
    let timeout
    const renew = () => { clearTimeout(timeout); timeout = setTimeout(lock, PARENT_IDLE_MS) }
    const visibility = () => { if (document.hidden) lock() }
    renew()
    window.addEventListener('pointerdown', renew)
    window.addEventListener('keydown', renew)
    window.addEventListener('pagehide', lock)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('pointerdown', renew)
      window.removeEventListener('keydown', renew)
      window.removeEventListener('pagehide', lock)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [unlocked, lock])
}
