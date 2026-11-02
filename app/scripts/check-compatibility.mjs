import { chromium, devices, expect, firefox, webkit } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { preview } from 'vite'

// Compatibility and performance matrix for the production build (NFR1 offline, NFR2 latency,
// NFR6 device class). Each run uses a fresh profile and measures, on the real app:
//   cold load to a usable board, then warm and offline reloads through the service worker (offline
//   means the server is stopped, which works the same in every engine; Playwright's setOffline does
//   not reach WebKit's service worker), with the rest of the run continuing offline;
//   tap-to-next-frame latency in predictive mode; the in-app prediction benchmark (Ikibaho);
//   time from Vuga to the first audio frame; frame rate while turning grid pages; JS heap (Chromium).
// Low-end hardware is emulated in Chromium with CPU throttling (4x and 6x, the factors Lighthouse
// uses for mid- and low-tier phones) and a Fast 3G network for the cold load.
//
// A run passes only when every check passes and the page logged no error; anything else fails it
// and the script exits with an error. Headless WebKit on Windows has no audio output, so there a
// run whose speech cannot start is partial, not passed, provided the message stays and Erekana is
// offered; its speech start is not measured.
//
//   npm run build && node scripts/check-compatibility.mjs [--only <id,id>]
const output = process.env.VUGA_EVIDENCE_DIR || fileURLToPath(new URL('../../docs/screenshots/final-2026-10-22/', import.meta.url))
const evidence = fileURLToPath(new URL('../../docs/evidence/compatibility.json', import.meta.url))
const appRoot = fileURLToPath(new URL('..', import.meta.url))
const FAST_3G = { offline: false, latency: 562.5, downloadThroughput: 180_000, uploadThroughput: 84_375 }
const ENGINES = { chromium, firefox, webkit }
const desktop = { viewport: { width: 1280, height: 900 } }
const NO_AUDIO = process.platform === 'win32' // headless WebKit's media output on Windows
const MATRIX = [
  { id: 'edge-desktop', engine: 'chromium', channel: 'msedge', label: 'Microsoft Edge, desktop 1280x900', context: desktop },
  { id: 'edge-android-tablet', engine: 'chromium', channel: 'msedge', label: 'Edge (Chromium), Galaxy Tab S4 profile', context: devices['Galaxy Tab S4'] },
  { id: 'edge-android-phone', engine: 'chromium', channel: 'msedge', label: 'Edge (Chromium), Pixel 5 profile', context: devices['Pixel 5'] },
  { id: 'edge-lowend-tablet', engine: 'chromium', channel: 'msedge', label: 'Edge (Chromium), Galaxy Tab S4, 4x CPU slowdown, Fast 3G', context: devices['Galaxy Tab S4'], cpu: 4, network: FAST_3G },
  { id: 'edge-lowend-phone', engine: 'chromium', channel: 'msedge', label: 'Edge (Chromium), Pixel 5, 6x CPU slowdown, Fast 3G', context: devices['Pixel 5'], cpu: 6, network: FAST_3G },
  { id: 'firefox-desktop', engine: 'firefox', label: 'Firefox, desktop 1280x900', context: desktop },
  { id: 'firefox-phone-size', engine: 'firefox', label: 'Firefox, 393x851 phone viewport', context: { viewport: { width: 393, height: 851 } } },
  { id: 'webkit-ipad', engine: 'webkit', label: 'WebKit (Safari engine), iPad gen 7 profile', context: devices['iPad (gen 7)'], noAudio: NO_AUDIO },
  { id: 'webkit-iphone', engine: 'webkit', label: 'WebKit (Safari engine), iPhone 13 profile', context: devices['iPhone 13'], noAudio: NO_AUDIO }
]
const REQUIRED = ['board_renders', 'service_worker', 'offline_reload', 'suggestions']
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null
await mkdir(output, { recursive: true })

const quantile = (values, q) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1)
}
const timed = async action => { const start = Date.now(); await action(); return Date.now() - start }
const startServer = port => preview({ root: appRoot, logLevel: 'silent', preview: { host: '127.0.0.1', port, strictPort: true } })
const stopServer = server => new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections?.() })

