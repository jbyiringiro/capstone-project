// Run against a production build with VITE_EMAIL_AUTH_PROVIDER=neon. All API and
// external requests are intercepted; this never creates accounts or sends mail.
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4176/'
const output = process.env.VUGA_EVIDENCE_DIR || fileURLToPath(new URL('../../../.claude-review/neon-auth-browser/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage(), checks = [], errors = [], external = [], requests = [], buildAssets = []
const user = { user_id: 'neon-vuga-user', email: 'caregiver@example.test', name: 'Demo Caregiver', auth_provider: 'neon', role: 'teacher' }
let passwordValue = 'Initial-password-48', verified = false, wrongIdentity = false, deleteFails = false, copy = null
let resetPartial = false
let nameFailure = 0, deletionDisabled = false
let registrationFailure = null, resendFailure = null
let holdLogin = false, finishLogin = null
const credentials = () => ({ idToken: 'neon.mock-sealed-session', uid: 'neon-provider-user', email: user.email, displayName: user.name, expiresIn: 3600 })
const count = path => requests.filter(request => request.path === path).length
const board = page.locator('.board:visible'), gate = page.locator('.parent-access')
const password = scope => scope.getByLabel('Ijambo ry’ibanga rya konti', { exact: true })
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: {
  'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'
}, body: JSON.stringify(body) })
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  const url = new URL(response.url())
  if (url.origin === new URL(baseURL).origin && /^\/assets\/index-.*\.(?:js|css)$/.test(url.pathname)) {
    buildAssets.push(response.body().then(body => ({ path: url.pathname, sha256: createHash('sha256').update(body).digest('hex') })))
  }
})
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === new URL(baseURL).origin) return route.continue()
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['8000', '8001'].includes(url.port)) {
    external.push(url.origin); return route.abort()
  }
  if (request.method() === 'OPTIONS') return json(route, 200, {})
  const path = url.pathname, body = request.postData() ? request.postDataJSON() : null
  requests.push({ path, method: request.method() }) // Never record passwords, codes, or bearer headers.
  if (path === '/auth/neon/register') return registrationFailure
    ? json(route, registrationFailure.status, registrationFailure.body) : json(route, 200, { email: user.email, verificationSent: true })
  if (path === '/auth/neon/resend') {
    if (resendFailure === 'network') return route.abort('connectionreset')
    return resendFailure ? json(route, 503, { code: 'VERIFICATION_SEND_FAILED' }) : json(route, 200, { email: user.email, verificationSent: true })
  }
  if (path === '/auth/neon/verify') {
    if (body.otp !== '123456') return json(route, 400, { detail: { code: 'INVALID_OTP' } })
    verified = true; return json(route, 200, { email: user.email, verified: true })
  }
  if (path === '/auth/neon/login') {
    if (body.password !== passwordValue) return json(route, 401, { detail: { code: 'INVALID_EMAIL_OR_PASSWORD' } })
    if (verified && holdLogin) return new Promise(resolve => {
      finishLogin = async () => { await json(route, 200, credentials()).catch(() => {}); resolve() }
    })
    return verified ? json(route, 200, credentials()) : json(route, 403, { detail: { code: 'EMAIL_NOT_VERIFIED' } })
  }
  if (path === '/auth/neon/password-reset/request') return json(route, 200, { sent: true })
  if (path === '/auth/neon/password-reset/confirm') {
    if (body.otp !== '654321') return json(route, 400, { detail: { code: 'INVALID_OTP' } })
    passwordValue = body.password
    return resetPartial ? json(route, 503, { detail: { code: 'PASSWORD_RESET_COMPLETED', passwordReset: true } }) : json(route, 200, { reset: true })
  }
  if (path === '/auth/neon/password-reset/finish') return body.password === passwordValue ? json(route, 200, { reset: true }) : json(route, 401, { detail: { code: 'INVALID_EMAIL_OR_PASSWORD' } })
  if (path === '/auth/email/session') return json(route, 200, { access_token: credentials().idToken, token_type: 'bearer', user })
  if (path === '/auth/me') {
    if (request.method() === 'PATCH') {
      if (nameFailure) return json(route, nameFailure, {})
      user.name = body.name
    }
    return json(route, 200, wrongIdentity ? { ...user, user_id: 'different-vuga-user' } : user)
  }
  if (path === '/auth/email/delete-account') {
    if (deletionDisabled) return json(route, 503, { code: 'ACCOUNT_DELETION_DISABLED' })
    return deleteFails ? json(route, 503, { code: 'ACCOUNT_DELETION_PENDING', vugaDataDeleted: true }) : route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  }
  if (path === '/auth/neon/signout') return route.fulfill({ status: 204 })
  if (path === '/health') return json(route, 200, { status: 'ok', email: 'neon', model_loaded: true })
  if (path === '/profiles' || path === '/symbols') return json(route, 200, [])
  if (path === '/backup/status') return json(route, 200, { exists: !!copy, revision: copy?.revision || 0, saved_at: copy?.saved_at || null })
  if (path === '/backup' && request.method() === 'PUT') {
    copy = { ...body, revision: (copy?.revision || 0) + 1, saved_at: new Date().toISOString() }
    return json(route, 200, { saved_at: copy.saved_at, revision: copy.revision })
  }
  if (path === '/backup') return copy ? json(route, 200, copy) : json(route, 404, {})
  return json(route, 404, {})
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
async function unlock(pin) {
  await enter(); await gate.getByLabel('Umubare w’ibanga', { exact: true }).fill(pin)
  await gate.getByRole('button', { name: 'Injira', exact: true }).click(); await expect(page.locator('.dash')).toBeVisible()
}
async function check(name, run) { await run(); checks.push({ name, status: 'passed' }); console.log(`PASS ${checks.length}: ${name}`) }
async function responsive(name) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${output}/neon-${name}-${width}.png`, fullPage: true, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}
async function stickyHeader(name) {
  const header = gate.locator('.parent-access-header')
  const close = header.getByRole('button', { name: 'Subira ku kibaho', exact: true })
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 600 })
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0)
    expect(await close.evaluate(button => {
      const rect = button.getBoundingClientRect(), top = button.closest('.parent-access-header').getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return top.top >= -1 && top.bottom <= innerHeight && button.contains(hit)
    }), `Header must stay visible and clickable after scrolling at ${width}px`).toBe(true)
    await page.screenshot({ path: `${output}/neon-${name}-sticky-${width}.png`, animations: 'disabled' })
    const fields = gate.locator('input:visible:enabled')
    for (const [field, fromBottom] of [[fields.first(), true], [fields.last(), false]]) {
      await field.evaluate(input => input.blur())
      await page.evaluate(bottom => window.scrollTo({ top: bottom ? document.documentElement.scrollHeight : 0, behavior: 'instant' }), fromBottom)
      await field.focus()
      await expect.poll(() => field.evaluate(input => {
        const rect = input.getBoundingClientRect(), top = document.querySelector('.parent-access-header').getBoundingClientRect()
        return document.activeElement === input && rect.top >= top.bottom - 1 && rect.bottom <= innerHeight + 1
      }), { message: `Focused field must not hide behind the header at ${width}px` }).toBe(true)
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
}
async function noPendingCredentials({ newDevice = true } = {}) {
  const state = await data()
  expect(setting(state, 'account')).toBeUndefined(); expect(setting(state, 'token')).toBeUndefined()
  if (newDevice) expect(setting(state, 'parent-access:v1')).toBeUndefined()
  const persisted = JSON.stringify(state) + await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(persisted).not.toContain(passwordValue); expect(persisted).not.toContain(credentials().idToken)
}
async function beginLogin(scope = gate) {
  await scope.getByLabel('Email', { exact: true }).fill(user.email)
  await password(scope).fill(passwordValue)
  await expect(scope.getByLabel('Hitamo umubare', { exact: true })).toHaveCount(0)
  await expect(scope.getByLabel('Umubare usanzwe', { exact: true })).toHaveCount(0)
  await scope.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
  await expect(scope.locator('.email-pin-stage')).toBeVisible()
  await expect(password(scope)).toHaveCount(0); await expect(scope.getByLabel('Email', { exact: true })).toHaveCount(0)
}
async function resetFields(scope, code = '654321', value = passwordValue) {
  await scope.getByLabel('Kode yo muri email', { exact: true }).fill(code)
  await scope.getByLabel('Ijambo ry’ibanga rishya', { exact: true }).fill(value)
  await scope.getByLabel('Ongera wandike ijambo ry’ibanga rishya', { exact: true }).fill(value)
}
let initialPin, recoveredPin
try {
  await page.clock.install(); await page.goto(baseURL); await expect(board).toBeVisible(); await enter()
  async function fillSignup() {
    await gate.getByLabel('Email', { exact: true }).fill(user.email)
    await gate.getByLabel(/^Izina ryawe/).fill(user.name)
    await password(gate).fill(passwordValue)
    await gate.getByLabel('Ongera wandike ijambo ry’ibanga rya konti', { exact: true }).fill(passwordValue)
  }
  await check('Signup validates email inline and shows password requirements without submitting weak credentials', async () => {
    const before = count('/auth/neon/register')
    await gate.getByLabel('Email', { exact: true }).fill('bad@@example')
    await password(gate).focus()
    await expect(gate.locator('.parent-field-error')).toContainText('Andika email yuzuye')
    await gate.getByLabel('Email', { exact: true }).fill('parent+school@school-name.example')
    await password(gate).focus(); await expect(gate.locator('.parent-field-error')).toHaveCount(0)
    for (const [entered, canonical] of [['Parent@école.example', 'parent@xn--cole-9oa.example'], ['Parent@faß.de', 'parent@xn--fa-hia.de'], ['Parent@ΟΣ.example', 'parent@xn--0xai.example']]) {
      const field = gate.getByLabel('Email', { exact: true })
      await field.fill(entered); await password(gate).focus()
      await expect(field).toHaveValue(canonical); expect(await field.evaluate(input => input.validity.valid)).toBe(true)
      await expect(gate.locator('.parent-field-error')).toHaveCount(0)
      // Enter must normalize and validate, even without a blur. EmailField deliberately
      // uses a text input with the email keyboard so native IDN rewriting cannot alter it.
      // Other required fields are still empty, so this must not submit registration.
      await field.fill(entered); await field.press('Enter')
      await expect(field).toHaveValue(canonical); expect(await field.evaluate(input => input.validity.valid)).toBe(true)
      expect(count('/auth/neon/register')).toBe(before)
    }
    await gate.getByLabel(/^Izina ryawe/).fill(user.name)
    await password(gate).fill('lowercaseonly')
    await gate.getByLabel('Ongera wandike ijambo ry’ibanga rya konti', { exact: true }).fill('lowercaseonly')
    await expect(gate.locator('.password-requirements')).toHaveCount(1)
    await expect(gate.locator('.password-requirements [data-met="false"]')).toHaveCount(3)
    await gate.getByRole('button', { name: 'Fungura konti ukoresheje email', exact: true }).click()
    expect(count('/auth/neon/register')).toBe(before)
    await fillSignup()
    await expect(gate.locator('.password-requirements [data-met="true"]')).toHaveCount(4)
  })
  await check('A valid email offers sign-in without revealing account status or sending a lookup', async () => {
    const authRequests = () => requests.filter(request => request.path.startsWith('/auth/')).length
    const before = authRequests()
    await gate.getByLabel('Email', { exact: true }).fill('not-an-email')
    await expect(gate.getByRole('button', { name: 'Mfite konti, injira', exact: true })).toHaveCount(0)
    await fillSignup()
    await gate.getByRole('button', { name: 'Mfite konti, injira', exact: true }).click()
    await expect(gate.getByLabel('Email', { exact: true })).toHaveValue(user.email)
    await expect(password(gate)).toHaveValue('')
    await expect(gate.getByLabel('Hitamo umubare', { exact: true })).toHaveCount(0)
    expect(authRequests()).toBe(before)
    expect(setting(await data(), 'account')).toBeUndefined()
    await gate.getByRole('button', { name: 'Fungura konti', exact: true }).click()
  })
  await check('A paused signup keeps the registration form and does not claim creation or verification delivery', async () => {
    registrationFailure = { status: 503, body: { code: 'VERIFICATION_CONFIGURATION_REQUIRED' } }
    await fillSignup()
    await gate.getByRole('button', { name: 'Fungura konti ukoresheje email', exact: true }).click()
    await expect(gate.getByRole('alert')).toBeVisible()
    await expect(gate.getByLabel(/^Izina ryawe/)).toBeVisible()
    await expect(gate.getByLabel('Kode yo muri email', { exact: true })).toHaveCount(0)
    expect(setting(await data(), 'account')).toBeUndefined()
    registrationFailure = null
  })
  for (const status of [503, 429]) await check(`Signup code-request failure ${status} offers cautious verification recovery and sign-in navigation`, async () => {
    registrationFailure = { status, body: { code: status === 429 ? 'TOO_MANY_REQUESTS' : 'VERIFICATION_SEND_FAILED', verificationRequired: true } }
    await fillSignup()
    await gate.getByRole('button', { name: 'Fungura konti ukoresheje email', exact: true }).click()
    await expect(gate.getByLabel('Kode yo muri email', { exact: true })).toBeVisible()
    await expect(gate.getByRole('alert')).toBeVisible()
    await expect(gate).not.toContainText('Konti yakozwe')
    await expect(password(gate)).toHaveCount(0)
    const resend = gate.getByRole('button', { name: /^Saba indi kode/ })
    await expect(resend).toBeDisabled()
    const before = count('/auth/neon/resend')
    await page.clock.fastForward(61_000)
    resendFailure = status === 503 ? 'network' : 'provider'
    await resend.click(); await expect(gate.getByRole('alert')).toBeVisible(); await expect(resend).toBeDisabled()
    expect(count('/auth/neon/resend')).toBe(before + 1)
    await page.clock.fastForward(61_000); resendFailure = null
    await resend.click(); await expect(gate.getByRole('status')).toContainText('Twasabye indi kode')
    await expect(resend).toBeDisabled(); expect(count('/auth/neon/resend')).toBe(before + 2)
    await gate.getByRole('button', { name: 'Mfite konti, injira', exact: true }).click()
    await expect(password(gate)).toHaveValue('')
    await expect(gate.getByLabel('Hitamo umubare', { exact: true })).toHaveCount(0)
    expect(setting(await data(), 'account')).toBeUndefined(); expect(setting(await data(), 'parent-access:v1')).toBeUndefined()
    expect(count('/auth/email/session')).toBe(0)
    await gate.getByRole('button', { name: 'Fungura konti', exact: true }).click()
    registrationFailure = null
  })
  await check('Signup keeps its header accessible after scrolling and focused fields unobscured on desktop and phones', async () => {
    await stickyHeader('signup')
  })
  await check('Neon signup has no SMS alternative and fits narrow phones', async () => {
    const before = count('/auth/neon/register')
    await expect(gate.getByRole('button', { name: 'Koresha konti ya nimero ya telefoni', exact: true })).toHaveCount(0)
    await responsive('signup')
    await gate.getByLabel('Email', { exact: true }).fill(user.email)
    await gate.getByLabel(/^Izina ryawe/).fill(user.name)
    await password(gate).fill(passwordValue)
    await gate.getByLabel('Ongera wandike ijambo ry’ibanga rya konti', { exact: true }).fill(passwordValue)
    await gate.getByRole('button', { name: 'Fungura konti ukoresheje email', exact: true }).click()
    await expect(gate.getByLabel('Kode yo muri email', { exact: true })).toBeVisible()
    expect(count('/auth/neon/register')).toBe(before + 1)
    await expect(gate.getByRole('status')).toContainText('Twasabye kode yo kwemeza')
    expect(setting(await data(), 'account')).toBeUndefined(); expect(setting(await data(), 'parent-access:v1')).toBeUndefined()
  })
  await check('Verification rejects wrong codes and does not open an account session', async () => {
    await responsive('verification')
    await gate.getByLabel('Kode yo muri email', { exact: true }).fill('000000')
    await gate.getByRole('button', { name: 'Emeza email', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('Kode si yo')
    expect(count('/auth/email/session')).toBe(0); expect(setting(await data(), 'token')).toBeUndefined()
  })
  await check('Resending waits sixty seconds and never requests a password or sends duplicates', async () => {
    const before = count('/auth/neon/resend')
    const resend = gate.getByRole('button', { name: /^Saba indi kode/ })
    await expect(resend).toBeDisabled(); expect(count('/auth/neon/resend')).toBe(before)
    await page.clock.fastForward(61_000); await resend.click()
    // Disabled can mean the request is still in flight; wait for the actual response.
    await expect(gate.getByRole('status')).toContainText('Twasabye indi kode')
    await expect.poll(() => count('/auth/neon/resend')).toBe(before + 1)
    await expect(resend).toBeDisabled(); await expect(password(gate)).toHaveCount(0)
  })
  await check('A correct verification code requires explicit password login afterward', async () => {
    await gate.getByLabel('Kode yo muri email', { exact: true }).fill('123456')
    await gate.getByRole('button', { name: 'Emeza email', exact: true }).click()
    await expect(gate.getByRole('button', { name: 'Injira muri konti', exact: true })).toBeVisible()
    await expect(password(gate)).toHaveValue(''); expect(setting(await data(), 'account')).toBeUndefined()
  })
  await check('Password reset validates its email code and confirmation before changing the password', async () => {
    await gate.getByRole('button', { name: 'Nibagiwe ijambo ry’ibanga', exact: true }).click()
    await gate.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
    await expect(gate.locator('.email-password-reset')).toContainText('Niba')
    await responsive('password-reset')
    const before = count('/auth/neon/password-reset/confirm')
    await resetFields(gate, '654321', 'lowercaseonly')
    await expect(gate.locator('.password-requirements')).toHaveCount(1)
    await expect(gate.locator('.password-requirements [data-met="false"]')).toHaveCount(3)
    await gate.getByRole('button', { name: 'Bika ijambo ry’ibanga rishya', exact: true }).click()
    expect(count('/auth/neon/password-reset/confirm')).toBe(before)
    await resetFields(gate, '000000', 'New-password-48')
    await gate.getByRole('button', { name: 'Bika ijambo ry’ibanga rishya', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('Kode si yo')
    expect(setting(await data(), 'parent-access:v1')).toBeUndefined()
    await resetFields(gate, '654321', 'New-password-48')
    await gate.getByLabel('Ongera wandike ijambo ry’ibanga rishya', { exact: true }).fill('Mismatch-password1')
    await gate.getByRole('button', { name: 'Bika ijambo ry’ibanga rishya', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('ntahuye'); expect(count('/auth/neon/password-reset/confirm')).toBe(1)
    await resetFields(gate, '654321', 'New-password-48')
    resetPartial = true
    await gate.getByRole('button', { name: 'Bika ijambo ry’ibanga rishya', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('ryahinduwe')
    await expect(gate.getByLabel('Kode yo muri email', { exact: true })).toHaveCount(0)
    await gate.getByRole('button', { name: 'Rangiza guhindura ijambo ry’ibanga', exact: true }).click()
    resetPartial = false
    await expect(gate.getByRole('button', { name: 'Injira muri konti', exact: true })).toBeVisible()
    expect(count('/auth/neon/password-reset/confirm')).toBe(2)
    expect(count('/auth/neon/password-reset/finish')).toBe(1)
  })
  await check('Incorrect account passwords never show the PIN screen or persist authentication', async () => {
    const before = count('/auth/email/session')
    await password(gate).fill('Wrong-password-48')
    await expect(gate.getByLabel('Hitamo umubare', { exact: true })).toHaveCount(0)
    await gate.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('si byo')
    await expect(gate.locator('.email-pin-stage')).toHaveCount(0)
    expect(count('/auth/email/session')).toBe(before); await noPendingCredentials()
  })
  await check('Closing during password authentication discards a late successful response', async () => {
    holdLogin = true; finishLogin = null
    await password(gate).fill(passwordValue)
    await gate.getByRole('button', { name: 'Injira muri konti', exact: true }).click()
    await expect.poll(() => typeof finishLogin).toBe('function')
    await back(); await finishLogin(); holdLogin = false
    await enter(); await gate.getByRole('button', { name: 'Mfite konti', exact: true }).click()
    await expect(password(gate)).toHaveValue(''); await expect(gate.locator('.email-pin-stage')).toHaveCount(0)
    await noPendingCredentials()
  })
  await check('Returning from PIN setup discards the pending login and clears its credentials', async () => {
    await beginLogin(); await noPendingCredentials()
    await gate.getByLabel('Hitamo umubare', { exact: true }).fill('4826')
    await gate.getByRole('button', { name: 'Subira kwinjira', exact: true }).click()
    await expect(password(gate)).toHaveValue(''); await expect(gate.locator('.email-pin-stage')).toHaveCount(0)
    await noPendingCredentials()
    await beginLogin(); await noPendingCredentials(); await back(); await enter()
    await gate.getByRole('button', { name: 'Mfite konti', exact: true }).click()
    await expect(password(gate)).toHaveValue(''); await expect(gate.locator('.email-pin-stage')).toHaveCount(0)
    await noPendingCredentials()
  })
  await check('Reloading before PIN confirmation cannot restore a pending account session', async () => {
    await beginLogin(); await noPendingCredentials()
    await page.reload(); await expect(board).toBeVisible(); await enter()
    await gate.getByRole('button', { name: 'Mfite konti', exact: true }).click()
    await expect(password(gate)).toHaveValue(''); await expect(gate.locator('.email-pin-stage')).toHaveCount(0)
    await noPendingCredentials()
  })
  await check('A valid account password opens a separate PIN screen; invalid and mismatched PINs cannot finish login', async () => {
    await beginLogin(); await noPendingCredentials(); await responsive('pin-setup')
    const before = count('/auth/neon/login')
    await gate.getByLabel('Hitamo umubare', { exact: true }).fill('12')
    await gate.getByLabel('Ongera uwandike', { exact: true }).fill('12')
    await gate.getByRole('button', { name: 'Bika kandi ukomeze', exact: true }).click()
    await expect(gate.locator('.email-pin-stage')).toBeVisible(); await noPendingCredentials()
    await gate.getByLabel('Hitamo umubare', { exact: true }).fill('4826')
    await gate.getByLabel('Ongera uwandike', { exact: true }).fill('4827')
    await gate.getByRole('button', { name: 'Bika kandi ukomeze', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('ntihuye')
    await expect(gate.locator('.email-pin-stage')).toBeVisible(); await noPendingCredentials()
    expect(count('/auth/neon/login')).toBe(before)
  })
  await check('Confirming the PIN stores immutable Neon ownership and a separate hashed offline PIN', async () => {
    await gate.getByLabel('Ongera uwandike', { exact: true }).fill('4826')
    await gate.getByRole('button', { name: 'Bika kandi ukomeze', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    const state = await data(); initialPin = setting(state, 'parent-access:v1')
    expect(initialPin.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(setting(state, 'account')).toMatchObject({ user_id: user.user_id, email: user.email, auth_provider: 'neon' })
    expect(JSON.stringify(state)).not.toContain(passwordValue)
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click(); await expect(page.locator('.dash')).toBeVisible()
  })
  await check('Offline PIN access does not send passwords or codes to any service', async () => {
    const before = count('/auth/neon/login')
    await back(); await context.setOffline(true); await unlock('4826'); await context.setOffline(false)
    expect(count('/auth/neon/login')).toBe(before); await settings()
  })
  await check('Name editing saves the adult name, preserves identity and PIN, and works at phone widths', async () => {
    const before = await data(), scope = page.locator('.parent-settings')
    await scope.getByRole('button', { name: 'Hindura izina', exact: true }).click()
    const editor = scope.getByRole('form', { name: 'Hindura izina rya konti', exact: true })
    await editor.getByLabel(/^Izina ryawe/).fill('  Updated   Caregiver  ')
    await responsive('edit-name')
    await editor.getByRole('button', { name: 'Bika izina', exact: true }).click()
    await expect(scope.getByRole('status')).toContainText('Izina rya konti ryahinduwe')
    const after = await data()
    expect(setting(after, 'account')).toMatchObject({ user_id: user.user_id, name: 'Updated Caregiver', email: user.email })
    expect(setting(after, 'parent-access:v1')).toEqual(setting(before, 'parent-access:v1'))
    expect(after.profiles).toEqual(before.profiles)
    await page.reload(); await expect(board).toBeVisible(); await unlock('4826'); await settings()
    await expect(page.locator('.parent-settings')).toContainText('Updated Caregiver')
  })
  await check('A refused name save keeps the old name; cancel never saves; expired sessions can sign in and retry', async () => {
    const scope = page.locator('.parent-settings')
    await scope.getByRole('button', { name: 'Hindura izina', exact: true }).click()
    const editor = scope.getByRole('form', { name: 'Hindura izina rya konti', exact: true })
    await editor.getByLabel(/^Izina ryawe/).fill('Final Caregiver')
    nameFailure = 503
    await editor.getByRole('button', { name: 'Bika izina', exact: true }).click()
    await expect(editor.getByRole('alert')).toContainText('Ntibyashobotse')
    expect(setting(await data(), 'account').name).toBe('Updated Caregiver')
    await editor.getByRole('button', { name: 'Reka', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await scope.getByRole('button', { name: 'Hindura izina', exact: true }).click()
    await expect(editor.getByLabel(/^Izina ryawe/)).toHaveValue('Updated Caregiver')
    await editor.getByLabel(/^Izina ryawe/).fill('Final Caregiver')
    nameFailure = 401
    await editor.getByRole('button', { name: 'Bika izina', exact: true }).click()
    await expect(password(editor)).toBeVisible()
    nameFailure = 0
    await password(editor).fill(passwordValue)
    await editor.getByRole('button', { name: 'Bika izina', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(setting(await data(), 'account').name).toBe('Final Caregiver')
  })
  await check('Account settings include a complete code-based reset and preserve the local PIN', async () => {
    const scope = page.locator('.parent-settings')
    await scope.getByRole('button', { name: 'Hindura ijambo ry’ibanga rya konti ukoresheje email', exact: true }).click()
    await expect(scope.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '')
    await scope.getByRole('button', { name: 'Ohereza kode', exact: true }).click()
    await resetFields(scope)
    await scope.getByRole('button', { name: 'Bika ijambo ry’ibanga rishya', exact: true }).click()
    await expect(scope.getByRole('status')).toContainText('ryahinduwe')
    expect(setting(await data(), 'parent-access:v1').digest).toBe(initialPin.digest)
  })
  await check('Relinking authenticates the account first, then verifies the existing PIN without replacing it', async () => {
    const scope = page.locator('.parent-settings'), beforePin = setting(await data(), 'parent-access:v1')
    await scope.getByRole('button', { name: 'Hagarika guhuza iki gikoresho na konti', exact: true }).click()
    await scope.getByRole('button', { name: 'Yego, hagarika guhuza iki gikoresho', exact: true }).click()
    await scope.getByRole('button', { name: 'Mfite konti', exact: true }).click()
    await beginLogin(scope); await noPendingCredentials({ newDevice: false })
    await expect(scope.getByLabel('Hitamo umubare', { exact: true })).toHaveCount(0)
    const before = count('/auth/neon/login')
    await scope.getByLabel('Umubare usanzwe', { exact: true }).fill('1111')
    await scope.getByRole('button', { name: 'Komeza', exact: true }).click()
    await expect(scope.getByRole('alert')).toContainText('si wo')
    await expect(scope.locator('.email-pin-stage')).toBeVisible(); await noPendingCredentials({ newDevice: false })
    expect(setting(await data(), 'parent-access:v1')).toEqual({ ...beforePin, failures: beforePin.failures + 1, lockedUntil: 0 })
    await scope.getByLabel('Umubare usanzwe', { exact: true }).fill('4826')
    await scope.getByRole('button', { name: 'Komeza', exact: true }).click()
    await expect(scope).toContainText('Umubare w’ibanga w’iki gikoresho ntiwahindutse')
    expect(count('/auth/neon/login')).toBe(before)
    expect(setting(await data(), 'parent-access:v1')).toEqual({ ...beforePin, failures: 0, lockedUntil: 0 })
    expect(setting(await data(), 'account')).toMatchObject({ user_id: user.user_id, email: user.email })
  })
  await check('Forgotten PIN provides email password reset without granting local access', async () => {
    await back(); await enter(); await gate.getByRole('button', { name: 'Nibagiwe umubare w’ibanga', exact: true }).click()
    await gate.getByRole('button', { name: 'Konti ya Vuga', exact: true }).click()
    await gate.getByRole('button', { name: 'Nibagiwe ijambo ry’ibanga rya konti', exact: true }).click()
    await gate.getByRole('button', { name: 'Ohereza kode', exact: true }).click(); await resetFields(gate)
    await gate.getByRole('button', { name: 'Bika ijambo ry’ibanga rishya', exact: true }).click()
    await expect(gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true })).toBeVisible()
    expect(setting(await data(), 'parent-access:v1').digest).toBe(initialPin.digest)
  })
  await check('Recovery refuses a different server identity even with the same email', async () => {
    await password(gate).fill(passwordValue)
    await gate.getByLabel('Umubare w’ibanga mushya', { exact: true }).fill('9632')
    await gate.getByLabel('Ongera wandike umubare w’ibanga mushya', { exact: true }).fill('9632')
    wrongIdentity = true
    await gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
    await expect(gate.getByRole('alert')).toContainText('Indi konti')
    expect(setting(await data(), 'parent-access:v1').digest).toBe(initialPin.digest)
    expect(setting(await data(), 'account').user_id).toBe(user.user_id)
  })
  await check('Fresh authentication by the linked identity permits local PIN recovery', async () => {
    wrongIdentity = false; await gate.getByRole('button', { name: 'Shyiraho umubare mushya', exact: true }).click()
    await expect(gate).toHaveAttribute('data-mode', 'recovery-code')
    recoveredPin = setting(await data(), 'parent-access:v1'); expect(recoveredPin.digest).not.toBe(initialPin.digest)
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click(); await settings()
  })
  await check('Deletion retries preserve child data and the local PIN while removing only the account link', async () => {
    await page.evaluate(async () => {
      const database = await new Promise(resolve => { const request = indexedDB.open('vuga'); request.onsuccess = () => resolve(request.result) })
      await new Promise(resolve => { const tx = database.transaction('profiles', 'readwrite'); tx.objectStore('profiles').put({ profile_id: 'local-child', code: 'P-N1', local_only: true }); tx.oncomplete = resolve }); database.close()
    })
    await page.getByRole('button', { name: 'Siba konti yanjye', exact: true }).click()
    const scope = page.getByRole('form', { name: 'Siba konti yanjye', exact: true })
    await password(scope).fill('wrong-password'); await scope.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(scope.getByRole('alert')).toContainText('si byo'); expect(count('/auth/email/delete-account')).toBe(0)
    deletionDisabled = true; await password(scope).fill(passwordValue)
    await scope.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(scope.getByRole('alert')).toContainText('Nta makuru yasibwe')
    expect(setting(await data(), 'account')).toBeDefined()
    deletionDisabled = false
    deleteFails = true; await password(scope).fill(passwordValue)
    await scope.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(scope.getByRole('alert')).toContainText('ntibirarangira'); expect(setting(await data(), 'account')).toBeDefined()
    deleteFails = false; await scope.getByRole('button', { name: 'Siba konti burundu', exact: true }).click()
    await expect(page.locator('.parent-settings')).toContainText('yasibwe kuri seriveri')
    const state = await data(); expect(setting(state, 'account')).toBeUndefined(); expect(setting(state, 'token')).toBeUndefined()
    expect(state.profiles).toHaveLength(1); expect(setting(state, 'parent-access:v1').digest).toBe(recoveredPin.digest)
  })
  await check('All authentication traffic used the Vuga API with zero Firebase, Neon-cookie, or SMS requests', async () => {
    expect(external).toEqual([]); expect(errors).toEqual([])
    expect(requests.some(request => request.path === '/auth/code' || request.path === '/auth/login')).toBe(false)
  })
} catch (error) {
  checks.push({ name: 'Run completion', status: 'failed', error: error.message }); process.exitCode = 1
  await page.screenshot({ path: `${output}/neon-failure.png`, fullPage: true }).catch(() => {})
  console.error(error)
} finally {
  await writeFile(`${output}/neon-accounts-report.json`, JSON.stringify({ recorded_at: new Date().toISOString(), baseURL,
    mockOnly: true, buildAssets: await Promise.all(buildAssets), checks, requests, external, errors }, null, 2))
  await context.close(); await browser.close()
}
