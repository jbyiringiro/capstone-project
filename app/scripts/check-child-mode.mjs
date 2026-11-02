import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// End-to-end checks for child mode on the production build: the child sees only the caregiver's
// chosen pictures, each tap speaks at once, the caregiver edits the board behind the PIN, and the
// picture-finding game awards stars and records progress without logging messages.
//
//   npm run build && npm run preview, then node scripts/check-child-mode.mjs
const output = process.env.VUGA_EVIDENCE_DIR || fileURLToPath(new URL('../../docs/screenshots/final-2026-10-22/', import.meta.url))
const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.addInitScript(() => {
  if ('speechSynthesis' in window) Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: () => [] })
  window.__playing = 0
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) { this.addEventListener('playing', () => { window.__playing++ }, { once: true }); return play.apply(this, args) }
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const checks = [], screenshots = [], pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
const child = page.locator('.child-board:visible')
const cards = () => child.locator('.child-grid .child-card')
const tab = name => page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name, exact: true }).click()
const saved = text => expect(page.locator('.dash-save-note')).toContainText(text)

async function check(name, action) { await action(); checks.push({ name, status: 'passed' }); console.log(`PASS ${checks.length}: ${name}`) }
async function screenshot(name) { await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' }); screenshots.push(`${name}.png`) }
async function caregiver(from) {
  await from.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  const gate = page.locator('.parent-access')
  await expect(gate).toHaveAttribute('data-mode', /setup|unlock/)
  await gate.getByLabel('Umubare w’ibanga', { exact: true }).fill('246810')
  if (await gate.getAttribute('data-mode') === 'setup') {
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('246810')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
  } else await gate.getByRole('button', { name: 'Injira', exact: true }).click()
  await expect(page.locator('.dash')).toBeVisible()
}
const back = () => page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
const stored = () => page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => { const r = indexedDB.open('vuga'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  try {
    const read = name => new Promise((resolve, reject) => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    return { messages: await read('messages'), tap_events: await read('tap_events'), game_sessions: await read('game_sessions') }
  } finally { database.close() }
})

try {
  await page.goto(baseURL)
  await expect(page.locator('.board:visible')).toBeVisible()

  await check('The caregiver turns child mode on behind the PIN; the child then sees only nine big pictures', async () => {
    await caregiver(page.locator('.board:visible'))
    await tab('Uburyo bw’umwana')
    await page.getByRole('switch', { name: 'Uburyo bw’umwana', exact: true }).click()
    await saved('Uburyo bw’umwana burafunguye')
    await back()
    await expect(child).toBeVisible()
    await expect(cards()).toHaveCount(9)
    await expect(page.locator('.category-bar, .message-tray, .speak-button, .suggestion-row')).toHaveCount(0)
    await expect(child.locator('.child-bubble')).toContainText('Kanda ku ishusho!')
    const box = await cards().first().boundingBox()
    expect(box.width).toBeGreaterThan(200)
    expect(box.height).toBeGreaterThan(150)
    await screenshot('child-board-tablet')
  })

  await check('A tap says the word at once, shows it large, and is logged as a device-only child message', async () => {
    const before = await page.evaluate(() => window.__playing)
    await child.getByRole('button', { name: 'amazi', exact: true }).click()
    await expect(child.locator('.child-bubble-word')).toContainText('amazi')
    await expect.poll(() => page.evaluate(() => window.__playing)).toBeGreaterThan(before)
    await expect.poll(async () => (await stored()).messages.length).toBe(1)
    const [message] = (await stored()).messages
    expect(message).toMatchObject({ board_mode: 'child', synced: -1, tap_count: 2 })
    await screenshot('child-board-spoken')
  })

  await check('A quick accidental second tap on the same picture is ignored; other pictures respond at once', async () => {
    const water = child.getByRole('button', { name: 'amazi', exact: true })
    await page.waitForTimeout(700)
    await water.click(); await water.click()
    await child.getByRole('button', { name: 'kurya', exact: true }).click()
    await expect.poll(async () => (await stored()).messages.length).toBe(3)
    const selected = (await stored()).tap_events.filter(e => e.action_type === 'select').map(e => e.symbol_key).sort()
    expect(selected).toEqual(['EAT', 'WATER', 'WATER'])
  })

  await check('The caregiver switches to a ready-made board and edits it; the child board follows', async () => {
    await caregiver(child)
    await expect(page.locator('.child-mode')).toBeVisible()
    await page.getByRole('button', { name: /Igihe cyo kurya/ }).click()
    await saved('Igihe cyo kurya')
    await page.getByRole('button', { name: 'Kuraho icyayi', exact: true }).click()
    await page.getByLabel('Shakisha ishusho wongeraho').fill('umupira')
    await page.locator('.child-add-results button').filter({ hasText: 'umupira' }).click()
    await expect(page.locator('.child-chosen-item')).toHaveCount(9)
    await expect(page.locator('.child-chosen-item').last()).toContainText('umupira')
    await screenshot('caregiver-child-mode')
    await back()
    await expect(cards()).toHaveCount(9)
    await expect(child.getByRole('button', { name: 'umupira', exact: true })).toBeVisible()
    await expect(child.getByRole('button', { name: 'icyayi', exact: true })).toHaveCount(0)
  })

  await check('The game asks for pictures, highlights the answer after two misses, and ends with five stars', async () => {
    await caregiver(child)
    await page.getByRole('button', { name: 'Tangiza umukino', exact: true }).click()
    const game = page.locator('.child-game')
    await expect(game).toBeVisible()
    await expect(page.locator('.dash')).toHaveCount(0)
    const messagesBefore = (await stored()).messages.length
    for (let round = 1; round <= 5; round++) {
      const prompt = game.locator('.child-prompt b')
      await expect(prompt).toBeVisible()
      const label = await prompt.textContent()
      if (round === 1) {
        const wrong = game.locator(`.child-grid .child-card:not([aria-label="${label}"])`).first()
        await wrong.click(); await wrong.click()
        await expect(game.locator('.child-card.is-hint')).toHaveAttribute('aria-label', label)
        await expect(game.locator('.child-game-note')).toContainText('Ongera ugerageze')
        await screenshot('child-game-hint')
      }
      await game.getByRole('button', { name: label, exact: true }).click()
      await expect(game.locator('.child-progress i.on')).toHaveCount(round)
      if (round < 5) await expect(game.locator('.child-prompt b')).not.toHaveText(label, { timeout: 5000 }).catch(() => {})
    }
    const finish = page.getByRole('dialog', { name: 'Wakoze neza!' })
    await expect(finish).toBeVisible({ timeout: 10000 })
    await expect(finish.locator('.child-finish-stars i')).toHaveCount(5)
    await screenshot('child-game-finished')
    await finish.getByRole('button', { name: 'Komeza', exact: true }).click()
    await expect(child).toBeVisible()
    const data = await stored()
    expect(data.messages.length).toBe(messagesBefore)
    expect(data.game_sessions).toHaveLength(1)
    expect(data.game_sessions[0]).toMatchObject({ stars: 5 })
    expect(data.game_sessions[0].rounds[0]).toMatchObject({ misses: 2, hinted: true })
  })

  await check('Progress appears for the caregiver: stars, first-try finds and words to practise', async () => {
    await caregiver(child)
    const progress = page.locator('.child-progress-card')
    await expect(progress).toContainText('Inyenyeri zose: 5')
    await expect(progress.locator('tbody tr')).toHaveCount(1)
    await expect(progress).toContainText('Amagambo akeneye imyitozo')
    await back()
  })

  await check('On a phone in portrait the board uses three columns and keeps every picture over 2 cm', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(cards()).toHaveCount(9)
    const boxes = await cards().evaluateAll(list => list.map(card => card.getBoundingClientRect().toJSON()))
    expect(new Set(boxes.map(b => Math.round(b.left))).size).toBe(3)
    for (const box of boxes) { expect(box.width).toBeGreaterThanOrEqual(76); expect(box.bottom).toBeLessThanOrEqual(844 + 1) }
    await screenshot('child-board-phone')
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  await check('Turning child mode off brings back the full board with its grid and Vuga', async () => {
    await caregiver(child)
    await page.getByRole('switch', { name: 'Uburyo bw’umwana', exact: true }).click()
    await saved('Ikibaho cyuzuye cyagarutse')
    await back()
    await expect(page.locator('.board:visible .symbol-grid .symbol-tile').first()).toBeVisible()
    await expect(page.locator('.board:visible .speak-button')).toBeVisible()
    await expect(page.locator('.child-board')).toHaveCount(0)
  })

  await check('Child mode raised no uncaught page errors', async () => { expect(pageErrors).toEqual([]) })
  await writeFile(`${output}/child-mode-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), base_url: baseURL, total: checks.length, status: 'passed', checks, screenshots, pageErrors }, null, 2) + '\n')
  console.log(`Child mode: ${checks.length} checks passed`)
} catch (error) {
  await page.screenshot({ path: `${output}/child-mode-failure.png` }).catch(() => {})
  await writeFile(`${output}/child-mode-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), status: 'failed', checks, error: error.message, pageErrors }, null, 2) + '\n')
  throw error
} finally {
  await browser.close()
}
