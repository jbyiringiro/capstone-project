import { db } from './db.js'

// A local adult gate, not a server account or protection against device owners.
// Never persist a PIN or an unlocked session. Storage errors fail closed.
export const PARENT_ACCESS_KEY = 'parent-access:v1'
export const MAX_PIN_ATTEMPTS = 5
export const PIN_COOLDOWN_MS = 30_000
export const PARENT_IDLE_MS = 5 * 60_000
const ITERATIONS = 210_000
const PIN_PATTERN = /^\d{4,6}$/
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
const unhex = value => Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16))

export class ParentAccessError extends Error {
  constructor(code) { super(code); this.code = code }
}

export function validParentPin(pin) { return typeof pin === 'string' && PIN_PATTERN.test(pin) }

function checked(record) {
  if (!record) return null
  const value = record.value
  if (value?.version !== 1 || value.iterations !== ITERATIONS || !/^[a-f0-9]{32}$/.test(value.salt)
    || !/^[a-f0-9]{64}$/.test(value.digest) || !Number.isInteger(value.failures) || value.failures < 0
    || !Number.isFinite(value.lockedUntil) || value.lockedUntil < 0) throw new ParentAccessError('storage')
  return value
}

function status(value, now) {
  return { configured: !!value, retryAfterMs: Math.max(0, (value?.lockedUntil ?? 0) - now) }
}

export async function getParentAccessStatus(now = Date.now()) {
  return status(checked(await db.settings.get(PARENT_ACCESS_KEY)), now)
}

async function derive(pin, salt) {
  if (!globalThis.crypto?.subtle) throw new ParentAccessError('crypto')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)))
}

async function credential(pin) {
  if (!validParentPin(pin)) throw new ParentAccessError('format')
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { version: 1, salt, digest: await derive(pin, salt), iterations: ITERATIONS, failures: 0, lockedUntil: 0 }
}

export async function setupParentPin(pin, confirmation) {
  if (pin !== confirmation) throw new ParentAccessError('mismatch')
  const value = await credential(pin)
  await db.transaction('rw', db.settings, async () => {
    // Two open tabs cannot silently replace the first adult's chosen PIN.
    if (await db.settings.get(PARENT_ACCESS_KEY)) throw new ParentAccessError('configured')
    await db.settings.put({ key: PARENT_ACCESS_KEY, value })
  })
  return { ok: true, retryAfterMs: 0 }
}

async function checkPin(pin, replacement = null, now = () => Date.now()) {
  if (!validParentPin(pin)) throw new ParentAccessError('format')
  const initial = checked(await db.settings.get(PARENT_ACCESS_KEY))
  if (!initial) throw new ParentAccessError('unconfigured')
  if (initial.lockedUntil > now()) return { ok: false, retryAfterMs: initial.lockedUntil - now() }
  // Keep slow Web Crypto work outside the IndexedDB transaction.
  const digest = await derive(pin, initial.salt)
  return db.transaction('rw', db.settings, async () => {
    const current = checked(await db.settings.get(PARENT_ACCESS_KEY))
    if (!current || current.digest !== initial.digest || current.salt !== initial.salt) throw new ParentAccessError('changed')
    const instant = now()
    if (current.lockedUntil > instant) return { ok: false, retryAfterMs: current.lockedUntil - instant }
    const ok = digest === current.digest
    const failures = ok ? 0 : (current.lockedUntil ? 0 : current.failures) + 1
    const lockedUntil = failures >= MAX_PIN_ATTEMPTS ? instant + PIN_COOLDOWN_MS : 0
    await db.settings.put({ key: PARENT_ACCESS_KEY, value: ok && replacement ? replacement : { ...current, failures, lockedUntil } })
    return { ok, retryAfterMs: lockedUntil ? PIN_COOLDOWN_MS : 0 }
  })
}

export const unlockParentAccess = pin => checkPin(pin)

export async function changeParentPin(currentPin, nextPin, confirmation) {
  if (nextPin !== confirmation) throw new ParentAccessError('mismatch')
  return checkPin(currentPin, await credential(nextPin))
}
