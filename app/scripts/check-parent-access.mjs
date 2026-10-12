import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4182/'
const output = fileURLToPath(new URL('../../docs/screenshots/licensed-2026-10-10/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
// SW blocking makes the deliberate missing-audio route deterministic. The main
// browser suite independently verifies the production service worker/offline media.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
await context.addInitScript(() => {
  if ('speechSynthesis' in window) Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: () => [] })
})
const page = await context.newPage()
const checks = [], screenshots = [], errors = []
page.on('pageerror', error => errors.push(error.message))
const board = page.locator('.board:visible'), gate = page.locator('.parent-access')
const draft = () => board.locator('.message-chip')
const pin = () => gate.getByLabel('Umubare w’ibanga', { exact: true })
async function enterGate(mode = 'unlock') {
  await board.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(gate).toHaveAttribute('data-mode', mode)
  await expect(page.locator('.dash')).toHaveCount(0)
}
async function login(value = '482619') {
  await pin().fill(value)
  await gate.getByRole('button', { name: 'Injira', exact: true }).click()
  await expect(page.locator('.dash')).toBeVisible()
}
async function back() {
  await page.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
  await expect(board).toBeVisible()
}
async function check(name, action) {
  await action(); checks.push({ name, status: 'passed' }); console.log(`PASS ${checks.length}: ${name}`)
}
async function snapshot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
  screenshots.push(`${name}.png`)
}
async function readCredential() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get('parent-access:v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    finally { database.close() }
  })
}
async function writeSettings(rows) {
  await page.evaluate(async settings => {
    const database = await new Promise(resolve => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result) })
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('settings', 'readwrite')
        for (const row of settings) transaction.objectStore('settings').put(row)
        transaction.oncomplete = resolve; transaction.onerror = reject
      })
    } finally { database.close() }
  }, rows)
}

