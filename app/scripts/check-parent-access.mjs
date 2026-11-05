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
// a lock after five wrong PINs, sessions that a new PIN ends, and each account's device backup,
// saved only on its latest revision. It starts with one account, 0780000001, whose PIN 8642
// differs from the first device's. It answers the app on port 8000 or 8001, whichever the build uses.
const API = /^http:\/\/(localhost|127\.0\.0\.1):800[01]\//
const accounts = new Map([['+250780000001', '8642']]), texts = [], copies = new Map(), wrongPins = new Map(), names = new Map()
const sessions = new Map(), uploads = [], deletedChildren = new Map(), deleteAfterSave = new Map()
const FIRST = '+250780000001'
const newPin = (phone, pin) => { accounts.set(phone, pin); sessions.set(phone, (sessions.get(phone) ?? 0) + 1) }
let accountCopy = null
// The server retains deletion records independently of an incoming copy. Saving an older
// device's copy cannot bring a deleted child back, even when it names the latest revision.
function withoutDeleted(data, deleted) {
  const gone = new Set(deleted)
  return { ...data,
    profiles: data.profiles.filter(child => !gone.has(child.profile_id)),
    vocabulary: data.vocabulary.filter(row => !gone.has(row.profile_id)),
    settings: data.settings.filter(({ key, value }) => key.includes(':') ? !gone.has(key.slice(key.indexOf(':') + 1))
      : key !== 'profile' || !value || !gone.has(value.profile_id)),
    ...(gone.size ? { deleted: [...gone].sort() } : {})
  }
}
function deleteOnOtherDevice(phone, childId) {
  const gone = new Set([...(deletedChildren.get(phone) ?? []), childId])
  deletedChildren.set(phone, gone)
  const copy = copies.get(phone)
  copies.set(phone, { ...copy, data: withoutDeleted(copy.data, gone), revision: copy.revision + 1, saved_at: new Date().toISOString() })
}
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
    return reply(202, { resend_after: 60, expires_in: 600, delivery: 'sms' })
  }
  if (path === '/auth/register') {
    const body = request.postDataJSON()
    // As the API: the caregiver's own name is required, its spaces tidied.
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ')
    if (!name || name.length > 120) return reply(422, { detail: 'name is required' })
    if (accounts.has(body.phone)) return reply(409, { detail: 'phone already registered' })
    if (!texted(body, 'register')) return reply(400, { detail: 'wrong code', reason: 'wrong', attempts_left: 4 })
    accounts.set(body.phone, body.pin)
    names.set(body.phone, name)
    return reply(201, { user_id: 'user-2', name, phone: body.phone, role: 'teacher' })
  }
  if (path === '/auth/reset-pin') {
    const body = request.postDataJSON()
    if (!accounts.has(body.phone)) return reply(404, { detail: 'no account for this number' })
    if (!texted(body, 'reset')) return reply(400, { detail: 'wrong code', reason: 'wrong', attempts_left: 4 })
    newPin(body.phone, body.pin)
    wrongPins.delete(body.phone)
    return route.fulfill({ status: 204, headers })
  }
  if (path === '/auth/change-pin') {
    const body = request.postDataJSON(), phone = `+250${body.phone.replace(/\D/g, '').slice(-9)}`
    const refused = signIn(phone, body.pin)
    if (refused) return refused
    newPin(phone, body.new_pin)
    return route.fulfill({ status: 204, headers })
  }
  // Erasing an account takes its PIN, counted like a sign-in, and ends every session it had.
  if (path === '/auth/delete-account') {
    const body = request.postDataJSON(), phone = `+250${body.phone.replace(/\D/g, '').slice(-9)}`
    const refused = signIn(phone, body.pin)
    if (refused) return refused
    accounts.delete(phone); names.delete(phone); copies.delete(phone); deletedChildren.delete(phone)
    sessions.set(phone, (sessions.get(phone) ?? 0) + 1)
    return route.fulfill({ status: 204, headers })
  }
  if (path === '/auth/login') {
    const phone = new URLSearchParams(request.postData()).get('username')
    return signIn(phone, new URLSearchParams(request.postData()).get('password'))
      ?? reply(200, { access_token: `token-${phone}-${sessions.get(phone) ?? 0}`, token_type: 'bearer' })
  }
  // A session opened before the account's PIN last changed is refused.
  const [, phone, session] = /^Bearer token-(\+\d+)-(\d+)$/.exec((await request.allHeaders()).authorization ?? '') ?? []
  if (!phone || Number(session) !== (sessions.get(phone) ?? 0)) return reply(401, { detail: 'invalid or expired token' })
  if (path === '/profiles') return reply(200, [])
  if (path === '/auth/me') return reply(200, { user_id: `user-${phone}`, name: names.get(phone) ?? '', phone, role: 'teacher' })
  const copy = copies.get(phone)
  const status = () => (copy ? { saved_at: copy.saved_at, size: 10, revision: copy.revision } : { saved_at: null, size: 0, revision: 0 })
  if (path === '/backup/status') return reply(200, status())
  if (path === '/backup' && request.method() === 'PUT') {
    const { base_revision, ...snapshot } = request.postDataJSON()
    if (base_revision !== (copy?.revision ?? 0)) return reply(409, { detail: 'the account copy changed on another device', revision: status().revision, saved_at: status().saved_at })
    const gone = new Set([...(deletedChildren.get(phone) ?? []), ...(snapshot.data.deleted ?? [])])
    deletedChildren.set(phone, gone)
    copies.set(phone, { ...snapshot, data: withoutDeleted(snapshot.data, gone), revision: base_revision + 1, saved_at: new Date().toISOString() })
    uploads.push({ phone, revision: base_revision + 1 })
    accountCopy = copies.get(FIRST) ?? null
    const written = { saved_at: copies.get(phone).saved_at, size: request.postData().length, revision: base_revision + 1 }
    // A second device deletes after this PUT commits but before the follow-up GET. The PUT
    // still returns its own revision; the next GET contains the newer canonical deletion.
    const deleteId = deleteAfterSave.get(phone)
    if (deleteId) { deleteAfterSave.delete(phone); deleteOnOtherDevice(phone, deleteId) }
    return reply(200, written)
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
async function writeDevice(tab, records) {
  await tab.evaluate(async rowsByStore => {
    const database = await new Promise(resolve => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result) })
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(Object.keys(rowsByStore), 'readwrite')
        for (const [name, rows] of Object.entries(rowsByStore)) for (const row of rows) transaction.objectStore(name).put(row)
        transaction.oncomplete = resolve; transaction.onerror = reject
      })
    } finally { database.close() }
  }, records)
}
const writeSettings = rows => writeDevice(page, { settings: rows })
async function readDevice(tab, tables) {
  return tab.evaluate(async names => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      return Object.fromEntries(await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const request = database.transaction(name).objectStore(name).getAll()
        request.onsuccess = () => resolve([name, request.result]); request.onerror = () => reject(request.error)
      }))))
    } finally { database.close() }
  }, tables)
}

