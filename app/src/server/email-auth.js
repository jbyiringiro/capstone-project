// Firebase's public REST API keeps email/password handling out of the Vuga server.
// https://firebase.google.com/docs/reference/rest/auth
// Passwords and refresh tokens are never retained. The caller keeps only the verified
// ID token for the short cloud session; signing in again obtains a fresh token.
import { localizedError } from '../shared/errors-rw.js'
import { createNeonEmailAuth } from './neon-email-auth.js'

const ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:'
const MESSAGES = {
  'not-configured': 'Konti zikoresha imeli ntizirashyirwaho. Ibiri kuri iki gikoresho birakomeza gukora nta konti.',
  offline: 'Nta interineti iri kuri iki gikoresho. Yifungure, wongere ugerageze.',
  network: 'Ntibyashobotse guhuza na serivisi ya konti. Ongera ugerageze nyuma gato.',
  timeout: 'Serivisi ya konti yatinze gusubiza. Ongera ugerageze nyuma gato.',
  'invalid-email': 'Andika aderesi ya imeli ikora, nka izina@example.com.',
  'invalid-password': 'Andika ijambo ry’ibanga rya konti yawe.',
  'weak-password': 'Koresha ijambo ry’ibanga rifite nibura inyuguti 8. Reba n’amabwiriza ya konti niba rikomeje kwangwa.',
  'invalid-name': 'Andika izina ryawe nk’umurezi, inyuguti zitarenze 120.',
  'invalid-credentials': 'Imeli cyangwa ijambo ry’ibanga si byo. Ongera ugerageze.',
  'email-exists': 'Iyi imeli isanzwe ifite konti. Injira cyangwa usabe ubutumwa bwo guhindura ijambo ry’ibanga.',
  'email-unverified': 'Banza ufungure ubutumwa bwo kwemeza imeli, ukande ihuza ririmo. Hanyuma ugaruke winjire.',
  'user-disabled': 'Iyi konti yarahagaritswe. Vugana n’ushinzwe Vuga.',
  'too-many-requests': 'Wagerageje kenshi. Tegereza gato, wongere ugerageze.',
  'invalid-token': 'Igihe cyo kwinjira cyarangiye. Ongera winjire.',
  unavailable: 'Serivisi ya konti ntiri gukora ubu. Ongera ugerageze nyuma.',
  'invalid-response': 'Serivisi ya konti ntiyasubije neza. Ongera ugerageze nyuma gato.',
  unknown: 'Ntibyashobotse gukomeza kuri konti. Ongera ugerageze nyuma gato.'
}

const PROVIDER_ERRORS = {
  INVALID_EMAIL: 'invalid-email',
  MISSING_EMAIL: 'invalid-email',
  MISSING_PASSWORD: 'invalid-password',
  WEAK_PASSWORD: 'weak-password',
  PASSWORD_DOES_NOT_MEET_REQUIREMENTS: 'weak-password',
  INVALID_PASSWORD: 'invalid-credentials',
  EMAIL_NOT_FOUND: 'invalid-credentials',
  USER_NOT_FOUND: 'invalid-credentials',
  INVALID_LOGIN_CREDENTIALS: 'invalid-credentials',
  EMAIL_EXISTS: 'email-exists',
  USER_DISABLED: 'user-disabled',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'too-many-requests',
  QUOTA_EXCEEDED: 'too-many-requests',
  RESET_PASSWORD_EXCEED_LIMIT: 'too-many-requests',
  INVALID_ID_TOKEN: 'invalid-token',
  TOKEN_EXPIRED: 'invalid-token',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'invalid-token',
  OPERATION_NOT_ALLOWED: 'not-configured',
  PASSWORD_LOGIN_DISABLED: 'not-configured',
  CONFIGURATION_NOT_FOUND: 'not-configured',
  API_KEY_INVALID: 'not-configured',
  PROJECT_NOT_FOUND: 'not-configured'
}

function failure(code, extra = {}) {
  return Object.assign(localizedError(MESSAGES[code] ?? MESSAGES.unknown), { code }, extra)
}

function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('invalid-email')
  return email
}

function passwordValue(value, registering = false) {
  // Never trim, case-fold, or otherwise change a password, including at sign-in.
  if (typeof value !== 'string' || !value.length) throw failure('invalid-password')
  if (registering && value.length < 8) throw failure('weak-password')
  return value
}

function caregiverName(value) {
  if (typeof value !== 'string' || value.length > 240) throw failure('invalid-name')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 120 || /\p{Cc}/u.test(name)) throw failure('invalid-name')
  return name
}

