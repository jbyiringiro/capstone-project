// Node latency benchmark for the on-device predictors (NFR2: suggestions within 200 ms).
// Times topK over the validation prefixes in the parity fixture, after warm-up, with and without
// a 120-word vocabulary mask, for the trigram alone and with the personal re-ranker.
//
//   node scripts/bench-predictor.mjs [--compare <module exporting KnTrigram>] [--out <file.json>]
//
// --compare times an older implementation on the same inputs, for example the pre-refactor
// predictor: git show 28c1683:app/src/predictor.js > /tmp/predictor_old.js
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { KneserNeyTrigram, PersonalHistory, PersonalReranker } from '../src/prediction/index.js'

const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf-8'))
const artifact = read('../public/models/kn_trigram.json')
const prefixes = read('../tests/prediction/fixtures/kn_fixture.json').cases.map(c => c.prefix)
const allowed = new Set(artifact.vocab.filter(word => word !== '</s>').slice(0, 120))

function time(model, mask, calls = 2000) {
  for (let i = 0; i < 100; i++) model.topK(prefixes[i % prefixes.length], 3, mask)
  const samples = []
  for (let i = 0; i < calls; i++) {
    const prefix = prefixes[i % prefixes.length]
    const start = performance.now()
    model.topK(prefix, 3, mask)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  const at = q => +samples[Math.min(samples.length - 1, Math.floor(q * samples.length))].toFixed(4)
  return { calls, median_ms: at(0.5), p95_ms: at(0.95), max_ms: at(1) }
}

function load(Model) {
  const start = performance.now()
  const model = new Model(artifact)
  return { model, load_ms: +(performance.now() - start).toFixed(2) }
}

const history = new PersonalHistory()
prefixes.forEach((prefix, i) => prefix.forEach((symbol, j) => history.record(prefix.slice(0, j), symbol, i * 60)))
const trigram = load(KneserNeyTrigram)
const report = {
  at: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length,
  vocab: artifact.vocab.length, contexts: artifact.tri.length, prefixes: prefixes.length,
  kn_trigram: { load_ms: trigram.load_ms, unmasked: time(trigram.model, null), masked: time(trigram.model, allowed) },
  kn_trigram_personal: { history_events: history.size, masked: time(new PersonalReranker(trigram.model, history, { clock: () => 1e6 }), allowed) }
}
const compare = option('--compare')
if (compare) {
  const { KnTrigram } = await import(pathToFileURL(compare).href)
  const old = load(KnTrigram)
  report.compared = { module: path.basename(compare), load_ms: old.load_ms, unmasked: time(old.model, null), masked: time(old.model, allowed) }
}
const out = option('--out')
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