try {
  await page.goto(baseURL)
  await check('Child can communicate before adult setup; setup can be dismissed without losing the message', async () => {
    await expect(board).toBeVisible()
    await board.locator('[data-symbol="WATER"]').click()
    await expect(draft()).toHaveCount(1)
    await enterGate('setup')
    await expect(gate.getByRole('heading', { level: 1 })).toHaveText('Konti y’umurezi')
    await snapshot('parent-first-setup')
    await back()
    await expect(draft()).toHaveCount(1)
    expect(await readCredential()).toBeUndefined()
  })
  await check('Adult must confirm a PIN; no profiles, settings, audio or export are mounted before success', async () => {
    await enterGate('setup')
    // Without an online account the PIN stays on this device, including offline.
    await gate.getByRole('button', { name: 'Komeza nta konti', exact: true }).click()
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
    const account = page.getByRole('region', { name: 'Konti y’umurezi', exact: true })
    await account.getByText('Ubundi buryo bwo kwinjira', { exact: true }).click()
    await account.getByRole('button', { name: 'Koresha konti ya nimero ya telefoni', exact: true }).click()
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
    expect(accountCopy?.format).toBe('vuga-account-backup-v2')
    // Children by code, their words and settings only: no names, photos or voices go to the account.
    expect(Object.keys(accountCopy.data).sort()).toEqual(['profiles', 'settings', 'vocabulary'])
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
    await expect(gate.getByRole('alert')).toContainText('Kode wanditse si yo')
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
      await phoneGate.getByText('Ubundi buryo bwo kwinjira', { exact: true }).click()
      await phoneGate.getByRole('button', { name: 'Koresha konti ya nimero ya telefoni', exact: true }).click()
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
    // A selected child missing from the profile store is stale cache, not a new child.
    await writeSettings([{ key: 'profile', value: { profile_id: 'test-empty', code: 'P-99' } }, { key: 'vocabulary:test-empty', value: true }])
    await page.reload()
    await expect(board.locator('.profile-code')).toHaveText('Igerageza')
    expect((await readDevice(page, ['settings'])).settings.find(row => row.key === 'profile').value).toBeNull()
    // The empty-board entry itself uses a real profile with an explicitly empty vocabulary.
    await writeDevice(page, { profiles: [{ profile_id: 'test-empty', code: 'P-99', local_only: true }],
      settings: [{ key: 'profile', value: { profile_id: 'test-empty', code: 'P-99' } }] })
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
      await tab.getByText('Ubundi buryo bwo kwinjira', { exact: true }).click()
      await tab.getByRole('button', { name: 'Koresha konti ya nimero ya telefoni', exact: true }).click()
      return [tab, tab.locator('.parent-access')]
    }
    await check('A caregiver opens an account at the first setup with the code texted to their number and the PIN they choose', async () => {
      const [tablet, setup] = await open(device)
      await expect(setup.getByRole('heading', { level: 1 })).toHaveText('Konti y’umurezi')
      const number = setup.getByRole('textbox', { name: /^Nimero ya telefoni/ })
      await number.fill('0748 123 456')
      expect(await number.evaluate(input => input.validationMessage)).toBe('Andika nimero ya telefoni igendanwa yo mu Rwanda, nka 0788 123 456.')
      await number.fill('+250 788 123 456')
      await setup.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
      await expect(setup.getByRole('status')).toHaveText('Twohereje kode y’imibare 6 kuri 0788 123 456. Imara iminota 10. Niba SMS itaje mu minota mike, saba indi kode.')
      expect(lastText()).toMatchObject({ phone: '+250788123456', purpose: 'register' })
      await expect(setup.getByRole('button', { name: /^Saba indi kode \(\d+\)$/ })).toBeDisabled()
      const fill = async (code, pin, again = pin, name = 'Uwase Ange') => {
        await setup.getByLabel('Kode twakoherereje', { exact: true }).fill(code)
        await setup.getByRole('textbox', { name: /^Izina ryawe \(umurezi\)/ }).fill(name)
        await setup.getByLabel('Hitamo umubare w’ibanga', { exact: true }).fill(pin)
        await setup.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill(again)
        await setup.getByRole('button', { name: 'Fungura konti', exact: true }).click()
      }
      // The caregiver's own name is required: spaces alone are not a name.
      await fill(lastText().code, '975310', '975310', '   ')
      await expect(setup.getByRole('alert')).toHaveText('Andika izina ryawe nk’umurezi, inyuguti zitarenze 120.')
      await fill(lastText().code, '975310', '975311')
      await expect(setup.getByRole('alert')).toContainText('ntihuye')
      await fill('999999', '975310')
      await expect(setup.getByRole('alert')).toContainText('Kode wanditse si yo')
      await tablet.screenshot({ path: `${output}/account-register-code.png`, animations: 'disabled' })
      screenshots.push('account-register-code.png')
      await fill(lastText().code, '975310')
      await expect(setup).toHaveAttribute('data-mode', 'recovery-code')
      await expect(setup.getByRole('status')).toContainText('gihujwe na konti ya 0788 123 456')
      await expect(setup.getByRole('status')).toContainText('byabitswe kuri konti')
      expect(accounts.get('+250788123456')).toBe('975310')
      expect(names.get('+250788123456')).toBe('Uwase Ange')
      await setup.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
      await expect(tablet.locator('.dash')).toBeVisible()
      // The account is signed in and keeps this device's copy.
      await tablet.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Ohereza', exact: true }).click()
      await expect(tablet.locator('.card').filter({ hasText: 'Winjiye nka Uwase Ange · 0788 123 456' })).toBeVisible()
      // The account area shows the caregiver's name with the number.
      await tablet.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Kwinjira', exact: true }).click()
      await expect(tablet.getByRole('region', { name: 'Konti y’umurezi', exact: true })).toContainText('konti ya Vuga ya Uwase Ange (0788 123 456)')
      await tablet.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Ohereza', exact: true }).click()
      expect(copies.get('+250788123456')?.format).toBe('vuga-account-backup-v2')
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
      await expect(setup.getByRole('status')).toHaveText('Twohereje kode y’imibare 6 kuri 0788 123 456. Imara iminota 10. Niba SMS itaje mu minota mike, saba indi kode.')
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
      const signIn = phone.locator('form.card').filter({ hasText: 'Konti ya Uwase Ange · 0788 123 456' })
      await signIn.getByLabel('Umubare w’ibanga', { exact: true }).fill('3579')
      await signIn.getByRole('button', { name: 'Injira', exact: true }).click()
      await expect(phone.locator('.card').filter({ hasText: 'Winjiye nka Uwase Ange · 0788 123 456' })).toBeVisible()
    })
    // Added on 3 November: the tablet above still holds the first copy and the session it opened
    // before the phone set a new PIN.
    await check('A device with an older account copy never replaces the newer one: it signs in again with the new PIN, sees what differs and keeps the account’s', async () => {
      const [tablet] = device.pages(), [phone] = other.pages()
      const tabs = tab => tab.getByRole('navigation', { name: 'Ibyiciro by’umurezi' })
      const setting = (tab, key) => tab.evaluate(async name => {
        const database = await new Promise((resolve, reject) => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
        try { return await new Promise((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get(name); request.onsuccess = () => resolve(request.result?.value ?? null); request.onerror = () => reject(request.error) }) }
        finally { database.close() }
      }, key)
      const openCaregiver = async (tab, pin) => {
        await tab.locator('.board:visible').getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
        await tab.keyboard.press('Enter')
        await tab.locator('.parent-access').getByLabel('Umubare w’ibanga', { exact: true }).fill(pin)
        await tab.locator('.parent-access').getByRole('button', { name: 'Injira', exact: true }).click()
        await expect(tab.locator('.dash')).toBeVisible()
      }
      const choosePlace = async (tab, name, pin) => {
        // The caregiver area may have locked itself while the other device was in use.
        if (!(await tab.locator('.dash').isVisible())) await openCaregiver(tab, pin)
        await tabs(tab).getByRole('button', { name: 'Aho umwana ari', exact: true }).click()
        await tab.getByRole('button', { name: new RegExp(`^${name}`) }).click()
        await expect(tab.locator('.dash-save-note')).toContainText(name)
        await tab.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
        await expect(tab.locator('.board:visible .place-status')).toHaveText(name)
      }
      const copy = () => copies.get('+250788123456')
      const first = copy().revision
      // The phone, signed in, saves a new place for the board.
      await choosePlace(phone, 'Igihe cyo kurya', '3579')
      await expect.poll(() => copy().revision).toBe(first + 1)
      // The tablet chooses another place; its save is refused because its session ended, and the
      // account keeps the phone's copy.
      await choosePlace(tablet, 'Ku ishuri', '975310')
      await expect.poll(() => setting(tablet, 'token')).toBeNull()
      expect(copy().revision).toBe(first + 1)
      expect(JSON.stringify(copy().data)).toContain('"environment":"meal"')
      // The tablet's own PIN still opens its caregiver area; the account then asks for its new PIN.
      await openCaregiver(tablet, '975310')
      await expect.poll(async () => (await setting(tablet, 'account'))?.stale).toBe(true)
      await tabs(tablet).getByRole('button', { name: 'Ohereza', exact: true }).click()
      const signIn = tablet.locator('form.card').filter({ hasText: 'Konti ya Uwase Ange · 0788 123 456' })
      await expect(signIn).toContainText('wahinduwe ku kindi gikoresho')
      await signIn.getByLabel('Umubare w’ibanga', { exact: true }).fill('3579')
      await signIn.getByRole('button', { name: 'Injira', exact: true }).click()
      await tablet.getByRole('button', { name: 'Nayibitse', exact: true }).click()
      // Both changed since the tablet's copy: it lists what differs, and nothing is replaced yet.
      const backup = tablet.getByRole('region', { name: 'Ibibitswe kuri konti', exact: true })
      await expect(backup.getByRole('list', { name: 'Ibitandukanye', exact: true })).toContainText('Igenamiterere rusange riratandukanye')
      await expect(backup.getByRole('button', { name: 'Bika ibyo kuri iki gikoresho kuri konti', exact: true })).toBeVisible()
      expect(copy().revision).toBe(first + 1)
      await tablet.locator('.card').filter({ has: backup }).screenshot({ path: `${output}/account-backup-choose.png`, animations: 'disabled' })
      screenshots.push('account-backup-choose.png')
      await backup.getByRole('button', { name: 'Garura ibyo kuri konti', exact: true }).click()
      await expect(backup.getByRole('status')).toContainText('byagaruwe kuri iki gikoresho')
      await tablet.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
      await expect(tablet.locator('.board:visible .place-status')).toHaveText('Igihe cyo kurya')
      expect(JSON.stringify(copy().data)).toContain('"environment":"meal"')
      expect(JSON.stringify(copy().data)).not.toContain('"environment":"school"')
    })
    await check('Remote deletion returned after replace, Save now or closing the caregiver area removes the active child and draft immediately, refreshes pending counts and survives reload', async () => {
      const [tablet] = device.pages(), accountNumber = '+250788123456'
      const tabBoard = tablet.locator('.board:visible')
      const tabs = tablet.getByRole('navigation', { name: 'Ibyiciro by’umurezi' })
      const backup = tablet.getByRole('region', { name: 'Ibibitswe kuri konti', exact: true })
      const goBack = () => tablet.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
      const local = async key => (await readDevice(tablet, ['settings'])).settings.find(row => row.key === key)?.value
      const openArea = async () => {
        if (await tablet.locator('.dash').isVisible()) return
        await tabBoard.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
        await tablet.keyboard.press('Enter')
        const gate = tablet.locator('.parent-access')
        await gate.getByLabel('Umubare w’ibanga', { exact: true }).fill('3579')
        await gate.getByRole('button', { name: 'Injira', exact: true }).click()
        await expect(tablet.locator('.dash')).toBeVisible()
      }
      for (const [index, action] of ['replace', 'save', 'close'].entries()) {
        // Start from the account's latest revision, then create and save a disposable child.
        await openArea()
        await tabs.getByRole('button', { name: 'Ohereza', exact: true }).click()
        await expect(backup.getByRole('button', { name: 'Garura ibyo kuri konti', exact: true })).toBeEnabled()
        await backup.getByRole('button', { name: 'Garura ibyo kuri konti', exact: true }).click()
        await expect(backup.getByRole('status')).toContainText('byagaruwe kuri iki gikoresho')
        await tabs.getByRole('button', { name: 'Abana', exact: true }).click()
        await tablet.locator('.dash-add-profile').click()
        const code = `P-${71 + index}`, form = tablet.getByRole('dialog', { name: 'Ongeramo umwirondoro' })
        await form.getByLabel('Izina cyangwa kode y’umwana').fill(code)
        await form.getByRole('button', { name: 'Bika umwirondoro', exact: true }).click()
        await expect(tablet.locator('.dash-device-status')).toContainText(code)
        const child = (await readDevice(tablet, ['profiles'])).profiles.find(row => row.code === code)
        const baseRevision = copies.get(accountNumber).revision
        await goBack()
        await expect(tabBoard.locator('.profile-code')).toHaveText(code)
        await expect.poll(async () => (await local('account-backup'))?.revision).toBe(baseRevision + 1)
        expect(copies.get(accountNumber).data.profiles.some(row => row.profile_id === child.profile_id)).toBe(true)
        await tabBoard.locator('.symbol-grid .symbol-tile').first().click()
        await expect(tabBoard.locator('.message-chip')).toHaveCount(1)
        await expect.poll(async () => (await readDevice(tablet, ['messages'])).messages.filter(row => row.profile_id === child.profile_id).length).toBe(1)
        // A completed, pending message as well as the real UI draft checks the sync counter.
        await writeDevice(tablet, { messages: [{ message_id: `pending-${action}`, profile_id: child.profile_id,
          board_mode: 'predictive', started_at: '2026-11-05T10:00:00Z', spoken_at: '2026-11-05T10:00:01Z', tap_count: 1, duration_ms: 1000, synced: 0 }] })
        await openArea()
        if (action === 'save') {
          await tabs.getByRole('button', { name: 'Ohereza', exact: true }).click()
          await expect(backup.getByRole('button', { name: 'Bika ubu', exact: true })).toBeEnabled()
          await expect(tablet.locator('.big')).toHaveText('1ubutumwa bwarangiye butaroherezwa')
          // A second local tab can edit storage while Ohereza remains open. Make this copy
          // dirty without triggering its automatic connect, then press the actual Save button.
          await writeDevice(tablet, { settings: [{ key: `appearance:${child.profile_id}`, value: { showLabels: false } }] })
          deleteAfterSave.set(accountNumber, child.profile_id)
          await backup.getByRole('button', { name: 'Bika ubu', exact: true }).click()
        } else {
          await tabs.getByRole('button', { name: 'Amashusho', exact: true }).click()
          const checkbox = tablet.locator('.dash-vocab-tile input[type=checkbox]').first()
          await expect(checkbox).toBeChecked()
          // This controlled input changes only after the IndexedDB transaction commits.
          // uncheck() asserts immediately after the click; wait for the persisted UI state.
          await checkbox.click()
          await expect(checkbox).not.toBeChecked()
          await expect(tablet.locator('.dash-save-note')).toHaveText('Bibitswe kuri iki gikoresho')
          if (action === 'replace') {
            deleteOnOtherDevice(accountNumber, child.profile_id)
            await tabs.getByRole('button', { name: 'Ohereza', exact: true }).click()
            const replace = backup.getByRole('button', { name: 'Bika ibyo kuri iki gikoresho kuri konti', exact: true })
            await expect(replace).toBeEnabled()
            await expect(tablet.locator('.big')).toHaveText('1ubutumwa bwarangiye butaroherezwa')
            tablet.once('dialog', dialog => dialog.accept())
            await replace.click()
          } else {
            deleteAfterSave.set(accountNumber, child.profile_id)
            await goBack()
          }
        }
        if (action !== 'close') {
          await expect(backup.getByRole('status')).toContainText('Abana 1 basibwe ku kindi gikoresho')
          await expect(tablet.locator('.dash-device-status')).toContainText('Igerageza')
          await expect(tablet.locator('.big')).toHaveText('0ubutumwa bwarangiye butaroherezwa')
          await goBack()
        }
        await expect(tabBoard.locator('.profile-code')).toHaveText('Igerageza')
        await expect(tabBoard.locator('.message-chip')).toHaveCount(0)
        const remaining = await readDevice(tablet, ['profiles', 'messages', 'tap_events'])
        expect(remaining.profiles.some(row => row.profile_id === child.profile_id)).toBe(false)
        expect(remaining.messages.some(row => row.profile_id === child.profile_id)).toBe(false)
        expect(remaining.tap_events.every(row => remaining.messages.some(message => message.message_id === row.message_id))).toBe(true)
        // The remounted board writes a new draft only for the demo profile, never the removed id.
        await tabBoard.locator('.symbol-grid .symbol-tile').first().click()
        await expect.poll(async () => (await readDevice(tablet, ['messages'])).messages.some(row => row.profile_id === 'demo')).toBe(true)
        expect((await readDevice(tablet, ['messages'])).messages.some(row => row.profile_id === child.profile_id)).toBe(false)
        await tablet.reload()
        await expect(tabBoard.locator('.profile-code')).toHaveText('Igerageza')
        expect((await readDevice(tablet, ['profiles'])).profiles.some(row => row.profile_id === child.profile_id)).toBe(false)
      }
    })
    // Added on 4 November 2026, last again.
    await check('“Siba konti yanjye” in Kwinjira says what goes and what stays, asks again with the PIN, and only a server that erased the account clears this device’s link; the other device’s session ends', async () => {
      const [tablet] = device.pages(), [phone] = other.pages()
      const local = (tab, key) => tab.evaluate(async name => {
        const database = await new Promise((resolve, reject) => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
        try { return await new Promise((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get(name); request.onsuccess = () => resolve(request.result?.value ?? null); request.onerror = () => reject(request.error) }) }
        finally { database.close() }
      }, key)
      const openArea = async (tab, pin) => {
        if (await tab.locator('.dash').isVisible()) return
        await tab.locator('.board:visible').getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
        await tab.keyboard.press('Enter')
        await tab.locator('.parent-access').getByLabel('Umubare w’ibanga', { exact: true }).fill(pin)
        await tab.locator('.parent-access').getByRole('button', { name: 'Injira', exact: true }).click()
        await expect(tab.locator('.dash')).toBeVisible()
      }
      await openArea(tablet, '3579')
      await tablet.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Kwinjira', exact: true }).click()
      const erase = tablet.getByRole('form', { name: 'Siba konti yanjye', exact: true })
      await expect(erase).toContainText('Bisibwa burundu kuri seriveri')
      await expect(erase).toContainText('Biguma kuri iki gikoresho')
      const start = erase.getByRole('button', { name: 'Siba konti yanjye', exact: true })
      const pinField = erase.getByLabel('Umubare w’ibanga wa konti', { exact: true })
      const confirmErase = erase.getByRole('button', { name: 'Siba konti burundu', exact: true })
      const linked = async () => {
        expect(accounts.has('+250788123456')).toBe(true)
        expect(await local(tablet, 'token')).not.toBeNull()
        expect(await local(tablet, 'account')).toMatchObject({ phone: '+250788123456' })
      }
      // Asked first, and Reka keeps the account.
      await start.click()
      await expect(erase.getByRole('status')).toHaveText('Urashaka koko gusiba konti ya Uwase Ange (0788 123 456)? Ntibishobora gusubizwa inyuma. Bisaba interineti.')
      await tablet.screenshot({ path: `${output}/account-delete-confirm.png`, animations: 'disabled', fullPage: true })
      screenshots.push('account-delete-confirm.png')
      await erase.getByRole('button', { name: 'Reka, gumana konti', exact: true }).click()
      await expect(pinField).toHaveCount(0)
      await linked()
      // A wrong PIN, or no internet: nothing is erased or forgotten.
      await start.click()
      await pinField.fill('1111')
      await confirmErase.click()
      await expect(erase.getByRole('alert')).toContainText('si byo')
      await linked()
      await device.setOffline(true)
      await pinField.fill('3579')
      await confirmErase.click()
      await expect(erase.getByRole('alert')).toContainText('Nta interineti')
      await device.setOffline(false)
      await linked()
      // The right PIN: the account is erased on the server, then this device forgets it.
      await pinField.fill('3579')
      await confirmErase.click()
      await expect(tablet.getByRole('region', { name: 'Konti y’umurezi', exact: true }).getByRole('status')).toContainText('yasibwe kuri seriveri')
      expect(accounts.has('+250788123456')).toBe(false)
      expect(copies.has('+250788123456')).toBe(false)
      expect(await local(tablet, 'token')).toBeNull()
      expect(await local(tablet, 'account')).toBeNull()
      expect(await local(tablet, 'account-backup')).toBeNull()
      await expect(erase).toHaveCount(0)
      // This device's own PIN still opens its caregiver area.
      await tablet.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click()
      await openArea(tablet, '3579')
      // The phone's session is refused: it is asked to sign in again, and its token is gone.
      await openArea(phone, '3579')
      await phone.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Ohereza', exact: true }).click()
      await expect(phone.locator('form.card').filter({ hasText: 'Injira' })).toBeVisible()
      await expect.poll(() => local(phone, 'token')).toBeNull()
    })
  } finally { await device.close(); await other.close() }
  expect(errors).toEqual([])
  await writeFile(`${output}/parent-access-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), baseURL, checks, screenshots, pageErrors: errors, total: checks.length, status: 'passed', note: 'Isolated test context; test PINs are disposable. Background event is simulated; idle clock is advanced. This local gate does not authenticate an adult identity or protect against browser-storage access.' }, null, 2))
  console.log(`Parent access: ${checks.length} checks passed`)
} catch (error) {
  await writeFile(`${output}/parent-access-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), baseURL, checks, screenshots, pageErrors: errors, total: checks.length, status: 'failed', error: error.message }, null, 2))
  throw error
} finally { await context.close(); await browser.close() }