async function unlockCaregiver(page, board) {
  await board.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  const gate = page.locator('.parent-access')
  await expect(gate).toHaveAttribute('data-mode', /setup|unlock/)
  const setup = await gate.getAttribute('data-mode') === 'setup'
  // A first setup offers the caregiver's number; these checks keep the PIN on this device only.
  if (setup) await gate.getByRole('button', { name: 'Komeza nta nimero', exact: true }).click()
  await gate.getByLabel('Umubare w’ibanga', { exact: true }).fill('583104')
  if (setup) {
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('583104')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
  } else await gate.getByRole('button', { name: 'Injira', exact: true }).click()
  await expect(page.locator('.dash')).toBeVisible()
}

async function run(entry, port) {
  const result = { id: entry.id, label: entry.label, engine: entry.engine, cpu_slowdown: entry.cpu ?? 1, network: entry.network ? 'Fast 3G' : 'unthrottled', checks: {}, metrics: {}, notes: [] }
  let browser
  try { browser = await ENGINES[entry.engine].launch({ headless: true, ...(entry.channel ? { channel: entry.channel } : {}) }) }
  catch (error) { return { ...result, status: 'skipped', error: `browser not installed: ${error.message.split('\n')[0]}` } }
  result.browser_version = browser.version()
  const options = { ...entry.context }
  if (entry.engine === 'firefox') { delete options.isMobile; delete options.hasTouch }
  const context = await browser.newContext(options)
  await context.addInitScript(() => {
    window.__firstPlaying = null
    // Speech is timed from the moment the press reaches the page, as a child's tap would: what
    // Playwright does before it (finding the button by name, checking it can be pressed) took
    // 30 ms at full speed and 240-460 ms under 6x CPU emulation, and is not the app's delay.
    window.__speakPressed = null
    addEventListener('click', event => { if (event.target.closest?.('.speak-button')) window.__speakPressed ??= performance.now() }, true)
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args) {
      this.addEventListener('playing', () => { window.__firstPlaying ??= performance.now() }, { once: true })
      return play.apply(this, args)
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(entry.cpu ? 60000 : 20000)
  // The board's load times are measured, so waiting for it allows as long as any other step.
  const usable = { timeout: entry.cpu ? 60000 : 20000 }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const board = page.locator('.board:visible')
  const server = await startServer(port)
  let cdp = null, online = true
  try {
    if (entry.engine === 'chromium') {
      cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
      if (entry.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: entry.cpu })
      if (entry.network) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', entry.network) }
    }

    // 1. Cold load: nothing cached, the board is usable when its first tile can be pressed.
    result.metrics.cold_board_ms = await timed(async () => {
      await page.goto(server.resolvedUrls.local[0], { waitUntil: 'commit' })
      await expect(board.locator('.symbol-grid .symbol-tile').first()).toBeEnabled(usable)
    })
    result.metrics.navigation = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const resources = performance.getEntriesByType('resource')
      const bytes = [nav, ...resources].reduce((sum, entry) => sum + (entry?.transferSize ?? 0), 0)
      return { dom_content_loaded_ms: Math.round(nav?.domContentLoadedEventEnd ?? 0), load_ms: Math.round(nav?.loadEventEnd ?? 0), transferred_kb: bytes ? Math.round(bytes / 1024) : null }
    })
    result.checks.board_renders = true
    if (entry.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

    // 2. Service worker: precache installs, then warm and offline reloads come from the device.
    result.checks.service_worker = await page.evaluate(() => 'serviceWorker' in navigator
      ? Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 120000))])
      : false)
    if (result.checks.service_worker) {
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null || caches.keys().then(keys => keys.length > 0), null, { timeout: 120000 }).catch(() => {})
      await page.waitForFunction(async () => (await caches.keys()).some(key => key.includes('precache')), null, { timeout: 120000 })
      result.metrics.warm_board_ms = await timed(async () => {
        await page.reload({ waitUntil: 'commit' })
        await expect(board.locator('.symbol-grid .symbol-tile').first()).toBeEnabled(usable)
      })
      await stopServer(server)
      online = false
      result.metrics.offline_board_ms = await timed(async () => {
        await page.reload({ waitUntil: 'commit' })
        await expect(board.locator('.symbol-grid .symbol-tile').first()).toBeEnabled(usable)
      })
      result.checks.offline_reload = await board.locator('.symbol-grid img').first().evaluate(img => img.complete && img.naturalWidth > 0)
    } else result.notes.push('No service worker in this engine/headless build: warm and offline reloads not measured.')

    // 3. Caregiver area: switch suggestions on, then run the in-app prediction benchmark.
    await unlockCaregiver(page, board)
    await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name: 'Ikibaho', exact: true }).click()
    const suggestions = page.getByRole('switch', { name: 'Amagambo afasha', exact: true })
    if (!(await suggestions.isChecked())) await suggestions.click()
    await expect(suggestions).toBeChecked()
    await page.locator('.dash-benchmark summary').click()
    await page.getByRole('button', { name: 'Pima umuvuduko', exact: true }).click()
    const bench = page.locator('.dash-benchmark [role="status"] b')
    await expect(bench).toHaveCount(2)
    const [median, p95] = await bench.allTextContents()
    result.metrics.prediction_ms = { median: parseFloat(median), p95: parseFloat(p95), calls: 300 }
    await page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
    await expect(board).toBeVisible()

    // 4. Tap to next frame, with a suggestion row recomputed after every tap.
    const keys = ['I', 'WANT', 'WATER', 'EAT', 'PLAY']
    const taps = []
    for (let round = 0; round < 4; round++) {
      for (const key of keys) {
        taps.push(await page.evaluate(async symbol => {
          const before = document.querySelectorAll('.board:not([hidden]) .message-chip').length
          const start = performance.now()
          document.querySelector(`.board:not([hidden]) .symbol-grid [data-symbol="${symbol}"]`).click()
          await new Promise(resolve => {
            const check = () => document.querySelectorAll('.board:not([hidden]) .message-chip').length > before ? requestAnimationFrame(() => resolve()) : requestAnimationFrame(check)
            check()
          })
          return performance.now() - start
        }, key))
      }
      await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
    }
    result.metrics.tap_to_frame_ms = { median: quantile(taps, 0.5), p95: quantile(taps, 0.95), taps: taps.length }
    await expect(board.locator('.suggestion-row [data-symbol]')).toHaveCount(3)
    result.checks.suggestions = true

    // 5. Speech: a bundled Kinyarwanda clip starts and the message completes.
    await board.locator('.symbol-grid [data-symbol="WATER"]').click()
    // The tapped word is said at once; let it finish so only the message's own audio is timed.
    await page.waitForTimeout(1500)
    const speakAt = await page.evaluate(() => { window.__firstPlaying = null; window.__speakPressed = null; return performance.now() })
    await board.getByRole('button', { name: 'Vuga ubutumwa', exact: true }).click()
    try {
      await page.waitForFunction(() => window.__firstPlaying !== null, null, { timeout: 15000 })
      const { pressed, playing } = await page.evaluate(() => ({ pressed: window.__speakPressed, playing: window.__firstPlaying }))
      result.metrics.speech_start_ms = Math.round(playing - pressed)
      result.metrics.speech_driver_ms = Math.round(pressed - speakAt)
      await expect(board.locator('.message-chip')).toHaveCount(0, { timeout: 15000 })
      result.checks.speech = true
    } catch {
      result.checks.speech = false
      // Without audio the board must keep the message and offer Erekana instead. A clip that
      // never starts is given up after the player's 30 s limit (speech/player.js).
      const fallback = page.getByRole('dialog', { name: 'Erekana ubutumwa bwawe.' })
      await fallback.waitFor({ state: 'visible', timeout: 35000 }).catch(() => {})
      result.checks.speech_fallback = await fallback.isVisible() && await fallback.getByRole('button', { name: 'Erekana', exact: true }).isVisible()
        && await board.locator('.message-chip').count() > 0
      result.notes.push(`Audio did not start in this headless engine${result.checks.speech_fallback ? '; the message stayed and Erekana was offered' : ''}. Speech start not measured.`)
      if (await fallback.isVisible()) await page.keyboard.press('Escape')
      if (await board.locator('.message-chip').count()) await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
    }

    // 6. Frame rate while turning pages of every picture back and forth. The board fits the screen
    // and does not scroll, so page turns are where the grid re-renders. The caregiver turns the
    // section tabs off and chooses the section: "Amashusho yose" has several pages on every screen.
    await unlockCaregiver(page, board)
    await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name: 'Ikibaho', exact: true }).click()
    const sectionTabs = page.getByRole('switch', { name: 'Ibyiciro ku kibaho cy’umwana', exact: true })
    if (await sectionTabs.isChecked()) {
      await sectionTabs.click()
      await expect(page.locator('.dash-save-note')).toContainText('Ibyatoranyijwe byabitswe')
    }
    await page.locator('.dash-section-options label').filter({ hasText: /^Amashusho yose$/ }).click()
    await expect(page.locator('.dash-save-note')).toContainText('Ibyatoranyijwe byabitswe')
    await page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
    await expect(board.locator('.page-button.next')).toBeVisible()
    result.metrics.page_turns = await page.evaluate(async () => {
      const button = selector => document.querySelector(`.board:not([hidden]) ${selector}`)
      let forward = true, turns = 0
      const frames = []
      let last = performance.now()
      const end = last + 2000
      await new Promise(resolve => {
        const step = now => {
          frames.push(now - last); last = now
          if (frames.length % 10 === 0) {
            if (button(forward ? '.page-button.next' : '.page-button:not(.next)')?.disabled) forward = !forward
            const next = button(forward ? '.page-button.next' : '.page-button:not(.next)')
            if (next && !next.disabled) { next.click(); turns++ }
          }
          if (now < end) requestAnimationFrame(step); else resolve()
        }
        requestAnimationFrame(step)
      })
      frames.shift()
      const average = frames.reduce((a, b) => a + b, 0) / frames.length
      return { fps: +(1000 / average).toFixed(1), longest_frame_ms: +Math.max(...frames).toFixed(1), frames: frames.length, turns }
    })
    if (cdp) {
      const { metrics } = await cdp.send('Performance.getMetrics')
      const value = name => metrics.find(metric => metric.name === name)?.value
      result.metrics.js_heap_mb = +(value('JSHeapUsedSize') / 1048576).toFixed(1)
      result.metrics.dom_nodes = value('Nodes')
    }
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `${output}/compat-${entry.id}.png`, animations: 'disabled' })
    result.screenshot = `compat-${entry.id}.png`
    result.page_errors = errors
    const failed = REQUIRED.filter(name => result.checks[name] !== true)
    const audioMissing = !result.checks.speech
    if (audioMissing && !(entry.noAudio && result.checks.speech_fallback)) failed.push('speech')
    result.failed_checks = failed
    result.status = errors.length || failed.length ? 'failed' : audioMissing ? 'partial' : 'passed'
    if (result.status === 'partial') result.coverage = 'partial: no audio output in headless WebKit on Windows; speech start not measured'
  } catch (error) {
    result.status = 'failed'
    result.error = error.message.split('\n')[0]
    result.page_errors = errors
    await page.screenshot({ path: `${output}/compat-${entry.id}-failure.png` }).catch(() => {})
  } finally {
    await browser.close()
    if (online) await stopServer(server)
  }
  return result
}