try {
  await page.goto(baseURL)
  await check('Child can communicate before adult setup; setup can be dismissed without losing the message', async () => {
    await expect(board).toBeVisible()
    await board.locator('[data-symbol="WATER"]').click()
    await expect(draft()).toHaveCount(1)
    await enterGate('setup')
    await expect(gate.getByText('Umubyeyi cyangwa umurezi abanze abishyireho.', { exact: true })).toBeVisible()
    await snapshot('parent-first-setup')
    await back()
    await expect(draft()).toHaveCount(1)
    expect(await readCredential()).toBeUndefined()
  })
  await check('Adult must confirm a PIN; no profiles, settings, audio or export are mounted before success', async () => {
    await enterGate('setup')
    await pin().fill('482619')
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('482618')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('ntihuye')
    expect(await readCredential()).toBeUndefined()
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('482619')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await expect(page.locator('.dash')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button')).toHaveCount(7)
    const credential = await readCredential()
    expect(credential.value.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(credential)).not.toContain('482619')
  })
  await check('Returning to the child board locks parent access and preserves the message draft', async () => {
    await back()
    await expect(draft()).toHaveCount(1)
    await enterGate()
    await pin().fill('9999')
    await gate.getByRole('button', { name: 'Injira', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('si wo')
    await expect(page.locator('.dash')).toHaveCount(0)
    await snapshot('parent-unlock')
    await login()
  })
  await check('Reload always returns to child access and never persists an authenticated parent session', async () => {
    await page.reload()
    await expect(board).toBeVisible()
    await expect(page.locator('.dash')).toHaveCount(0)
    await enterGate()
    await expect(gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true })).toHaveCount(0)
  })
  await check('Five failed attempts cause a persisted cooldown, including after reload; child board stays available', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await pin().fill('0000')
      await gate.getByRole('button', { name: 'Injira', exact: true }).click()
      if (attempt < 4) await expect(gate.getByRole('alert')).toContainText('si wo')
      await expect(pin()).toHaveValue('')
    }
    await expect(pin()).toBeDisabled()
    await expect(gate.getByRole('status')).toContainText('Tegereza amasegonda')
    await page.reload()
    await enterGate()
    await expect(pin()).toBeDisabled()
    await back()
    await board.locator('[data-symbol="WATER"]').click()
    await expect(draft()).toHaveCount(1)
    // Move only the browser's clock past the persisted timestamp, avoiding a real wait.
    await page.clock.install()
    await page.clock.fastForward(31_000)
    await enterGate()
    await login()
  })
  await check('Parent-only PIN change requires current PIN and the new credential replaces the old one', async () => {
    await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Kwinjira', exact: true }).click()
    const form = page.locator('.parent-settings')
    await form.getByLabel('Umubare w’ibanga usanzwe', { exact: true }).fill('0000')
    await form.getByLabel('Umubare w’ibanga mushya', { exact: true }).fill('2468')
    await form.getByLabel('Ongera wandike umubare w’ibanga mushya', { exact: true }).fill('2468')
    await form.getByRole('button', { name: 'Bika umubare mushya', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('si wo')
    await form.getByLabel('Umubare w’ibanga usanzwe', { exact: true }).fill('482619')
    await form.getByLabel('Umubare w’ibanga mushya', { exact: true }).fill('2468')
    await form.getByRole('button', { name: 'Bika umubare mushya', exact: true }).click()
    await expect(form.getByRole('status')).toContainText('wahinduwe')
    await back()
    await enterGate()
    await pin().fill('482619')
    await gate.getByRole('button', { name: 'Injira', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('si wo')
    await login('2468')
  })
  await check('Five minutes without input locks parent access while retaining the child message', async () => {
    await page.clock.fastForward(301_000)
    await expect(board).toBeVisible()
    await expect(draft()).toHaveCount(1)
    await expect(page.locator('.dash')).toHaveCount(0)
    await enterGate()
    await login('2468')
  })
  await check('Backgrounding locks the adult area and parent access works without network', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
    await expect(board).toBeVisible()
    await page.evaluate(() => { delete document.hidden })
    await context.setOffline(true)
    await enterGate()
    await login('2468')
    await back()
    await context.setOffline(false)
  })
  await check('Alternate adult entries require a PIN, mobile gate fits, and damaged storage fails closed', async () => {
    await writeSettings([{ key: 'profile', value: { profile_id: 'test-empty', code: 'P-99' } }, { key: 'vocabulary:test-empty', value: true }])
    await page.reload()
    await expect(board.locator('.board-empty')).toBeVisible()
    await board.locator('.board-empty').getByRole('button', { name: 'Umurezi', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'unlock')
    await expect(page.locator('.dash')).toHaveCount(0)
    await back()
    await writeSettings([{ key: 'profile', value: null }])
    await page.reload()
    await page.route('**/audio/**', route => route.fulfill({ status: 404, body: '' }))
    await board.locator('[data-symbol="WATER"]').click()
    await board.getByRole('button', { name: 'Vuga ubutumwa', exact: true }).click()
    await expect(board.locator('.audio-dialog')).toBeVisible()
    await board.locator('.audio-dialog').getByRole('button', { name: "Igenamiterere ry'ijwi", exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'unlock')
    await expect(page.locator('.dash')).toHaveCount(0)
    await login('2468')
    await expect(page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Ijwi', exact: true })).toHaveAttribute('aria-current', 'page')
    await back()
    await expect(draft()).toHaveCount(1)
    await page.unroute('**/audio/**')
    await page.setViewportSize({ width: 390, height: 844 })
    await enterGate()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await snapshot('parent-unlock-mobile')
    await back()
    await writeSettings([{ key: 'parent-access:v1', value: { version: 1, digest: 'broken' } }])
    await board.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(gate.getByRole('alert')).toContainText('Ntibyashobotse')
    await expect(gate.locator('input')).toHaveCount(0)
    await expect(page.locator('.dash')).toHaveCount(0)
    await back()
    await expect(board).toBeVisible()
  })
  expect(errors).toEqual([])
  await writeFile(`${output}/parent-access-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), baseURL, checks, screenshots, pageErrors: errors, total: checks.length, status: 'passed', note: 'Isolated test context; test PINs are disposable. Background event is simulated; idle clock is advanced. This local gate does not authenticate an adult identity or protect against browser-storage access.' }, null, 2))
  console.log(`Parent access: ${checks.length} checks passed`)
} catch (error) {
  await writeFile(`${output}/parent-access-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), baseURL, checks, screenshots, pageErrors: errors, total: checks.length, status: 'failed', error: error.message }, null, 2))
  throw error
} finally { await context.close(); await browser.close() }
