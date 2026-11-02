import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
const output = process.env.VUGA_EVIDENCE_DIR || fileURLToPath(new URL('../../docs/screenshots/final-2026-10-22/', import.meta.url))
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
const field = name => gate.getByLabel(name, { exact: true })
const CODE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/
let recovery = ''
// The Vuga API, faked in the browser: accounts by mobile number with one PIN, the codes it texts,
// a lock after five wrong PINs, and each account's device backup. It starts with one account,
// 0780000001, whose PIN 8642 differs from the first device's. It answers the app on port 8000 or
// 8001, whichever the build uses.
const API = /^http:\/\/(localhost|127\.0\.0\.1):800[01]\//
const accounts = new Map([['+250780000001', '8642']]), texts = [], copies = new Map(), wrongPins = new Map()
const FIRST = 'token-+250780000001'
let accountCopy = null
async function fakeApi(route) {
  const request = route.request(), path = new URL(request.url()).pathname
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const reply = (status, body) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const texted = ({ phone, code }, purpose) => texts.findLast(text => text.phone === phone && text.purpose === purpose)?.code === code
  // A right PIN clears the count; the fifth wrong one locks the number.
  const signIn = (phone, pin) => {
    if ((wrongPins.get(phone) ?? 0) >= 5) return reply(429, { detail: 'too many wrong PINs', retry_after: 900 })
    if (accounts.get(phone) === pin) { wrongPins.delete(phone); return null }
    if (!accounts.has(phone)) return reply(401, { detail: 'wrong phone or PIN' })
    wrongPins.set(phone, (wrongPins.get(phone) ?? 0) + 1)
    return wrongPins.get(phone) >= 5 ? reply(429, { detail: 'too many wrong PINs', retry_after: 900 }) : reply(401, { detail: 'wrong phone or PIN' })
  }
  if (path === '/auth/code') {
    const { phone, purpose } = request.postDataJSON()
    if (purpose === 'register' && accounts.has(phone)) return reply(409, { detail: 'phone already registered' })
    if (purpose === 'reset' && !accounts.has(phone)) return reply(404, { detail: 'no account for this number' })
    texts.push({ phone, purpose, code: String(482100 + texts.length) })
    return reply(202, { resend_after: 60, expires_in: 600 })
  }
  if (path === '/auth/register') {
    const body = request.postDataJSON()
    if (accounts.has(body.phone)) return reply(409, { detail: 'phone already registered' })
    if (!texted(body, 'register')) return reply(400, { detail: 'wrong or expired code' })
    accounts.set(body.phone, body.pin)
    return reply(201, { user_id: 'user-2', name: body.name, phone: body.phone, role: 'teacher' })
  }
  if (path === '/auth/reset-pin') {
    const body = request.postDataJSON()
    if (!accounts.has(body.phone)) return reply(404, { detail: 'no account for this number' })
    if (!texted(body, 'reset')) return reply(400, { detail: 'wrong or expired code' })
    accounts.set(body.phone, body.pin)
    wrongPins.delete(body.phone)
    return route.fulfill({ status: 204, headers })
  }
  if (path === '/auth/change-pin') {
    const body = request.postDataJSON(), phone = `+250${body.phone.replace(/\D/g, '').slice(-9)}`
    const refused = signIn(phone, body.pin)
    if (refused) return refused
    accounts.set(phone, body.new_pin)
    return route.fulfill({ status: 204, headers })
  }
  if (path === '/auth/login') {
    const form = new URLSearchParams(request.postData())
    return signIn(form.get('username'), form.get('password')) ?? reply(200, { access_token: `token-${form.get('username')}`, token_type: 'bearer' })
  }
  const token = (await request.allHeaders()).authorization?.replace('Bearer ', '')
  if (path === '/profiles') return reply(200, [])
  const copy = copies.get(token)
  if (path === '/backup/status') return reply(200, copy ? { saved_at: copy.saved_at, size: 10 } : { saved_at: null, size: 0 })
  if (path === '/backup' && request.method() === 'PUT') {
    copies.set(token, { ...request.postDataJSON(), saved_at: new Date().toISOString() })
    accountCopy = copies.get(FIRST) ?? null
    return reply(200, { saved_at: copies.get(token).saved_at, size: request.postData().length })
  }
  if (path === '/backup') return copy ? reply(200, copy) : reply(404, { detail: 'no backup on this account' })
  return reply(404, {})
}
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
    // Without a number the PIN stays on this device, as when there is no internet.
    await gate.getByRole('button', { name: 'Komeza nta nimero', exact: true }).click()
    await pin().fill('482619')
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('482618')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('ntihuye')
    expect(await readCredential()).toBeUndefined()
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('482619')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    await expect(page.locator('.dash')).toHaveCount(0)
    recovery = (await gate.locator('.parent-recovery-code').textContent()).trim()
    expect(recovery).toMatch(CODE)
    await snapshot('parent-recovery-code')
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
    await expect(page.locator('.dash')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button')).toHaveCount(11)
    const credential = await readCredential()
    expect(credential.value.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(credential)).not.toContain('482619')
    expect(JSON.stringify(credential)).not.toContain(recovery.replaceAll('-', ''))
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
    const form = page.locator('.parent-settings').getByRole('form', { name: 'Hindura umubare w’ibanga', exact: true })
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
  await check('A forgotten PIN is replaced with the written-down recovery code; the child’s message stays', async () => {
    await enterGate()
    await gate.getByRole('button', { name: 'Nibagiwe umubare w’ibanga', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'forgot')
    await expect(gate.locator('.parent-ways')).toHaveCount(0)
    const recover = async code => {
      await field('Kode yo kugarura').fill(code)
      await field('Umubare w’ibanga mushya').fill('1357')
      await field('Ongera wandike umubare w’ibanga mushya').fill('1357')
      await gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
    }
    await recover('AAAA-BBBB-CCCC-DDDD')
    await expect(gate.getByRole('alert')).toContainText('Kode yo kugarura si yo')
    await recover(recovery.toLowerCase())
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    const next = (await gate.locator('.parent-recovery-code').textContent()).trim()
    expect(next).toMatch(CODE)
    expect(next).not.toBe(recovery)
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
    await expect(page.locator('.dash')).toBeVisible()
    await back()
    await expect(draft()).toHaveCount(1)
    await enterGate()
    await pin().fill('2468')
    await gate.getByRole('button', { name: 'Injira', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('si wo')
    await login('1357')
    await back()
  })
  await check('Kwinjira links the device to the caregiver’s number and takes the account’s PIN; a forgotten PIN is then replaced with a texted code', async () => {
    await context.route(API, fakeApi)
    await enterGate()
    await login('1357')
    await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Kwinjira', exact: true }).click()
    const account = page.getByRole('region', { name: 'Nimero ya telefoni', exact: true })
    await account.getByRole('textbox', { name: /^Nimero ya telefoni/ }).fill('0780000001')
    await account.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
    // The number has an account: its PIN, not this device's, signs in and becomes the device's.
    await expect(account.getByRole('status')).toContainText('isanzwe ifite konti ya Vuga')
    await account.getByLabel('Umubare w’ibanga wa konti', { exact: true }).fill('1357')
    await account.getByRole('button', { name: 'Injira', exact: true }).click()
    await expect(account.getByRole('alert')).toContainText('si byo')
    await account.getByLabel('Umubare w’ibanga wa konti', { exact: true }).fill('8642')
    await account.getByRole('button', { name: 'Injira', exact: true }).click()
    await expect(account.locator('.parent-recovery-code')).toHaveText(CODE)
    await expect(account.getByRole('status')).toContainText('byabitswe kuri konti')
    expect(accountCopy?.format).toBe('vuga-account-backup-v1')
    await account.getByRole('button', { name: 'Nayibitse', exact: true }).click()
    await expect(account).toContainText('0780 000 001')
    await back()
    await enterGate()
    await pin().fill('1357')
    await gate.getByRole('button', { name: 'Injira', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('si wo')
    await login('8642')
    await back()
    // Forgotten: a code texted to the account's number sets the new PIN on the device and the account.
    await enterGate()
    await gate.getByRole('button', { name: 'Nibagiwe umubare w’ibanga', exact: true }).click()
    await gate.getByRole('button', { name: 'Konti ya Vuga', exact: true }).click()
    await expect(gate).toContainText('•••••••001')
    await gate.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
    expect(texts.at(-1)).toMatchObject({ phone: '+250780000001', purpose: 'reset' })
    const reset = async code => {
      await field('Kode twakoherereje').fill(code)
      await field('Umubare w’ibanga mushya').fill('2468')
      await field('Ongera wandike umubare w’ibanga mushya').fill('2468')
      await gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
    }
    await reset('999999')
    await expect(gate.getByRole('alert')).toContainText('Kode si yo')
    await snapshot('parent-forgot-account')
    await reset(texts.at(-1).code)
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    expect(accounts.get('+250780000001')).toBe('2468')
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
    await expect(page.locator('.dash')).toBeVisible()
    await back()
    await enterGate()
    await login('2468')
  })
  await check('A new device that signs in to the account gets the caregiver’s settings back', async () => {
    await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Aho umwana ari', exact: true }).click()
    await page.getByRole('button', { name: /^Igihe cyo kurya/ }).click()
    await expect(page.locator('.dash-save-note')).toContainText('Igihe cyo kurya')
    await back()
    await expect.poll(() => JSON.stringify(accountCopy?.data ?? {})).toContain('"environment":"meal"')
    const device = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    try {
      await device.route(API, fakeApi)
      const phone = await device.newPage()
      phone.on('pageerror', error => errors.push(error.message))
      await phone.goto(baseURL)
      const phoneBoard = phone.locator('.board:visible'), phoneGate = phone.locator('.parent-access')
      await expect(phoneBoard.locator('.place-status')).toHaveCount(0)
      await phoneBoard.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
      await phone.keyboard.press('Enter')
      await expect(phoneGate).toHaveAttribute('data-mode', 'setup')
      await phoneGate.getByRole('textbox', { name: /^Nimero ya telefoni/ }).fill('0780 000 001')
      await phoneGate.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
      await phoneGate.getByLabel('Umubare w’ibanga wa konti', { exact: true }).fill('2468')
      await phoneGate.getByRole('button', { name: 'Injira', exact: true }).click()
      await expect(phoneGate).toHaveAttribute('data-mode', 'recovery-code')
      await expect(phoneGate.getByRole('status')).toContainText('byagarutse kuri iki gikoresho')
      await phone.screenshot({ path: output + '/parent-new-device-restored.png', animations: 'disabled' })
      screenshots.push('parent-new-device-restored.png')
      await phoneGate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
      await expect(phone.locator('.dash')).toBeVisible()
      await phone.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
      await expect(phoneBoard.locator('.place-status')).toHaveText('Igihe cyo kurya')
      expect(await phoneBoard.locator('.symbol-grid .symbol-tile').first().getAttribute('data-symbol')).toBe('MUM')
    } finally { await device.close() }
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
  // Added after the 22 October run, last so that the check numbers the reports cite stay the same.
  // Two more new devices: a caregiver who opens an account at the first setup, then the same
  // caregiver on another device who has forgotten the PIN.
  const device = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  try {
    await device.route(API, fakeApi)
    await other.route(API, fakeApi)
    const lastText = () => texts.at(-1)
    const open = async context => {
      const tab = await context.newPage()
      tab.on('pageerror', error => errors.push(error.message))
      await tab.goto(baseURL)
      await tab.locator('.board:visible').getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
      await tab.keyboard.press('Enter')
      await expect(tab.locator('.parent-access')).toHaveAttribute('data-mode', 'setup')
      return [tab, tab.locator('.parent-access')]
    }
    await check('A caregiver opens an account at the first setup with the code texted to their number and the PIN they choose', async () => {
      const [tablet, setup] = await open(device)
      await expect(setup.getByRole('heading', { level: 1 })).toHaveText('Shyiraho konti y’umurezi.')
      const number = setup.getByRole('textbox', { name: /^Nimero ya telefoni/ })
      await number.fill('0748 123 456')
      expect(await number.evaluate(input => input.validationMessage)).toBe('Andika nimero ya telefoni igendanwa yo mu Rwanda, nka 0788 123 456.')
      await number.fill('+250 788 123 456')
      await setup.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
      await expect(setup.getByRole('status')).toHaveText('Twohereje kode y’imibare 6 kuri 0788 123 456. Imara iminota 10.')
      expect(lastText()).toMatchObject({ phone: '+250788123456', purpose: 'register' })
      await expect(setup.getByRole('button', { name: /^Saba indi kode \(\d+\)$/ })).toBeDisabled()
      const fill = async (code, pin, again = pin) => {
        await setup.getByLabel('Kode twakoherereje', { exact: true }).fill(code)
        await setup.getByLabel('Hitamo umubare w’ibanga', { exact: true }).fill(pin)
        await setup.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill(again)
        await setup.getByRole('button', { name: 'Fungura konti', exact: true }).click()
      }
      await fill(lastText().code, '975310', '975311')
      await expect(setup.getByRole('alert')).toContainText('ntihuye')
      await fill('999999', '975310')
      await expect(setup.getByRole('alert')).toContainText('Kode si yo')
      await tablet.screenshot({ path: `${output}/account-register-code.png`, animations: 'disabled' })
      screenshots.push('account-register-code.png')
      await fill(lastText().code, '975310')
      await expect(setup).toHaveAttribute('data-mode', 'recovery-code')
      await expect(setup.getByRole('status')).toContainText('gihujwe na konti ya 0788 123 456')
      await expect(setup.getByRole('status')).toContainText('byabitswe kuri konti')
      expect(accounts.get('+250788123456')).toBe('975310')
      await setup.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
      await expect(tablet.locator('.dash')).toBeVisible()
      // The account is signed in and keeps this device's copy.
      await tablet.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Ohereza', exact: true }).click()
      await expect(tablet.locator('.card').filter({ hasText: 'Winjiye kuri iki gikoresho' })).toBeVisible()
      expect(copies.get('token-+250788123456')?.format).toBe('vuga-account-backup-v1')
      // Back on the board, the PIN opens the caregiver area again, on this device and without internet.
      await tablet.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
      await device.setOffline(true)
      await tablet.locator('.board:visible').getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
      await tablet.keyboard.press('Enter')
      await setup.getByLabel('Umubare w’ibanga', { exact: true }).fill('975310')
      await setup.getByRole('button', { name: 'Injira', exact: true }).click()
      await expect(tablet.locator('.dash')).toBeVisible()
      await device.setOffline(false)
    })
    await check('On another new device the number signs in with its PIN; wrong PINs lock it, and a texted code sets a new PIN', async () => {
      const [phone, setup] = await open(other)
      await setup.getByRole('textbox', { name: /^Nimero ya telefoni/ }).fill('0788123456')
      await setup.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
      await expect(setup.getByRole('status')).toHaveText('Nimero 0788 123 456 isanzwe ifite konti ya Vuga. Andika umubare w’ibanga wayo kugira ngo iki gikoresho kiyihuze.')
      const pinField = setup.getByLabel('Umubare w’ibanga wa konti', { exact: true })
      for (let attempt = 1; attempt <= 5; attempt++) {
        await pinField.fill('1111')
        await setup.getByRole('button', { name: 'Injira', exact: true }).click()
        await expect(setup.getByRole('alert')).toContainText(attempt < 5 ? 'si byo' : 'inshuro eshanu')
      }
      await pinField.fill('975310')
      await setup.getByRole('button', { name: 'Injira', exact: true }).click()
      await expect(setup.getByRole('alert')).toContainText('Tegereza iminota 15')
      // The texted code proves the number, sets a new PIN and lifts the lock.
      await setup.getByRole('button', { name: 'Nibagiwe umubare w’ibanga', exact: true }).click()
      await expect(setup.getByRole('status')).toHaveText('Twohereje kode y’imibare 6 kuri 0788 123 456. Imara iminota 10.')
      expect(lastText()).toMatchObject({ phone: '+250788123456', purpose: 'reset' })
      await setup.getByLabel('Kode twakoherereje', { exact: true }).fill(lastText().code)
      await setup.getByLabel('Umubare w’ibanga mushya', { exact: true }).fill('864200')
      await setup.getByLabel('Ongera wandike umubare w’ibanga mushya', { exact: true }).fill('864200')
      await phone.screenshot({ path: `${output}/parent-forgot-account-sms.png`, animations: 'disabled' })
      screenshots.push('parent-forgot-account-sms.png')
      await setup.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
      await expect(setup).toHaveAttribute('data-mode', 'recovery-code')
      expect(accounts.get('+250788123456')).toBe('864200')
      await setup.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
      await expect(phone.locator('.dash')).toBeVisible()
      // Changing the PIN in Kwinjira changes the account's PIN too.
      await phone.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Kwinjira', exact: true }).click()
      const change = phone.getByRole('form', { name: 'Hindura umubare w’ibanga', exact: true })
      await change.getByLabel('Umubare w’ibanga usanzwe', { exact: true }).fill('864200')
      await change.getByLabel('Umubare w’ibanga mushya', { exact: true }).fill('3579')
      await change.getByLabel('Ongera wandike umubare w’ibanga mushya', { exact: true }).fill('3579')
      await change.getByRole('button', { name: 'Bika umubare mushya', exact: true }).click()
      await expect(change.getByRole('status')).toContainText('no kuri konti yawe')
      expect(accounts.get('+250788123456')).toBe('3579')
      // Signed out in Ohereza, the same PIN signs in again.
      await phone.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Ohereza', exact: true }).click()
      await phone.getByRole('button', { name: 'Sohoka', exact: true }).click()
      const signIn = phone.locator('form.card').filter({ hasText: 'Konti ya 0788 123 456' })
      await signIn.getByLabel('Umubare w’ibanga', { exact: true }).fill('3579')
      await signIn.getByRole('button', { name: 'Injira', exact: true }).click()
      await expect(phone.locator('.card').filter({ hasText: 'Winjiye kuri iki gikoresho' })).toBeVisible()
    })
  } finally { await device.close(); await other.close() }
  expect(errors).toEqual([])
  await writeFile(`${output}/parent-access-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), baseURL, checks, screenshots, pageErrors: errors, total: checks.length, status: 'passed', note: 'Isolated test context; test PINs are disposable. Background event is simulated; idle clock is advanced. This local gate does not authenticate an adult identity or protect against browser-storage access.' }, null, 2))
  console.log(`Parent access: ${checks.length} checks passed`)
} catch (error) {
  await writeFile(`${output}/parent-access-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), baseURL, checks, screenshots, pageErrors: errors, total: checks.length, status: 'failed', error: error.message }, null, 2))
  throw error
} finally { await context.close(); await browser.close() }
