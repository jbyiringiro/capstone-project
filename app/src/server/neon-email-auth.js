import { localizedError } from '../shared/errors-rw.js'

// The Vuga API carries the Neon session in an encrypted bearer envelope. Browsers
// never contact Neon or rely on cross-site cookies (including Safari on iPhone).
const MESSAGES = {
  'not-configured': 'Konti za email ntiziraboneka ubu. Ushobora gukomeza nta konti.',
  offline: 'Nta interineti iri kuri iki gikoresho. Yifungure, wongere ugerageze.',
  network: 'Ntibyashobotse guhuza na serivisi ya konti. Ongera ugerageze nyuma gato.',
  timeout: 'Serivisi ya konti yatinze gusubiza. Ongera ugerageze nyuma gato.',
  'invalid-email': 'Andika aderesi ya email ikora, nka izina@example.com.',
  'invalid-name': 'Andika izina ryawe nk’umurezi, inyuguti zitarenze 120.',
  'invalid-password': 'Andika ijambo ry’ibanga rya konti yawe.',
  'weak-password': 'Koresha ijambo ry’ibanga rifite inyuguti 8 kugeza kuri 128.',
  'invalid-credentials': 'Email cyangwa ijambo ry’ibanga si byo. Ongera ugerageze.',
  'email-unverified': 'Banza wemeze email ukoresheje kode woherejwe.',
  'email-exists': 'Iyi email isanzwe ifite konti. Injira cyangwa uhindure ijambo ry’ibanga.',
  'invalid-code': 'Kode si yo cyangwa yararangiye. Reba email cyangwa usabe indi kode.',
  'too-many-requests': 'Wagerageje kenshi. Tegereza gato, wongere ugerageze.',
  'user-disabled': 'Iyi konti yarahagaritswe. Vugana n’ushinzwe Vuga.',
  'invalid-token': 'Igihe cyo kwinjira cyarangiye. Ongera winjire.',
  'password-reset-completed': 'Ijambo ry’ibanga ryahinduwe, ariko gufunga izindi nshuro winjiyemo ntibirarangira. Kanda «Rangiza guhindura ijambo ry’ibanga».',
  'invalid-response': 'Serivisi ya konti ntiyasubije neza. Ongera ugerageze nyuma gato.',
  unavailable: 'Serivisi ya konti ntiri gukora ubu. Ongera ugerageze nyuma.',
  unknown: 'Ntibyashobotse gukomeza kuri konti. Ongera ugerageze nyuma gato.'
}
const CODES = {
  EMAIL_NOT_VERIFIED: 'email-unverified', INVALID_EMAIL_OR_PASSWORD: 'invalid-credentials',
  INVALID_EMAIL: 'invalid-email', INVALID_PASSWORD: 'invalid-credentials', USER_NOT_FOUND: 'invalid-credentials',
  USER_ALREADY_EXISTS: 'email-exists', USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'email-exists', EMAIL_EXISTS: 'email-exists',
  INVALID_OTP: 'invalid-code', OTP_EXPIRED: 'invalid-code', OTP_NOT_FOUND: 'invalid-code',
  TOO_MANY_ATTEMPTS: 'too-many-requests', TOO_MANY_REQUESTS: 'too-many-requests',
  PASSWORD_TOO_SHORT: 'weak-password', PASSWORD_TOO_LONG: 'weak-password',
  USER_DISABLED: 'user-disabled', INVALID_TOKEN: 'invalid-token', NOT_CONFIGURED: 'not-configured',
  VERIFICATION_CONFIGURATION_REQUIRED: 'not-configured', PASSWORD_RESET_COMPLETED: 'password-reset-completed'
}
const failure = (code, extra = {}) => Object.assign(localizedError(MESSAGES[code] || MESSAGES.unknown), { code }, extra)
function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('invalid-email')
  return email
}
function passwordValue(value, creating = false) {
  if (typeof value !== 'string' || !value.length) throw failure('invalid-password')
  if (value.length > 128 || (creating && value.length < 8)) throw failure('weak-password')
  return value // Passwords, including intentional leading/trailing spaces, are never changed.
}
function codeValue(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw failure('invalid-code')
  return value
}

