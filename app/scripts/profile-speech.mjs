import { chromium, devices, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// Where the time goes between pressing Vuga and the first audio (NFR2: within 300 ms), on the
// Pixel 5 profile at full speed and under 4x and 6x CPU throttling. Each press is split into:
//   driver      Playwright's own work before the press reaches the page (finding the button by its
//               name, checking it can be pressed); a child's tap has none of it
//   play_call   from the press reaching the page to the app calling play()
//   playing     from the press reaching the page to the media element's playing event
// The output latency after `playing` cannot be seen in a headless browser.
//
//   npm run build && npm run preview, then node scripts/profile-speech.mjs [--presses 4] [--out file.json]
const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const presses = Number(option('--presses', 4)), out = option('--out', null)
const MESSAGES = [['WATER'], ['I', 'WANT', 'WATER']]

async function profile(cpu) {
  const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
  try {
    const context = await browser.newContext({ ...devices['Pixel 5'] })
    await context.addInitScript(() => {
      window.__marks = {}
      addEventListener('click', event => { if (event.target.closest?.('.speak-button')) window.__marks.pressed ??= performance.now() }, true)
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...args) {
        window.__marks.play ??= performance.now()
        this.addEventListener('playing', () => { window.__marks.playing ??= performance.now() }, { once: true })
        return play.apply(this, args)
      }
    })
    const page = await context.newPage()
    const board = page.locator('.board:visible')
    await page.goto(baseURL)
    await expect(board.locator('.symbol-grid .symbol-tile').first()).toBeEnabled({ timeout: 60000 })
    // Clips come from the service worker's cache, as on an installed tablet.
    await page.waitForFunction(async () => (await caches.keys()).some(key => key.includes('precache')), null, { timeout: 120000 })
    await page.reload()
    await expect(board.locator('.symbol-grid .symbol-tile').first()).toBeEnabled({ timeout: 60000 })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
    const runs = []
    for (const keys of MESSAGES) {
      for (let press = 0; press < presses; press++) {
        for (const key of keys) await board.locator(`.symbol-grid [data-symbol="${key}"]`).click()
        await page.waitForTimeout(2500) // the tapped words finish, as before a child's press
        const start = await page.evaluate(() => { window.__marks = {}; return performance.now() })
        await board.getByRole('button', { name: 'Vuga ubutumwa', exact: true }).click()
        await page.waitForFunction(() => window.__marks.playing, null, { timeout: 30000 })
        const marks = await page.evaluate(() => window.__marks)
        await expect(board.locator('.message-chip')).toHaveCount(0, { timeout: 30000 })
        runs.push({ message: keys.join(' '), driver_ms: Math.round(marks.pressed - start),
          play_call_ms: Math.round(marks.play - marks.pressed), playing_ms: Math.round(marks.playing - marks.pressed) })
      }
    }
    return { cpu_slowdown: cpu, browser: browser.version(), runs }
  } finally { await browser.close() }
}

const results = []
for (const cpu of [1, 4, 6]) {
  const result = await profile(cpu)
  const range = field => `${Math.min(...result.runs.map(run => run[field]))}-${Math.max(...result.runs.map(run => run[field]))} ms`
  console.log(`${cpu}x CPU: driver ${range('driver_ms')}, play() ${range('play_call_ms')}, playing ${range('playing_ms')} after the press`)
  results.push(result)
}
if (out) {
  await mkdir(dirname(resolve(out)), { recursive: true })
  await writeFile(resolve(out), JSON.stringify({ generated_at: new Date().toISOString(), baseURL, profile: 'Pixel 5', results }, null, 2) + '\n')
}
