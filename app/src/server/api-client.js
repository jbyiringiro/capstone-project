// Thin client for the Vuga API. The token lives in IndexedDB settings so the dashboard survives reloads.
import Dexie from 'dexie'
import { db } from '../storage/db.js'
import { localizedError } from '../shared/errors-rw.js'
import { normalisePhone, samePhone } from './phone.js'
import { sameAccount } from './account-identity.js'
import { emailAuth } from './email-auth.js'
import { normalizeEmailAddress } from '../shared/account-validation.js'
import { getParentPinVersion, PARENT_ACCESS_KEY, ParentAccessError, prepareParentPinSetup, unlockParentAccess, validParentPin } from '../parent-access/parent-access.js'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

export async function getToken() { return (await db.settings.get('token'))?.value ?? null }
export async function setToken(value) { await db.settings.put({ key: 'token', value }) }
// The linked caregiver identity survives sign-out so recovery can require that same account.
// Email links include an immutable user_id; legacy phone links may only have a number.
// `stale` marks a legacy PIN the cloud account no longer takes.
export async function getLinkedAccount() { return (await db.settings.get('account'))?.value ?? null }
// What this device keeps of an account: the session, the linked identity and name, and the account
// copy it joined (server/account-backup.js). Erasing the account clears all three.
const ACCOUNT_KEYS = ['token', 'account', 'account-backup']

// How long to wait, in words: amasegonda 45, or iminota 12.
export const waitText = seconds => (seconds < 90 ? `amasegonda ${Math.max(1, Math.round(seconds))}` : `iminota ${Math.ceil(seconds / 60)}`)
const OFFLINE = 'Nta interineti iri kuri iki gikoresho. Yifungure, wongere ugerageze.'

// A request's own messages, by status, come before the general ones; a function receives the
// server's reply, which the error also carries as `reply`.
async function req(path, { method = 'GET', body, form, auth = true, bearer, errors = {}, expectedStatus, clearRefusedSession = true } = {}) {
  const headers = {}
  const token = bearer ?? (auth ? await getToken() : null)
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) { payload = new URLSearchParams(form); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json' }
  let r
  try { r = await fetch(`${API_BASE}${path}`, { method, headers, body: payload }) }
  catch {
    // With internet on, the Vuga server did not answer, or refused this app's address (CORS).
    throw localizedError(globalThis.navigator?.onLine === false ? OFFLINE
      : 'Ntibyashobotse guhuza na seriveri ya Vuga. Ongera ugerageze nyuma gato; ibiri kuri iki gikoresho birakomeza gukora.')
  }
  if (!r.ok) {
    const reply = await r.json().catch(() => ({}))
    // Clear only the refused session, never a different session opened during this request.
    if (r.status === 401 && token && clearRefusedSession) await db.transaction('rw', db.settings, async () => {
      if (await getToken() === token) await setToken(null)
    })
    const messages = {
      401: 'Igihe cyo kwinjira kuri konti cyarangiye. Ongera winjire muri «Kwinjira» cyangwa «Ohereza».',
      403: 'Iyi konti ntiyemerewe kubona aya makuru.',
      404: 'Amakuru wasabye ntabonetse.',
      409: 'Amakuru winjije asanzweho. Reba kode cyangwa konti wakoresheje.',
      413: 'Ibyo kubika ni byinshi cyane kuri konti. Siba amafoto cyangwa amajwi utagikoresha, wongere ugerageze.',
      422: 'Reba ko wujuje neza amakuru yasabwe.',
      ...errors
    }
    const message = messages[r.status] ?? 'Seriveri ntiyabashije kwakira icyifuzo. Ongera ugerageze nyuma.'
    const error = localizedError(typeof message === 'function' ? message(reply) : message)
    error.status = r.status
    error.reply = reply
    throw error
  }
  if (expectedStatus && r.status !== expectedStatus) throw localizedError('Seriveri ntiyemeje ko icyifuzo cyarangiye. Ongera ugerageze.')
  return r.status === 204 ? null : r.json()
}