export function createNeonEmailAuth({ apiBase = '', fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 45000 } = {}) {
  const base = typeof apiBase === 'string' ? apiBase.trim().replace(/\/$/, '') : ''
  const configured = () => {
    try {
      const url = new URL(base)
      return !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    } catch { return false }
  }
  async function request(path, body) {
    if (!configured()) throw failure('not-configured')
    if (globalThis.navigator?.onLine === false) throw failure('offline')
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${base}/auth/neon/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
      })
      if (response.status === 204 && response.ok) return {}
      const reply = await response.json().catch(() => null)
      if (!response.ok) {
        const detail = reply?.detail && typeof reply.detail === 'object' ? reply.detail : reply
        const code = response.status === 429 ? 'too-many-requests' : CODES[detail?.code] || (response.status >= 500 ? 'unavailable' : 'unknown')
        throw failure(code, { status: response.status, ...(detail?.accountCreated === true ? { accountCreated: true } : {}),
          ...(code === 'password-reset-completed' ? { passwordReset: true } : {}) })
      }
      if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw failure('invalid-response')
      return reply
    } catch (error) {
      if (error?.localized) throw error
      throw failure(controller.signal.aborted ? 'timeout' : 'network')
    } finally { clearTimeout(timer) }
  }
  async function login(email, password) {
    const address = emailAddress(email)
    const reply = await request('login', { email: address, password: passwordValue(password) })
    const expiresIn = Number(reply.expiresIn)
    if (typeof reply.idToken !== 'string' || !reply.idToken.startsWith('neon.') || reply.idToken.length < 6
      || typeof reply.uid !== 'string' || !reply.uid || typeof reply.email !== 'string' || reply.email.toLowerCase() !== address
      || !Number.isFinite(expiresIn) || expiresIn <= 0) throw failure('invalid-response')
    return { idToken: reply.idToken, uid: reply.uid, email: reply.email, displayName: typeof reply.displayName === 'string' ? reply.displayName : '', expiresIn }
  }
  return {
    provider: 'neon', verificationMethod: 'code', configured, login, reauthenticate: login,
    async register(email, password, name) {
      if (typeof name !== 'string' || name.length > 240) throw failure('invalid-name')
      const displayName = name.trim().replace(/\s+/g, ' ')
      if (!displayName || displayName.length > 120 || /\p{Cc}/u.test(displayName)) throw failure('invalid-name')
      const address = emailAddress(email)
      const reply = await request('register', { name: displayName, email: address, password: passwordValue(password, true) })
      if (reply.verificationSent !== true) throw failure('invalid-response', { accountCreated: true })
      return { email: address, verificationSent: true }
    },
    async verifyEmail(email, otp) {
      const address = emailAddress(email)
      const reply = await request('verify', { email: address, otp: codeValue(otp) })
      if (reply.verified !== true) throw failure('invalid-response')
      return { email: address, verified: true }
    },
    async resendVerification(email) {
      const address = emailAddress(email)
      const reply = await request('resend', { email: address })
      if (reply.verificationSent !== true) throw failure('invalid-response')
      return { email: address, verificationSent: true }
    },
    async sendPasswordReset(email) {
      const reply = await request('password-reset/request', { email: emailAddress(email) })
      if (reply.sent !== true) throw failure('invalid-response')
      return { requested: true } // Same response for existing and missing accounts.
    },
    async confirmPasswordReset(email, otp, password) {
      const reply = await request('password-reset/confirm', { email: emailAddress(email), otp: codeValue(otp), password: passwordValue(password, true) })
      if (reply.reset !== true) throw failure('invalid-response')
      return { reset: true }
    },
    async finishPasswordReset(email, password) {
      const reply = await request('password-reset/finish', { email: emailAddress(email), password: passwordValue(password) })
      if (reply.reset !== true) throw failure('invalid-response')
      return { reset: true }
    },
    async signOut(idToken) {
      if (typeof idToken === 'string' && idToken.startsWith('neon.')) await request('signout', { id_token: idToken })
    }
  }
}
