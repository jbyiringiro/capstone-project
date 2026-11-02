import { useCallback, useRef, useState } from 'react'
import { userError } from '../shared/errors-rw.js'

// Runs one caregiver change at a time: a second tap while saving is ignored, the dashboard is told
// it is busy, and a failure is reported in Kinyarwanda rather than as a browser message.
// Resolves to 'done', 'failed' or 'ignored'.
export function useSerialTask(setError, setWorking) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async task => {
    if (running.current) return 'ignored'
    running.current = true
    setBusy(true); setWorking?.(true); setError('')
    try {
      await task()
      return 'done'
    } catch (error) {
      setError(userError(error))
      return 'failed'
    } finally {
      running.current = false
      setBusy(false); setWorking?.(false)
    }
  }, [setError, setWorking])
  return [busy, run]
}