// A texted code refused (400): typed wrong, tried too often, or expired or used already.
const WRONG_CODE = reply => (reply.reason === 'wrong' && reply.attempts_left
  ? `Kode wanditse si yo. Reba SMS wongere uyandike: usigaje kugerageza inshuro ${reply.attempts_left}.`
  : reply.reason === 'spent' ? 'Kode yanditswe nabi inshuro eshanu, ntigikora. Saba indi kode.'
    : 'Kode yararangiye cyangwa yamaze gukoreshwa: imara iminota 10, igakoreshwa rimwe. Saba indi kode.')
const NUMBER_TAKEN = 'Iyi nimero isanzwe ifite konti ya Vuga. Injira ukoresheje umubare w’ibanga wayo.'
export const NO_ACCOUNT = 'Iyi nimero ntifite konti ya Vuga. Reba ko wayanditse neza, cyangwa ufungure konti nshya.'
const WRONG_PIN = 'Nimero cyangwa umubare w’ibanga si byo. Ongera ugerageze.'
// A server child this account does not have (any more): deleted elsewhere, or made by another account.
const GONE_FROM_ACCOUNT = 'Uyu mwana ntari kuri konti winjiyemo kuri seriveri.'
const PIN_LOCKED = reply => `Umubare w’ibanga wanditswe nabi inshuro eshanu. Tegereza ${waitText(reply.retry_after ?? 900)}, cyangwa uhindure umubare w’ibanga ukoresheje SMS.`
// The server could not text the code: the SMS service refused it (502), or this server has no SMS
// service set up (503). Either way no code was kept, so asking again later costs nothing.
export const SMS_REFUSED = 'SMS ntiyabashije koherezwa. Reba ko nimero ari iya telefoni ikora, hanyuma wongere usabe kode nyuma gato.'
export const SMS_UNAVAILABLE = 'Kohereza kode muri SMS ntibirashyirwaho kuri seriveri ya Vuga. Ibiri kuri iki gikoresho birakomeza gukora nta konti.'

const EMAIL_ERRORS = {
  401: 'Konti ntiyemejwe. Ongera winjire ukoresheje email n’ijambo ry’ibanga.',
  403: 'Banza wemeze email ukoresheje ubutumwa woherejwe, hanyuma wongere winjire.',
  409: 'Iyi konti ntishobora guhuzwa. Ongera winjire cyangwa ufungure konti nshya niba iya mbere yarasibwe.',
  503: 'Kwinjira ukoresheje email ntibiraboneka. Ongera ugerageze nyuma; ibiri kuri iki gikoresho birakomeza gukora.'
}
const WRONG_ACCOUNT = 'Injira kuri konti ya email ihujwe n’iki gikoresho. Indi konti ntishobora guhindura umubare w’ibanga wacyo.'
const ACCOUNT_CHANGED = 'Konti ihujwe n’iki gikoresho yahindutse. Ongera winjire.'
const ACCOUNT_NAME_ERROR = 'Andika izina ryawe nk’umurezi, inyuguti zitarenze 120.'
const deletionCode = reply => reply?.code || reply?.detail?.code
const deletionUnavailable = reply => {
  if (deletionCode(reply) === 'ACCOUNT_DELETION_DISABLED') return 'Gusiba konti ntibirafungurwa kuri seriveri. Nta makuru yasibwe. Vugana n’ushinzwe Vuga.'
  if (deletionCode(reply) === 'ACCOUNT_DELETION_PENDING') return 'Amakuru ya Vuga yo kuri seriveri yasibwe, ariko gusiba konti ntibirarangira. Ongera ukande «Siba konti burundu».'
  return 'Gusiba konti ntibirarangira cyangwa ntibyemejwe. Ongera ukande «Siba konti burundu» kugira ngo ugenzure ko byarangiye.'
}
// Only kept in memory, to finish a provider deletion if the server response was interrupted.
const pendingEmailDeletions = new Map()
const pendingEmailLogins = new Map()
const EMAIL_LOGIN_WAIT_MS = 5 * 60_000
const LOGIN_EXPIRED = 'Igihe cyo kurangiza kwinjira cyarangiye. Ongera wandike email n’ijambo ry’ibanga.'

