// Production-build UI checks. Every provider and Vuga API request is intercepted;
// no messages are sent and no real account is created or removed.
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
const output = process.env.VUGA_EVIDENCE_DIR || fileURLToPath(new URL('../../docs/evidence/email-accounts-2026-11-05/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage(), checks = [], errors = [], buildAssets = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  const url = new URL(response.url())
  if (url.origin === new URL(baseURL).origin && /^\/assets\/index-.*\.(?:js|css)$/.test(url.pathname)) {
    buildAssets.push(response.body().then(body => ({ path: url.pathname, sha256: createHash('sha256').update(body).digest('hex') })))
  }
})
const identity = { localId: 'firebase-test-1', email: 'caregiver@example.test', displayName: 'Demo Caregiver', emailVerified: false }
const user = { user_id: 'vuga-email-1', name: 'Demo Caregiver', email: identity.email, phone: null, auth_provider: 'firebase', role: 'teacher' }
const secret = 'Test-password-48'
const counts = { signUp: 0, signInWithPassword: 0, VERIFY_EMAIL: 0, PASSWORD_RESET: 0, sessions: 0, delete: 0 }
let wrongIdentity = false, deleteFails = false, copy = null, finishPhoneCode = null
let verificationFails = false, verificationThrottled = false, holdVerification = false, finishVerification = null
const board = page.locator('.board:visible'), gate = page.locator('.parent-access')
const password = scope => scope.getByLabel('Ijambo ry’ibanga rya konti', { exact: true })
const localPin = () => gate.getByLabel('Umubare w’ibanga', { exact: true })
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) })
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === new URL(baseURL).origin) return route.continue()
  if (request.method() === 'OPTIONS') return json(route, 200, {})
  if (url.hostname === 'identitytoolkit.googleapis.com') {
    const action = url.pathname.split(':').at(-1), body = request.postDataJSON()
    if (action in counts) counts[action]++
    const credentials = { ...identity, idToken: 'mock-firebase-id-token', refreshToken: 'must-not-persist', expiresIn: '3600' }
    if (action === 'signUp') return json(route, 200, credentials)
    if (action === 'update') { identity.displayName = body.displayName; return json(route, 200, credentials) }
    if (action === 'signInWithPassword') return body.password === secret ? json(route, 200, credentials) : json(route, 400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } })
    if (action === 'lookup') return json(route, 200, { users: [identity] })
    if (action === 'sendOobCode') {
      counts[body.requestType]++
      if (body.requestType === 'VERIFY_EMAIL' && verificationThrottled) return json(route, 429, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } })
      if (body.requestType === 'VERIFY_EMAIL' && verificationFails) return json(route, 500, { error: { message: 'INTERNAL_ERROR' } })
      if (body.requestType === 'VERIFY_EMAIL' && holdVerification) return new Promise(resolve => {
        finishVerification = async () => { await json(route, 200, { email: identity.email }); resolve() }
      })
      return json(route, 200, { email: identity.email })
    }
    throw new Error(`Unexpected mocked provider action: ${action}`)
  }
  if (['localhost', '127.0.0.1'].includes(url.hostname) && ['8000', '8001'].includes(url.port)) {
    const path = url.pathname
    if (path === '/auth/code') return new Promise(resolve => {
      finishPhoneCode = async () => { await json(route, 202, { resend_after: 60, expires_in: 600, delivery: 'sms' }); resolve() }
    })
    if (path === '/auth/email/session') { counts.sessions++; return json(route, 200, { access_token: 'mock-firebase-id-token', token_type: 'bearer', user }) }
    if (path === '/auth/me') return json(route, 200, wrongIdentity ? { ...user, user_id: 'different-vuga-user' } : user)
    if (path === '/auth/email/delete-account') { counts.delete++; return deleteFails ? json(route, 503, { detail: 'provider timeout' }) : json(route, 200, { deleted: true }) }
    if (path === '/health') return json(route, 200, { status: 'ok', model_loaded: true, email: true })
    if (path === '/profiles' || path === '/symbols') return json(route, 200, [])
    if (path === '/backup/status') return json(route, 200, { exists: !!copy, revision: copy?.revision || 0, saved_at: copy?.saved_at || null })
    if (path === '/backup' && request.method() === 'PUT') {
      copy = { ...request.postDataJSON(), revision: (copy?.revision || 0) + 1, saved_at: new Date().toISOString() }
      return json(route, 200, { saved_at: copy.saved_at, revision: copy.revision })
    }
    if (path === '/backup') return copy ? json(route, 200, copy) : json(route, 404, {})
    return json(route, 404, { detail: 'no mock endpoint' })
  }
  // Fail closed: no unexpected external service may receive credentials or a test request.
  return route.abort()
})
async function data() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return Object.fromEntries(await Promise.all(['settings', 'profiles'].map(name => new Promise(resolve => {
      const request = database.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve([name, request.result])
    })))) } finally { database.close() }
  })
}
const setting = (state, key) => state.settings.find(row => row.key === key)?.value
async function enter() {
  await board.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter'); await expect(gate).toBeVisible()
}
async function back() { await page.getByRole('button', { name: 'Subira ku kibaho', exact: true }).first().click(); await expect(board).toBeVisible() }
async function settings() { await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi' }).getByRole('button', { name: 'Kwinjira', exact: true }).click() }
async function unlock(pin) { await enter(); await localPin().fill(pin); await gate.getByRole('button', { name: 'Injira', exact: true }).click(); await expect(page.locator('.dash')).toBeVisible() }
async function check(name, run) { await run(); checks.push({ name, status: 'passed' }); console.log(`PASS ${checks.length}: ${name}`) }
async function responsiveScreenshots(name) {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await gate.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: `${output}/email-${name}-${width}.png`, animations: 'disabled', fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}
async function signInFields() {
  await password(gate).fill(secret)
  await gate.getByLabel('Hitamo umubare', { exact: true }).fill('4826')
  await gate.getByLabel('Ongera uwandike', { exact: true }).fill('4826')
}
const resendButton = () => gate.getByRole('button', { name: /^Ongera wohereze email(?: \(\d+s\))?$/ })
let initialPin, recoveredPin
try {
  await page.clock.install()
  await page.goto(baseURL); await expect(board).toBeVisible(); await enter()
  await page.setViewportSize({ width: 1280, height: 1050 })
  await page.screenshot({ path: `${output}/email-signup-desktop.png`, animations: 'disabled', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await check('Signup password visibility is explicit, accessible and off by default', async () => {
    const field = password(gate)
    const show = gate.getByRole('button', { name: 'Erekana: Ijambo ry’ibanga rya konti', exact: true })
    await expect(field).toHaveAttribute('type', 'password'); await expect(show).toHaveAttribute('aria-pressed', 'false')
    await field.fill(secret); await show.click()
    const hide = gate.getByRole('button', { name: 'Hisha: Ijambo ry’ibanga rya konti', exact: true })
    await expect(field).toHaveAttribute('type', 'text'); await expect(hide).toHaveAttribute('aria-pressed', 'true')
    await hide.click(); await expect(field).toHaveAttribute('type', 'password')
    expect(counts.signUp).toBe(0)
  })
  await check('Email signup is default; password confirmation prevents an invalid provider request', async () => {
    await gate.getByLabel('Email', { exact: true }).fill(identity.email)
    await gate.getByLabel(/^Izina ryawe/).fill(identity.displayName)
    await password(gate).fill(secret)
    await gate.getByLabel('Ongera wandike ijambo ry’ibanga rya konti', { exact: true }).fill('Wrong-password')
    await responsiveScreenshots('signup')
    await gate.getByRole('button', { name: 'Fungura konti ukoresheje email', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('ntahuye'); expect(counts.signUp).toBe(0)
  })
  await check('Signup sends one verification message into a separate waiting panel that fits narrow screens', async () => {
    await gate.getByLabel('Ongera wandike ijambo ry’ibanga rya konti', { exact: true }).fill(secret)
    await gate.getByRole('button', { name: 'Fungura konti ukoresheje email', exact: true }).click()
    await expect(gate.getByRole('button', { name: 'Nemeje email, komeza', exact: true })).toBeVisible()
    await expect(gate.locator('input')).toHaveCount(0)
    expect(counts.VERIFY_EMAIL).toBe(1)
    const state = await data(); expect(setting(state, 'account')).toBeUndefined(); expect(setting(state, 'parent-access:v1')).toBeUndefined(); expect(counts.sessions).toBe(0)
    await responsiveScreenshots('verify')
  })
  await check('Verification resend waits for the cooldown without sending duplicate requests', async () => {
    await expect(resendButton()).toBeDisabled()
    await resendButton().evaluate(button => button.click())
    expect(counts.VERIFY_EMAIL).toBe(1)
    await page.clock.fastForward(20_000)
    await expect(resendButton()).toBeDisabled(); expect(counts.VERIFY_EMAIL).toBe(1)
  })
  await check('Continue opens a compact login; an unverified email still creates neither a Vuga session nor local PIN', async () => {
    await gate.getByRole('button', { name: 'Nemeje email, komeza', exact: true }).click()
    await expect(gate.getByLabel('Email', { exact: true })).toHaveValue(identity.email)
    await signInFields(); await responsiveScreenshots('login')
    await gate.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('Banza')
    await expect(gate.getByRole('button', { name: 'Nemeje email, komeza', exact: true })).toBeVisible()
    await expect(gate.locator('input')).toHaveCount(0)
    const state = await data(); expect(setting(state, 'account')).toBeUndefined(); expect(setting(state, 'parent-access:v1')).toBeUndefined(); expect(counts.sessions).toBe(0)
  })
  await check('Provider throttling shows the retry countdown and suppresses further requests until the wait ends', async () => {
    await page.clock.fastForward(61_000)
    await expect(resendButton()).toBeEnabled(); await resendButton().click()
    verificationThrottled = true; await password(gate).fill(secret)
    await gate.getByRole('button', { name: 'Ohereza indi email', exact: true }).click()
    const waiting = gate.getByRole('button', { name: /^Ohereza indi email \(\d+s\)$/ })
    await expect(waiting).toBeDisabled(); expect(counts.VERIFY_EMAIL).toBe(2)
    await password(gate).evaluate(input => input.form.requestSubmit())
    await page.clock.fastForward(20_000)
    await expect(waiting).toBeDisabled(); expect(counts.VERIFY_EMAIL).toBe(2)
    await page.clock.fastForward(61_000)
    await expect(gate.getByRole('button', { name: 'Ohereza indi email', exact: true })).toBeEnabled()
    verificationThrottled = false
  })
  await check('Resending requests only the account password; bad credentials and provider failure remain recoverable', async () => {
    await expect(password(gate)).toBeVisible(); await expect(gate.locator('input')).toHaveCount(1)
    await password(gate).fill('Wrong-password')
    await gate.getByRole('button', { name: 'Ohereza indi email', exact: true }).click()
    await expect(gate.getByRole('alert')).toBeVisible(); expect(counts.VERIFY_EMAIL).toBe(2)
    verificationFails = true; await password(gate).fill(secret)
    await gate.getByRole('button', { name: 'Ohereza indi email', exact: true }).click()
    await expect(gate.getByRole('alert')).toBeVisible(); expect(counts.VERIFY_EMAIL).toBe(3)
    await expect(gate.getByRole('button', { name: 'Ohereza indi email', exact: true })).toBeEnabled()
    verificationFails = false
  })
  await check('A pending resend cannot submit twice, and success starts a new cooldown', async () => {
    holdVerification = true; await password(gate).fill(secret)
    await gate.getByRole('button', { name: 'Ohereza indi email', exact: true }).click()
    await expect.poll(() => typeof finishVerification).toBe('function')
    await expect(password(gate)).toBeDisabled()
    await password(gate).evaluate(input => input.form.requestSubmit())
    expect(counts.VERIFY_EMAIL).toBe(4)
    await finishVerification(); holdVerification = false
    await expect(gate.getByRole('status')).toContainText('Twongeye')
    await expect(gate.locator('input')).toHaveCount(0); await expect(resendButton()).toBeDisabled()
    expect(counts.VERIFY_EMAIL).toBe(4); expect(counts.sessions).toBe(0)
  })
  await check('An already verified email switches back to login without another verification message', async () => {
    identity.emailVerified = true
    await page.clock.fastForward(61_000); await resendButton().click(); await password(gate).fill(secret)
    await gate.getByRole('button', { name: 'Ohereza indi email', exact: true }).click()
    await expect(gate.getByRole('button', { name: 'Injira muri konti', exact: true })).toBeVisible()
    await expect(password(gate)).toHaveValue('')
    expect(counts.VERIFY_EMAIL).toBe(4); expect(counts.sessions).toBe(0)
  })
  await check('Forgot-password opens an email-only reset form and returns to login without changing the device PIN', async () => {
    await gate.getByRole('button', { name: 'Nibagiwe ijambo ry’ibanga', exact: true }).click()
    await expect(gate.getByLabel('Email', { exact: true })).toHaveValue(identity.email)
    await expect(gate.locator('input')).toHaveCount(1)
    await gate.getByRole('button', { name: 'Ohereza ihuza', exact: true }).click()
    await expect(gate.getByRole('status')).toContainText('Niba iyi email ifite konti')
    expect(counts.PASSWORD_RESET).toBe(1); expect(setting(await data(), 'parent-access:v1')).toBeUndefined()
    await gate.getByRole('button', { name: 'Subira kwinjira', exact: true }).click()
    await expect(gate.getByRole('button', { name: 'Injira muri konti', exact: true })).toBeVisible()
    await expect(password(gate)).toHaveValue('')
  })
  await check('Verified email login stores account identity and a separate hashed local PIN, never password or refresh token', async () => {
    await signInFields()
    await gate.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    const state = await data(); initialPin = setting(state, 'parent-access:v1')
    expect(setting(state, 'account')).toMatchObject({ email: identity.email, user_id: user.user_id, auth_provider: 'firebase' })
    expect(initialPin.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(state)).not.toContain(secret); expect(JSON.stringify(state)).not.toContain('must-not-persist')
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click(); await expect(page.locator('.dash')).toBeVisible()
  })
  await check('Local PIN works offline without invoking phone login or email-password sign-in', async () => {
    const before = counts.signInWithPassword
    await back(); await context.setOffline(true); await unlock('4826'); await context.setOffline(false)
    expect(counts.signInWithPassword).toBe(before); await settings()
  })
  await check('Password reset uses generic wording and leaves local PIN unchanged', async () => {
    await page.getByRole('button', { name: 'Hindura ijambo ry’ibanga rya konti ukoresheje email', exact: true }).click()
    await expect(page.locator('.parent-settings').getByRole('status')).toContainText('Niba iyi email ifite konti')
    expect(counts.PASSWORD_RESET).toBe(2); expect(setting(await data(), 'parent-access:v1').digest).toBe(initialPin.digest)
  })
  await check('Explicit local unlink leaves cloud account, local child and PIN intact', async () => {
    await page.evaluate(async () => {
      const database = await new Promise(resolve => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result) })
      await new Promise(resolve => { const tx = database.transaction('profiles', 'readwrite'); tx.objectStore('profiles').put({ profile_id: 'local-email-child', code: 'P-E1', local_only: true }); tx.oncomplete = resolve }); database.close()
    })
    await page.getByRole('button', { name: 'Hagarika guhuza iki gikoresho na konti', exact: true }).click()
    expect(setting(await data(), 'account')).toBeDefined()
    await page.getByRole('button', { name: 'Yego, hagarika guhuza iki gikoresho', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mfite konti', exact: true })).toBeVisible()
    const state = await data(); expect(setting(state, 'account')).toBeUndefined(); expect(setting(state, 'token')).toBeUndefined()
    expect(setting(state, 'parent-access:v1').digest).toBe(initialPin.digest); expect(state.profiles).toHaveLength(1); expect(counts.delete).toBe(0)
  })
  await check('Relinking checks existing local PIN before any cloud login and preserves that PIN', async () => {
    const form = page.locator('.parent-settings')
    await form.getByRole('button', { name: 'Mfite konti', exact: true }).click()
    await form.getByLabel('Email', { exact: true }).fill(identity.email); await password(form).fill(secret)
    await form.getByLabel('Umubare usanzwe', { exact: true }).fill('1111')
    const before = counts.signInWithPassword
    await form.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('si wo'); expect(counts.signInWithPassword).toBe(before)
    await form.getByLabel('Umubare usanzwe', { exact: true }).fill('4826')
    await form.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
    await expect(form).toContainText('Umubare w’ibanga w’iki gikoresho ntiwahindutse')
    expect(setting(await data(), 'parent-access:v1').digest).toBe(initialPin.digest)
  })
  await check('Email recovery refuses a different Vuga identity and leaves linked identity and PIN intact', async () => {
    await back(); await enter(); await gate.getByRole('button', { name: 'Nibagiwe umubare w’ibanga', exact: true }).click()
    await gate.getByRole('button', { name: 'Konti ya Vuga', exact: true }).click(); await password(gate).fill(secret)
    await gate.getByLabel('Umubare w’ibanga mushya', { exact: true }).fill('9632')
    await gate.getByLabel('Ongera wandike umubare w’ibanga mushya', { exact: true }).fill('9632')
    wrongIdentity = true
    await gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('Indi konti')
    expect(setting(await data(), 'parent-access:v1').digest).toBe(initialPin.digest)
    expect(setting(await data(), 'account').user_id).toBe(user.user_id)
  })
  await check('Fresh matching email authentication permits local PIN recovery', async () => {
    wrongIdentity = false
    await gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    recoveredPin = setting(await data(), 'parent-access:v1'); expect(recoveredPin.digest).not.toBe(initialPin.digest)
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click(); await back(); await unlock('9632'); await settings()
  })
  await check('Email settings fit a mobile viewport and cloud deletion requests password, not local PIN', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Siba konti yanjye', exact: true }).click()
    const form = page.getByRole('form', { name: 'Siba konti yanjye', exact: true })
    await expect(password(form)).toBeVisible(); expect(await password(form).getAttribute('inputmode')).toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${output}/email-account-mobile.png`, animations: 'disabled', fullPage: true })
    await password(form).fill('wrong-password')
    await form.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('si byo'); expect(counts.delete).toBe(0)
  })
  await check('Failed deletion keeps local account; explicit retry clears only cloud linkage and preserves child/PIN', async () => {
    const form = page.getByRole('form', { name: 'Siba konti yanjye', exact: true })
    deleteFails = true; await password(form).fill(secret)
    await form.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('ntibirarangira'); expect(setting(await data(), 'account')).toBeDefined()
    deleteFails = false
    await form.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(page.locator('.parent-settings')).toContainText('yasibwe kuri seriveri')
    const state = await data(); expect(setting(state, 'account')).toBeUndefined(); expect(setting(state, 'token')).toBeUndefined()
    expect(setting(state, 'parent-access:v1').digest).toBe(recoveredPin.digest); expect(state.profiles).toHaveLength(1); expect(counts.delete).toBe(2)
  })
  await check('Legacy phone flow remains explicitly accessible', async () => {
    await page.getByText('Ubundi buryo bwo kwinjira', { exact: true }).click()
    await page.getByRole('button', { name: 'Koresha konti ya nimero ya telefoni', exact: true }).click()
    await expect(page.getByRole('textbox', { name: /^Nimero ya telefoni/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ohereza kode', exact: true })).toBeVisible()
  })
  await check('A pending legacy phone request disables switching to email until it finishes', async () => {
    await page.getByRole('textbox', { name: /^Nimero ya telefoni/ }).fill('0788123456')
    await page.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Koresha email', exact: true })).toBeDisabled()
    await expect.poll(() => typeof finishPhoneCode).toBe('function')
    await finishPhoneCode()
    await expect(page.getByLabel('Kode twakoherereje', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Koresha email', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Koresha email', exact: true }).click()
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  })
  expect(errors).toEqual([])
} catch (error) {
  checks.push({ name: 'Run completion', status: 'failed', error: error.message })
  await page.screenshot({ path: `${output}/email-failure.png`, fullPage: true }).catch(() => {})
  process.exitCode = 1; console.error(error)
} finally {
  await writeFile(`${output}/email-accounts-report.json`, JSON.stringify({ recorded_at: new Date().toISOString(), baseURL,
    mockOnly: true, buildAssets: await Promise.all(buildAssets), checks, counts, errors }, null, 2))
  await context.close(); await browser.close()
}