const results = []
for (const [index, entry] of MATRIX.filter(e => !only || only.includes(e.id)).entries()) {
  const result = await run(entry, 4190 + index)
  results.push(result)
  const m = result.metrics
  console.log(`${result.status.toUpperCase()} ${entry.id}: cold ${m.cold_board_ms} ms, warm ${m.warm_board_ms ?? '-'} ms, offline ${m.offline_board_ms ?? '-'} ms, prediction p95 ${m.prediction_ms?.p95 ?? '-'} ms, tap p95 ${m.tap_to_frame_ms?.p95 ?? '-'} ms, speech ${m.speech_start_ms ?? '-'} ms, ${m.page_turns?.fps ?? '-'} fps${result.error ? ` | ${result.error}` : ''}`)
}
const summary = Object.fromEntries(['passed', 'partial', 'failed', 'skipped'].map(status => [status, results.filter(r => r.status === status).length]))
const report = {
  generated_at: new Date().toISOString(), server: 'vite preview of app/dist, one per run, stopped for the offline phase',
  host: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memory_gb: Math.round(os.totalmem() / 2 ** 30) },
  note: 'Headless runs on one laptop. CPU slowdown and network profiles emulate low-end hardware; they are not measurements on a physical tablet.',
  summary,
  results
}
await writeFile(evidence, JSON.stringify(report, null, 2) + '\n')
console.log(`Wrote ${results.length} runs to ${evidence}: ${Object.entries(summary).map(([status, count]) => `${count} ${status}`).join(', ')}`)
// Partial coverage is reported, not hidden; a failed or skipped configuration fails the matrix.
if (results.some(r => r.status !== 'passed' && r.status !== 'partial')) process.exitCode = 1