function credentials(reply) {
  const expiresIn = Number(reply?.expiresIn)
  if (typeof reply?.idToken !== 'string' || !reply.idToken || typeof reply?.localId !== 'string' || !reply.localId
    || typeof reply?.email !== 'string' || !reply.email || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw failure('invalid-response')
  }
  return { idToken: reply.idToken, uid: reply.localId, email: reply.email,
    displayName: typeof reply.displayName === 'string' ? reply.displayName : '', expiresIn }
}

export function createEmailAuth({ apiKey = '', projectId = '', fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 20000 } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  const project = typeof projectId === 'string' ? projectId.trim() : ''
  const configured = () => Boolean(key && project)

  async function request(action, body, { hideMissingAccount = false } = {}) {
    if (!configured()) throw failure('not-configured')
    if (globalThis.navigator?.onLine === false) throw failure('offline')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${ENDPOINT}${action}?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin'
      })
      let reply
      try { reply = await response.json() }
      catch { throw failure(controller.signal.aborted ? 'timeout' : 'invalid-response') }
      if (!response.ok) {
        // Only translate known error identifiers. Raw provider responses can contain
        // email addresses or internal details and must never reach the interface.
        const providerCode = typeof reply?.error?.message === 'string' ? reply.error.message.split(/[ :]/, 1)[0] : ''
        if (hideMissingAccount && ['EMAIL_NOT_FOUND', 'USER_NOT_FOUND', 'USER_DISABLED', 'INVALID_LOGIN_CREDENTIALS'].includes(providerCode)) return {}
        const code = response.status === 429 ? 'too-many-requests'
          : response.status >= 500 ? 'unavailable' : PROVIDER_ERRORS[providerCode] ?? 'unknown'
        throw failure(code, { status: response.status })
      }
      if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw failure('invalid-response')
      return reply
    } catch (error) {
      if (error?.localized) throw error
      throw failure(controller.signal.aborted ? 'timeout' : 'network')
    } finally { clearTimeout(timer) }
  }

  async function signIn(email, password) {
    return credentials(await request('signInWithPassword', {
      email: emailAddress(email), password: passwordValue(password), returnSecureToken: true
    }))
  }

  async function currentUser(session) {
    const reply = await request('lookup', { idToken: session.idToken })
    const user = reply.users?.[0]
    if (!user || user.localId !== session.uid || typeof user.emailVerified !== 'boolean' || typeof user.email !== 'string'
      || user.email.toLowerCase() !== session.email.toLowerCase()) throw failure('invalid-response')
    if (user.disabled === true) throw failure('user-disabled')
    return user
  }

  async function login(email, password) {
    const session = await signIn(email, password)
    const user = await currentUser(session)
    if (!user.emailVerified) throw failure('email-unverified', { email: session.email })
    return { ...session, displayName: typeof user.displayName === 'string' ? user.displayName : session.displayName }
  }

  return {
    provider: 'firebase', verificationMethod: 'link',
    configured,
    async register(email, password, name) {
      const displayName = caregiverName(name)
      const session = credentials(await request('signUp', {
        email: emailAddress(email), password: passwordValue(password, true), returnSecureToken: true
      }))
      try {
        const updated = await request('update', { idToken: session.idToken, displayName, returnSecureToken: true })
        if (typeof updated.idToken !== 'string' || !updated.idToken) throw failure('invalid-response')
        await request('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: updated.idToken })
      } catch (error) {
        // Creating the provider account succeeded. The form can now offer sign-in,
        // resend, or reset instead of implying that repeating registration is safe.
        throw Object.assign(error, { accountCreated: true, email: session.email })
      }
      return { email: session.email, verificationSent: true }
    },
    login,
    reauthenticate: login,
    async resendVerification(email, password) {
      const session = await signIn(email, password)
      const user = await currentUser(session)
      if (user.emailVerified) return { email: session.email, verificationSent: false, alreadyVerified: true }
      await request('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: session.idToken })
      return { email: session.email, verificationSent: true }
    },
    async sendPasswordReset(email) {
      await request('sendOobCode', { requestType: 'PASSWORD_RESET', email: emailAddress(email) }, { hideMissingAccount: true })
      // Identical result whether an account exists. The form must use conditional
      // language: if an account exists, check its inbox and spam folder.
      return { requested: true }
    }
  }
}

export function createConfiguredEmailAuth({ provider = 'firebase', apiBase, ...firebase } = {}) {
  if (provider === 'neon') return createNeonEmailAuth({ apiBase, fetchImpl: firebase.fetchImpl, timeoutMs: firebase.timeoutMs })
  // Unknown values must not silently send credentials to another provider.
  return createEmailAuth(provider === 'firebase' ? firebase : {})
}

export const emailAuth = createConfiguredEmailAuth({
  provider: import.meta.env.VITE_EMAIL_AUTH_PROVIDER || 'firebase',
  apiBase: import.meta.env.VITE_API_BASE ?? 'http://localhost:8000',
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID
})
