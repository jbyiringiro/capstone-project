// Thin client for the Vuga API. The token lives in IndexedDB settings so the dashboard survives reloads.
import { db } from '../storage/db.js'
import { localizedError } from '../shared/errors-rw.js'
import { normalisePhone } from './phone.js'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

export async function getToken() { return (await db.settings.get('token'))?.value ?? null }
export async function setToken(value) { await db.settings.put({ key: 'token', value }) }
// The account this device is linked to, by the caregiver's mobile number. It can reset a forgotten
// PIN here, and it is kept after signing out. `stale` marks a PIN the account no longer takes.
export async function getLinkedAccount() { return (await db.settings.get('account'))?.value ?? null }

// How long to wait, in words: amasegonda 45, or iminota 12.
export const waitText = seconds => (seconds < 90 ? `amasegonda ${Math.max(1, Math.round(seconds))}` : `iminota ${Math.ceil(seconds / 60)}`)

// A request's own messages, by status, come before the general ones; a function receives the
// server's reply, which the error also carries as `reply`.
async function req(path, { method = 'GET', body, form, auth = true, errors = {} } = {}) {
  const headers = {}
  const token = auth ? await getToken() : null
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) { payload = new URLSearchParams(form); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json' }
  let r
  try { r = await fetch(`${API_BASE}${path}`, { method, headers, body: payload }) }
  catch { throw localizedError('Ntibyashobotse guhuza na seriveri. Reba niba ufite interineti, wongere ugerageze.') }
  if (!r.ok) {
    const reply = await r.json().catch(() => ({}))
    // The server refused the session: it expired, or the PIN changed on another device.
    if (r.status === 401 && token) await setToken(null)
    const messages = {
      401: 'Ntiwemerewe gukomeza. Ongera winjire ukoresheje nimero yawe n’umubare w’ibanga.',
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
  return r.status === 204 ? null : r.json()
}

const WRONG_CODE = 'Kode si yo cyangwa yararangiye. Yandike neza, cyangwa usabe indi.'
const NUMBER_TAKEN = 'Iyi nimero isanzwe ifite konti ya Vuga. Injira ukoresheje umubare w’ibanga wayo.'
export const NO_ACCOUNT = 'Iyi nimero ntifite konti ya Vuga. Reba ko wayanditse neza, cyangwa ufungure konti nshya.'
const WRONG_PIN = 'Nimero cyangwa umubare w’ibanga si byo. Ongera ugerageze.'
const PIN_LOCKED = reply => `Umubare w’ibanga wanditswe nabi inshuro eshanu. Tegereza ${waitText(reply.retry_after ?? 900)}, cyangwa uhindure umubare w’ibanga ukoresheje SMS.`

// A caregiver has one PIN: it opens the caregiver area on each device and signs in to the account.
export const api = {
  // Texts a six-digit code to the number: 'register' before opening an account, 'reset' before
  // choosing a new PIN. The reply says how many seconds until another code may be asked for; a
  // number that already has an account (409), or has none for a reset (404), gets no code.
  sendCode: (phone, purpose) => req('/auth/code', {
    method: 'POST', body: { phone, purpose }, auth: false, errors: {
      404: NO_ACCOUNT,
      409: NUMBER_TAKEN,
      422: 'Andika nimero ya telefoni igendanwa yo mu Rwanda, nka 0788 123 456.',
      429: reply => `Tegereza ${waitText(reply.retry_after ?? 60)}, wongere usabe kode.`,
      502: 'Ntibyashobotse kohereza SMS. Ongera ugerageze nyuma gato.'
    }
  }),
  register: (phone, code, pin, name = '', role = 'teacher') => req('/auth/register', { method: 'POST', body: { name, phone, code, pin, role }, auth: false, errors: { 400: WRONG_CODE, 409: NUMBER_TAKEN } }),
  resetPin: (phone, code, pin) => req('/auth/reset-pin', { method: 'POST', body: { phone, code, pin }, auth: false, errors: { 400: WRONG_CODE, 404: NO_ACCOUNT } }),
  // A new PIN ends every session opened with the old one, this device's too, so a device that was
  // signed in signs in again with the new PIN.
  changePin: async (phone, pin, newPin) => {
    const signedIn = !!(await getToken())
    await req('/auth/change-pin', { method: 'POST', body: { phone, pin, new_pin: newPin }, auth: false, errors: { 401: WRONG_PIN, 429: PIN_LOCKED } })
    if (signedIn) await api.login(phone, newPin).catch(() => setToken(null))
    return null
  },
  login: async (phone, pin) => {
    const number = normalisePhone(phone) ?? String(phone ?? '').trim()
    const t = await req('/auth/login', { method: 'POST', form: { username: number, password: pin }, auth: false, errors: { 401: WRONG_PIN, 429: PIN_LOCKED } })
    await setToken(t.access_token)
    await db.settings.put({ key: 'account', value: { phone: number } })
    return t
  },
  logout: () => setToken(null),
  symbols: () => req('/symbols', { auth: false }),
  profiles: () => req('/profiles'),
  createProfile: (code, age_band) => req('/profiles', { method: 'POST', body: { code, age_band } }),
  vocabulary: (pid) => req(`/profiles/${pid}/vocabulary`),
  setVocabulary: (pid, symbol_ids) => req(`/profiles/${pid}/vocabulary`, { method: 'PUT', body: { symbol_ids } }),
  summary: (pid) => req(`/profiles/${pid}/summary`),
  health: () => req('/health', { auth: false }),
  backupStatus: () => req('/backup/status'),
  loadBackup: () => req('/backup'),
  // `base_revision` is the account copy this device last saved or received; a newer one (409)
  // means another device saved in between, and the caregiver chooses in Ohereza.
  saveBackup: (snapshot, base_revision) => req('/backup', {
    method: 'PUT', body: { ...snapshot, base_revision },
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
