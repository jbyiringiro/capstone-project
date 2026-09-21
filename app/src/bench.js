// In-browser latency benchmark: run on the actual study tablet (NFR2, proposal 3.3.4).
// Reports median and 95th percentile of predictor.topK over realistic prefixes after warm-up.
export async function benchPredictor(predictor, prefixes, n = 300) {
  if (!predictor) return { error: 'no predictor loaded' }
  for (let i = 0; i < 20; i++) predictor.topK(prefixes[i % prefixes.length], 3)
  const times = []
  for (let i = 0; i < n; i++) {
    const p = prefixes[i % prefixes.length]
    const t0 = performance.now(); predictor.topK(p, 3); times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const result = {
    n, median_ms: +times[Math.floor(n / 2)].toFixed(3), p95_ms: +times[Math.floor(0.95 * n) - 1].toFixed(3),
    userAgent: navigator.userAgent, memory_gb: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null,
    at: new Date().toISOString()
  }
  console.table(result)
  return result
}
