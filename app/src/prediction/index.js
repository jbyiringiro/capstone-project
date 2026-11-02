import { KneserNeyTrigram } from './KneserNeyTrigram.js'

export { BOS, EOS, Predictor } from './Predictor.js'
export { KneserNeyTrigram } from './KneserNeyTrigram.js'
export { PersonalHistory } from './PersonalHistory.js'
export { PersonalReranker, RERANKER_WEIGHTS } from './PersonalReranker.js'
export { benchPredictor } from './bench.js'

// Artefact type -> class, as in api/app/prediction.py, so a new model family is added here only.
const MODEL_TYPES = { kn_trigram: KneserNeyTrigram }

export function predictorFromArtifact(artifact) {
  const Model = MODEL_TYPES[artifact?.type]
  if (!Model) throw new Error(`unknown model type: ${artifact?.type}`)
  return new Model(artifact)
}

export async function loadPredictor(url = '/models/kn_trigram.json') {
  const response = await fetch(url)
  if (!response.ok) return null
  return predictorFromArtifact(await response.json())
}
