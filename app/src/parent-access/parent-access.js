import { db } from '../storage/db.js'

// A local adult gate, not a server account or protection against device owners.
// Never persist a PIN, a recovery code or an unlocked session. Storage errors fail closed.
// A forgotten PIN is replaced with the recovery code shown when it was set, or after signing in
// to the Vuga account linked to this device; either way every child's data stays.
export const PARENT_ACCESS_KEY = 'parent-access:v1'
export const MAX_PIN_ATTEMPTS = 5
export const PIN_COOLDOWN_MS = 30_000
export const PARENT_IDLE_MS = 5 * 60_000
const ITERATIONS = 210_000
const PIN_PATTERN = /^\d{4,6}$/
// Sixteen letters and digits without look-alikes (no I, O, 0 or 1): 80 bits, written as four groups.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RECOVERY_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
const unhex = value => Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16))

export class ParentAccessError extends Error {
  constructor(code) { super(code); this.code = code }
}

export function validParentPin(pin) { return typeof pin === 'string' && PIN_PATTERN.test(pin) }
export const normaliseRecoveryCode = code => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const formatRecoveryCode = code => code.match(/.{4}/g).join('-')

function recoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map(value => RECOVERY_ALPHABET[value % RECOVERY_ALPHABET.length]).join('')
}

// Version 1 records predate recovery codes and keep working; they gain a code when one is made.
function checked(record) {
  if (!record) return null
  const value = record.value
  const digestOk = (salt, digest) => /^[a-f0-9]{32}$/.test(salt) && /^[a-f0-9]{64}$/.test(digest)
  if (![1, 2].includes(value?.version) || value.iterations !== ITERATIONS || !digestOk(value.salt, value.digest)
    || (value.version === 2 && !digestOk(value.recoverySalt, value.recoveryDigest))
    || !Number.isInteger(value.failures) || value.failures < 0
    || !Number.isFinite(value.lockedUntil) || value.lockedUntil < 0) throw new ParentAccessError('storage')
  return value
}

function status(value, now) {
  return { configured: !!value, retryAfterMs: Math.max(0, (value?.lockedUntil ?? 0) - now), recoverable: value?.version === 2 }
}

export async function getParentAccessStatus(now = Date.now()) {
  return status(checked(await db.settings.get(PARENT_ACCESS_KEY)), now)
}

async function derive(secret, salt) {
  if (!globalThis.crypto?.subtle) throw new ParentAccessError('crypto')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'])
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)))
}

async function hashed(secret) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, digest: await derive(secret, salt) }
}

// A new PIN with a new recovery code; the code is returned once to be shown, and never stored.
async function credential(pin, confirmation) {
  if (!validParentPin(pin)) throw new ParentAccessError('format')
  if (pin !== confirmation) throw new ParentAccessError('mismatch')
  const code = recoveryCode()
  const [secret, recovery] = await Promise.all([hashed(pin), hashed(code)])
  return {
    recoveryCode: formatRecoveryCode(code),
    value: { version: 2, ...secret, recoverySalt: recovery.salt, recoveryDigest: recovery.digest, iterations: ITERATIONS, failures: 0, lockedUntil: 0 }
  }
}

export async function setupParentPin(pin, confirmation) {
  const { recoveryCode, value } = await credential(pin, confirmation)
  await db.transaction('rw', db.settings, async () => {
    // Two open tabs cannot silently replace the first adult's chosen PIN.
    if (await db.settings.get(PARENT_ACCESS_KEY)) throw new ParentAccessError('configured')
    await db.settings.put({ key: PARENT_ACCESS_KEY, value })
  })
  return { ok: true, retryAfterMs: 0, recoveryCode }
}

// Checks the PIN, or the recovery code, against the shared attempt limit. On success the record
// becomes `replace(current)` when given.
async function check(secret, { recovery = false, replace = null, now = () => Date.now() } = {}) {
  const initial = checked(await db.settings.get(PARENT_ACCESS_KEY))
  if (!initial) throw new ParentAccessError('unconfigured')
  if (recovery && initial.version !== 2) throw new ParentAccessError('norecovery')
  if (initial.lockedUntil > now()) return { ok: false, retryAfterMs: initial.lockedUntil - now() }
  // Keep slow Web Crypto work outside the IndexedDB transaction.
  const digest = await derive(secret, recovery ? initial.recoverySalt : initial.salt)
  return db.transaction('rw', db.settings, async () => {
    const current = checked(await db.settings.get(PARENT_ACCESS_KEY))
    if (!current || current.digest !== initial.digest || current.salt !== initial.salt) throw new ParentAccessError('changed')
    const instant = now()
    if (current.lockedUntil > instant) return { ok: false, retryAfterMs: current.lockedUntil - instant }
    const ok = digest === (recovery ? current.recoveryDigest : current.digest)
    const failures = ok ? 0 : (current.lockedUntil ? 0 : current.failures) + 1
    const lockedUntil = failures >= MAX_PIN_ATTEMPTS ? instant + PIN_COOLDOWN_MS : 0
    await db.settings.put({ key: PARENT_ACCESS_KEY, value: ok && replace ? replace(current) : { ...current, failures, lockedUntil } })
    return { ok, retryAfterMs: lockedUntil ? PIN_COOLDOWN_MS : 0 }
  })
}

export const unlockParentAccess = pin => check(pin)

// A new PIN keeps the recovery code the adult already wrote down.
export async function changeParentPin(currentPin, nextPin, confirmation) {
  if (!validParentPin(nextPin)) throw new ParentAccessError('format')
  if (nextPin !== confirmation) throw new ParentAccessError('mismatch')
  const secret = await hashed(nextPin)
  return check(currentPin, { replace: current => ({ ...current, ...secret, failures: 0, lockedUntil: 0 }) })
}

// A fresh recovery code for this PIN, replacing the old one (or giving a version 1 PIN its first).
export async function renewRecoveryCode(pin) {
  const code = recoveryCode()
  const recovery = await hashed(code)
  const result = await check(pin, { replace: current => ({ ...current, version: 2, recoverySalt: recovery.salt, recoveryDigest: recovery.digest, failures: 0, lockedUntil: 0 }) })
  return result.ok ? { ...result, recoveryCode: formatRecoveryCode(code) } : result
}

// The forgotten-PIN path: the written-down code sets a new PIN, and a new code replaces the used one.
export async function recoverParentPin(code, pin, confirmation) {
  const entered = normaliseRecoveryCode(code)
  if (!RECOVERY_PATTERN.test(entered)) throw new ParentAccessError('recoveryformat')
  const next = await credential(pin, confirmation)
  const result = await check(entered, { recovery: true, replace: () => next.value })
  return result.ok ? { ...result, recoveryCode: next.recoveryCode } : result
}

// Called only after the adult has signed in to the Vuga account linked to this device.
export async function resetParentPinWithAccount(pin, confirmation) {
  const next = await credential(pin, confirmation)
  await db.settings.put({ key: PARENT_ACCESS_KEY, value: next.value })
  return { ok: true, retryAfterMs: 0, recoveryCode: next.recoveryCode }
}
