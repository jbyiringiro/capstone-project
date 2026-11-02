import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { recordedKeys } from '../storage/recordings.js'

// The words that have a caregiver recording, kept live as recordings are saved or deleted.
// null until the first read finishes.
export function useRecordedKeys(onError) {
  const [keys, setKeys] = useState(null)
  useEffect(() => {
    let active = true
    const subscription = liveQuery(recordedKeys).subscribe({
      next: value => { if (active) setKeys(new Set(value)) },
      error: cause => { if (active) onError?.(cause) }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  return keys
}
