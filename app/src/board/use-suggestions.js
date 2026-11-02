import { useCallback, useEffect, useMemo, useState } from 'react'
import { PersonalHistory, PersonalReranker } from '../prediction/index.js'
import { completedMessages } from '../storage/messages.js'

// Next-word suggestions for the message being built. With personal suggestions on, the trigram is
// re-ranked by this child's earlier predictive-board messages and the selections made since the
// board opened. Static-board use never feeds the history, as in the study protocol.
export function useSuggestions({ predictor, personal, profileId, mode, message, allowed, k = 3 }) {
  const [history, setHistory] = useState(null)
  useEffect(() => {
    setHistory(null)
    if (!personal || mode !== 'predictive') return
    let current = true
    completedMessages(profileId, 'predictive')
      .then(messages => { if (current) setHistory(PersonalHistory.fromMessages(messages)) })
      .catch(() => { if (current) setHistory(new PersonalHistory()) })
    return () => { current = false }
  }, [personal, mode, profileId])

  const model = useMemo(() => (predictor && history ? new PersonalReranker(predictor, history) : predictor), [predictor, history])
  const suggestions = useMemo(() => (mode === 'predictive' && model ? model.topK(message, k, allowed) : []),
    [model, mode, message, allowed, k])
  // Called before the message state changes, so the next suggestions already include this pick.
  const recordSelection = useCallback((prefix, key) => history?.record(prefix, key, Date.now() / 1000), [history])
  return { suggestions, recordSelection, personalised: !!history }
}