function pendingLoginError(code = 'email-login-expired', message = LOGIN_EXPIRED) {
  return Object.assign(localizedError(message), { code })
}

function revokePendingTokens(pending) {
  return Promise.allSettled([...pending.tokens].filter(token => !pending.revoked.has(token)).map(token => {
    pending.revoked.add(token)
    // Cancellation may originate inside a transaction that is about to roll back. Read
    // committed storage separately, so its tentative token is not mistaken for a login.
    return Dexie.ignoreTransaction(async () => {
      if (await getToken() !== token) await emailAuth.signOut?.(token)
    })
  }))
}

function discardEmailLogin(pending) {
  if (!pending || pending.state === 'complete') return Promise.resolve()
  pending.state = 'cancelled'
  pendingEmailLogins.delete(pending.handle)
  clearTimeout(pending.timer)
  pending.signal?.removeEventListener('abort', pending.onAbort)
  pending.session = null
  return revokePendingTokens(pending)
}

function assertPendingLogin(pending) {
  if (!pending || pendingEmailLogins.get(pending.handle) !== pending || pending.signal?.aborted || pending.expiresAt <= Date.now()) {
    void discardEmailLogin(pending)
    throw pendingLoginError()
  }
}

async function loginSnapshot() {
  return db.transaction('r', db.settings, async () => ({
    account: await getLinkedAccount(), token: await getToken(),
    gate: await getParentPinVersion({ allowUnconfigured: true })
  }))
}

function checkedEmailAccount(user) {
  if (!user?.user_id || !user.email || !['firebase', 'neon'].includes(user.auth_provider)
    || (emailAuth.provider && user.auth_provider !== emailAuth.provider)) throw localizedError(EMAIL_ERRORS[401])
  return { user_id: user.user_id, email: user.email, name: user.name || '', auth_provider: user.auth_provider }
}

async function storeEmailSession(token, user, expectedAccount = null, previous = null, { guard, pinSetup } = {}) {
  if (typeof token !== 'string' || !token) throw localizedError(EMAIL_ERRORS[401])
  const account = checkedEmailAccount(user)
  await db.transaction('rw', db.settings, async () => {
    const before = (await db.settings.get('account'))?.value
    if (previous && (!(sameAccount(before, previous.account) || (!before && !previous.account)) || await getToken() !== previous.token)) {
      throw pendingLoginError('email-login-changed', ACCOUNT_CHANGED)
    }
    if (expectedAccount && (!sameAccount(expectedAccount, account) || !sameAccount(before, expectedAccount))) {
      throw localizedError(WRONG_ACCOUNT)
    }
    await guard?.(false)
    if (!sameAccount(before, account)) await db.settings.delete('account-backup')
    if (pinSetup) await db.settings.put({ key: PARENT_ACCESS_KEY, value: pinSetup.value })
    await db.settings.bulkPut([{ key: 'token', value: token }, { key: 'account', value: account }])
    // If navigation happens while a write is awaiting IndexedDB, roll back the transaction.
    await guard?.(true)
  })
  return account
}

// Email passwords authenticate cloud accounts; the short device PIN remains an offline gate.
// Existing phone accounts retain their original shared PIN flow.
export const api = {
  registerEmail: (email, password, name) => emailAuth.register(email, password, name),
  resendEmailVerification: (email, password) => emailAuth.resendVerification(email, password),
  verifyEmailCode: (email, code) => emailAuth.verifyEmail(email, code),
  requestEmailPasswordReset: email => emailAuth.sendPasswordReset(email),
  confirmEmailPasswordReset: (email, code, password) => emailAuth.confirmPasswordReset(email, code, password),
  finishEmailPasswordReset: (email, password) => emailAuth.finishPasswordReset(email, password),
  prepareEmailLogin: async (email, password, name, { signal } = {}) => {
    const handle = {}
    const pending = { handle, state: 'preparing', signal, tokens: new Set(), revoked: new Set(), expiresAt: Date.now() + EMAIL_LOGIN_WAIT_MS }
    pending.onAbort = () => { void discardEmailLogin(pending) }
    pendingEmailLogins.set(handle, pending)
    signal?.addEventListener('abort', pending.onAbort, { once: true })
    pending.timer = setTimeout(() => { void discardEmailLogin(pending) }, EMAIL_LOGIN_WAIT_MS)
    pending.timer.unref?.()
    try {
      assertPendingLogin(pending)
      pending.previous = await loginSnapshot()
      assertPendingLogin(pending)
      const identity = await emailAuth.login(email, password)
      if (identity.idToken) pending.tokens.add(identity.idToken)
      assertPendingLogin(pending)
      const session = await req('/auth/email/session', {
        method: 'POST', auth: false,
        body: { id_token: identity.idToken, ...((name || identity.displayName) ? { name: name || identity.displayName } : {}) }, errors: EMAIL_ERRORS
      })
      if (session?.access_token) pending.tokens.add(session.access_token)
      assertPendingLogin(pending)
      const account = checkedEmailAccount(session?.user)
      if (typeof session.access_token !== 'string' || !session.access_token
        || normalizeEmailAddress(account.email) !== normalizeEmailAddress(identity.email)) throw localizedError(EMAIL_ERRORS[401])
      pending.session = { ...session, user: account }
      pending.state = 'ready'
      return Object.freeze(Object.assign(handle, { email: account.email, name: account.name, devicePin: !!pending.previous.gate, expiresAt: pending.expiresAt }))
    } catch (error) {
      void discardEmailLogin(pending)
      throw error
    }
  },
  cancelEmailLogin: handle => discardEmailLogin(pendingEmailLogins.get(handle)),
  completeEmailLogin: async (handle, { pin, confirmation } = {}) => {
    const pending = pendingEmailLogins.get(handle)
    assertPendingLogin(pending)
    if (pending.state !== 'ready') throw pendingLoginError('email-login-busy', 'Tegereza ko kwinjira birangira.')
    pending.state = 'completing'
    try {
      if (!validParentPin(pin)) throw new ParentAccessError('format')
      if (await getParentPinVersion({ allowUnconfigured: true }) !== pending.previous.gate) throw pendingLoginError('email-login-changed', ACCOUNT_CHANGED)
      assertPendingLogin(pending)
      let pinSetup = null
      if (pending.previous.gate) {
        const local = await unlockParentAccess(pin)
        assertPendingLogin(pending)
        if (!local.ok) throw localizedError(local.retryAfterMs
          ? `Wagerageje kenshi. Tegereza amasegonda ${Math.ceil(local.retryAfterMs / 1000)}, wongere ugerageze.`
          : 'Umubare w’ibanga si wo. Ongera ugerageze.')
      } else {
        pinSetup = await prepareParentPinSetup(pin, confirmation)
        assertPendingLogin(pending)
      }
      const session = pending.session
      const user = checkedEmailAccount(await req('/auth/me', {
        auth: false, bearer: session.access_token, clearRefusedSession: false, errors: EMAIL_ERRORS
      }))
      assertPendingLogin(pending)
      if (!sameAccount(user, session.user) || user.email !== session.user.email || user.auth_provider !== session.user.auth_provider) {
        throw pendingLoginError('email-login-changed', WRONG_ACCOUNT)
      }
      await storeEmailSession(session.access_token, user, null, pending.previous, {
        pinSetup,
        guard: async written => {
          assertPendingLogin(pending)
          const expectedGate = written && pinSetup ? JSON.stringify([pinSetup.value.version, pinSetup.value.salt, pinSetup.value.digest, pinSetup.value.recoverySalt, pinSetup.value.recoveryDigest]) : pending.previous.gate
          const actualGate = await getParentPinVersion({ allowUnconfigured: true })
          if (actualGate !== expectedGate) throw pendingLoginError('email-login-changed', ACCOUNT_CHANGED)
          assertPendingLogin(pending)
        }
      })
      pending.state = 'complete'
      pendingEmailLogins.delete(handle)
      clearTimeout(pending.timer)
      pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.session = null
      pending.tokens.clear()
      return { ...session, user, ...(pinSetup ? { recoveryCode: pinSetup.recoveryCode } : {}) }
    } catch (error) {
      if (pendingEmailLogins.get(handle) === pending && error.code !== 'email-login-changed' && ![401, 403].includes(error.status)) pending.state = 'ready'
      else void discardEmailLogin(pending)
      throw error
    }
  },
  loginEmail: async (email, password, name) => {
    const previous = await db.transaction('r', db.settings, async () => ({ account: await getLinkedAccount(), token: await getToken() }))
    const identity = await emailAuth.login(email, password)
    const session = await req('/auth/email/session', {
      method: 'POST', auth: false, body: { id_token: identity.idToken, ...((name || identity.displayName) ? { name: name || identity.displayName } : {}) }, errors: EMAIL_ERRORS
    })
    await storeEmailSession(session.access_token, session.user, null, previous)
    return session
  },
  // Reauthentication proves ownership of the EXISTING linked account, without opening or
  // linking another one. A token for another adult must never reset this device's local PIN.
  reauthenticateEmail: async (email, password, expectedAccount) => {
    const expected = expectedAccount ?? await getLinkedAccount()
    if (!expected?.email || !expected.user_id) throw localizedError(WRONG_ACCOUNT)
    const identity = await emailAuth.reauthenticate(email, password)
    const user = await req('/auth/me', { bearer: identity.idToken, errors: EMAIL_ERRORS })
    if (!sameAccount(expected, user)) throw localizedError(WRONG_ACCOUNT)
    await storeEmailSession(identity.idToken, user, expected)
    return { access_token: identity.idToken, token_type: 'bearer', user }
  },
  updateAccountName: async (value, expectedAccount) => {
    if (globalThis.navigator?.onLine === false) throw localizedError(OFFLINE)
    const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 120 || /\p{Cc}/u.test(name)) throw localizedError(ACCOUNT_NAME_ERROR)
    const previous = await db.transaction('r', db.settings, async () => ({ account: await getLinkedAccount(), token: await getToken() }))
    if (!previous.account?.email || !previous.account.user_id || (expectedAccount && !sameAccount(previous.account, expectedAccount))) throw localizedError(ACCOUNT_CHANGED)
    if (!previous.token) throw Object.assign(localizedError(EMAIL_ERRORS[401]), { status: 401 })
    const user = await req('/auth/me', {
      method: 'PATCH', bearer: previous.token, body: { name },
      errors: { ...EMAIL_ERRORS, 422: ACCOUNT_NAME_ERROR, 503: 'Ntibyashobotse kwemeza ko izina ryahinduwe. Ongera ugerageze nyuma gato.' }
    })
    const account = checkedEmailAccount(user)
    if (!sameAccount(previous.account, account) || account.email !== previous.account.email || account.auth_provider !== previous.account.auth_provider
      || account.name !== name) throw localizedError('Seriveri ntiyemeje izina rya konti. Ongera ugerageze.')
    // A delayed save must never replace a newly linked account or signed-out session.
    await storeEmailSession(previous.token, account, previous.account, previous)
    return account
  },
  deleteEmailAccount: async (email, password) => {
    if (globalThis.navigator?.onLine === false) throw localizedError(OFFLINE)
    const expected = await getLinkedAccount()
    if (!expected?.email || !expected.user_id || expected.email.toLowerCase() !== String(email).trim().toLowerCase()) throw localizedError(WRONG_ACCOUNT)
    // Authenticate freshly for the first attempt; retain that credential briefly in memory so
    // an interrupted deletion can finish even after the provider has already erased the account.
    let pending = pendingEmailDeletions.get(expected.user_id)
    if (!pending || pending.expires <= Date.now()) {
      const identity = await emailAuth.reauthenticate(email, password)
      pending = { idToken: identity.idToken, expires: Date.now() + 4 * 60_000 }
      pendingEmailDeletions.set(expected.user_id, pending)
    }
    try {
      await req('/auth/email/delete-account', {
        method: 'POST', auth: false, expectedStatus: 204,
        body: { id_token: pending.idToken, user_id: expected.user_id },
        errors: { ...EMAIL_ERRORS, 503: deletionUnavailable }
      })
    } catch (error) {
      if (error.status === 401 || error.status === 403 || deletionCode(error.reply) === 'ACCOUNT_DELETION_DISABLED') pendingEmailDeletions.delete(expected.user_id)
      throw error
    }
    pendingEmailDeletions.delete(expected.user_id)
    await db.transaction('rw', db.settings, async () => {
      if (sameAccount((await db.settings.get('account'))?.value, expected)) await db.settings.bulkDelete(ACCOUNT_KEYS)
    })
    return null
  },
  unlinkAccount: async () => {
    pendingEmailDeletions.clear()
    for (const pending of pendingEmailLogins.values()) void discardEmailLogin(pending)
    await db.transaction('rw', db.settings, () => db.settings.bulkDelete(ACCOUNT_KEYS))
  },
  // Texts a six-digit code to the number: 'register' before opening an account, 'reset' before
  // choosing a new PIN. The reply says how many seconds until another code may be asked for, and
  // where the code went (`delivery`): a phone, or the provider's test simulator; a number that
  // already has an account (409), or has none for a reset (404), gets no code.
  sendCode: (phone, purpose) => req('/auth/code', {
    method: 'POST', body: { phone, purpose }, auth: false, errors: {
      404: NO_ACCOUNT,
      409: NUMBER_TAKEN,
      422: 'Andika nimero ya telefoni igendanwa yo mu Rwanda, nka 0788 123 456.',
      429: reply => (reply.reason === 'limit'
        ? `Iyi nimero yohererejwe kode eshanu mu isaha imwe. Tegereza ${waitText(reply.retry_after ?? 3600)}, wongere usabe kode.`
        : `Tegereza ${waitText(reply.retry_after ?? 60)}, wongere usabe kode.`),
      502: SMS_REFUSED,
      503: SMS_UNAVAILABLE
    }
  }),
  // `name` is the caregiver's own name, required for a new account; children go by codes.
  register: (phone, code, pin, name, role = 'teacher') => req('/auth/register', { method: 'POST', body: { name, phone, code, pin, role }, auth: false, errors: { 400: WRONG_CODE, 409: NUMBER_TAKEN, 422: 'Reba izina ryawe, kode n’umubare w’ibanga wanditse.' } }),
  resetPin: (phone, code, pin) => req('/auth/reset-pin', { method: 'POST', body: { phone, code, pin }, auth: false, errors: { 400: WRONG_CODE, 404: NO_ACCOUNT } }),
  // A new PIN ends every session opened with the old one, this device's too, so a device that was
  // signed in signs in again with the new PIN.
  changePin: async (phone, pin, newPin) => {
    const signedIn = !!(await getToken())
    await req('/auth/change-pin', { method: 'POST', body: { phone, pin, new_pin: newPin }, auth: false, errors: { 401: WRONG_PIN, 429: PIN_LOCKED } })
    if (signedIn) await api.login(phone, newPin).catch(() => setToken(null))
    return null
  },
  // Erases the account and all it keeps on the server. Only after the server has done so does this
  // device forget the account, its session and its account copy, together; what the caregiver
  // keeps here (children, words, recordings, the device PIN) stays. Offline, nothing is asked.
  deleteAccount: async (phone, pin) => {
    if (globalThis.navigator?.onLine === false) throw localizedError(OFFLINE)
    await req('/auth/delete-account', { method: 'POST', body: { phone, pin }, auth: false, errors: { 401: WRONG_PIN, 429: PIN_LOCKED } })
    await db.transaction('rw', db.settings, () => db.settings.bulkDelete(ACCOUNT_KEYS))
    return null
  },
  login: async (phone, pin) => {
    const number = normalisePhone(phone) ?? String(phone ?? '').trim()
    const t = await req('/auth/login', { method: 'POST', form: { username: number, password: pin }, auth: false, errors: { 401: WRONG_PIN, 429: PIN_LOCKED } })
    await setToken(t.access_token)
    // The caregiver's name, for the account area; kept from before if the server cannot say.
    const before = await getLinkedAccount()
    const name = await api.me().then(user => user.name, () => (before && samePhone(before.phone, number) ? before.name : ''))
    await db.settings.put({ key: 'account', value: name ? { phone: number, name } : { phone: number } })
    return t
  },
  me: () => req('/auth/me'),
  logout: async () => {
    for (const pending of pendingEmailLogins.values()) void discardEmailLogin(pending)
    const token = await getToken()
    // Local sign-out remains available offline. Online, also revoke the Neon session.
    try { if (token?.startsWith('neon.') && globalThis.navigator?.onLine !== false) await emailAuth.signOut?.(token) }
    catch { /* An unavailable server must not prevent local sign-out. */ }
    finally {
      await db.transaction('rw', db.settings, async () => { if (await getToken() === token) await setToken(null) })
    }
  },
  symbols: () => req('/symbols', { auth: false }),
  profiles: () => req('/profiles'),
  createProfile: (code, age_band) => req('/profiles', { method: 'POST', body: { code, age_band } }),
  // A server child's new code or age band, and its deletion with all the server keeps for it.
  updateProfile: (pid, changes) => req(`/profiles/${pid}`, { method: 'PATCH', body: changes, errors: { 404: GONE_FROM_ACCOUNT, 409: 'Iyi kode isanzwe ikoreshwa n’undi mwana kuri seriveri. Hitamo indi.' } }),
  deleteProfile: pid => req(`/profiles/${pid}`, { method: 'DELETE', errors: { 404: GONE_FROM_ACCOUNT } }),
  vocabulary: (pid) => req(`/profiles/${pid}/vocabulary`),
  setVocabulary: (pid, symbol_ids) => req(`/profiles/${pid}/vocabulary`, { method: 'PUT', body: { symbol_ids } }),
  summary: (pid) => req(`/profiles/${pid}/summary`),
  health: () => req('/health', { auth: false }),
  backupStatus: bearer => req('/backup/status', { bearer }),
  loadBackup: bearer => req('/backup', { bearer }),
  // `base_revision` is the account copy this device last saved or received; a newer one (409)
  // means another device saved in between, and the caregiver chooses in Ohereza.
  saveBackup: (snapshot, base_revision, bearer) => req('/backup', {
    method: 'PUT', body: { ...snapshot, base_revision }, bearer,
    errors: { 409: 'Konti yawe ifite ibyahinduwe ku kindi gikoresho. Hitamo ibyo ugumana muri «Ohereza».' }
  })
}

// After the caregiver opens the caregiver area with the PIN, the linked account signs in again with
// it, so the account backup keeps working. A PIN the account no longer takes (changed on another
// device) stops these quiet tries until the caregiver signs in again, so they never lock the number.
export async function signInQuietly(pin) {
  try {
    const account = await getLinkedAccount()
    if (!account?.phone || account.stale || globalThis.navigator?.onLine === false) return
    try { await api.login(account.phone, pin) }
    catch (error) { if (error.status === 401) await db.settings.put({ key: 'account', value: { ...account, stale: true } }) }
  } catch {
    // Signing in again is a convenience: the caregiver area is already open.
  }
}
