import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { exportLocalData } from '../../src/storage/messages.js'
import {
  changeParentPin, getParentAccessStatus, getParentPinVersion, MAX_PIN_ATTEMPTS, PARENT_ACCESS_KEY, PIN_COOLDOWN_MS, recoverParentPin, renewRecoveryCode,
  resetParentPinWithAccount, setupParentPin, unlockParentAccess
} from '../../src/parent-access/parent-access.js'

beforeEach(async () => { vi.restoreAllMocks(); await db.settings.clear() })

it('leaves a new device unconfigured and only stores a salted derived credential', async () => {
  expect(await getParentAccessStatus()).toEqual({ configured: false, retryAfterMs: 0, recoverable: false })
  await setupParentPin('482619', '482619')
  const first = (await db.settings.get(PARENT_ACCESS_KEY)).value
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(first)).not.toContain('482619')
  expect(await unlockParentAccess('482619')).toEqual({ ok: true, retryAfterMs: 0 })
  expect(await unlockParentAccess('999999')).toEqual({ ok: false, retryAfterMs: 0 })
  await db.settings.clear()
  await setupParentPin('482619', '482619')
  const second = (await db.settings.get(PARENT_ACCESS_KEY)).value
  expect(second.salt).not.toBe(first.salt)
  expect(second.digest).not.toBe(first.digest)
})

it('rejects malformed and mismatched setup, and cannot overwrite an existing PIN', async () => {
  await expect(setupParentPin('123', '123')).rejects.toMatchObject({ code: 'format' })
  await expect(setupParentPin('1234567', '1234567')).rejects.toMatchObject({ code: 'format' })
  await expect(setupParentPin('abcd', 'abcd')).rejects.toMatchObject({ code: 'format' })
  await expect(setupParentPin('1234', '4321')).rejects.toMatchObject({ code: 'mismatch' })
  await setupParentPin('1234', '1234')
  await expect(setupParentPin('4321', '4321')).rejects.toMatchObject({ code: 'configured' })
  expect((await unlockParentAccess('1234')).ok).toBe(true)
})

it('persists a bounded-attempt cooldown, including correct PIN attempts during the cooldown', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  await setupParentPin('5678', '5678')
  for (let attempt = 1; attempt <= MAX_PIN_ATTEMPTS; attempt++) {
    expect(await unlockParentAccess('1111')).toEqual({ ok: false, retryAfterMs: attempt === MAX_PIN_ATTEMPTS ? PIN_COOLDOWN_MS : 0 })
  }
  expect(await getParentAccessStatus()).toEqual({ configured: true, retryAfterMs: PIN_COOLDOWN_MS, recoverable: true })
  expect(await unlockParentAccess('5678')).toEqual({ ok: false, retryAfterMs: PIN_COOLDOWN_MS })
  clock.mockReturnValue(1_000_000 + PIN_COOLDOWN_MS + 1)
  expect(await unlockParentAccess('1111')).toEqual({ ok: false, retryAfterMs: 0 })
  expect((await db.settings.get(PARENT_ACCESS_KEY)).value.failures).toBe(1)
  expect((await unlockParentAccess('5678')).ok).toBe(true)
  expect((await db.settings.get(PARENT_ACCESS_KEY)).value.failures).toBe(0)
})

it('requires the existing PIN to change it and never exports the credential', async () => {
  await setupParentPin('5678', '5678')
  expect((await changeParentPin('9999', '246810', '246810')).ok).toBe(false)
  expect((await unlockParentAccess('5678')).ok).toBe(true)
  await expect(changeParentPin('5678', '246810', '246811')).rejects.toMatchObject({ code: 'mismatch' })
  expect((await changeParentPin('5678', '246810', '246810')).ok).toBe(true)
  expect((await unlockParentAccess('5678')).ok).toBe(false)
  expect((await unlockParentAccess('246810')).ok).toBe(true)
  expect(JSON.stringify(await exportLocalData())).not.toMatch(/parent-access|digest|salt|246810/)
})

it('fails closed on damaged stored credentials instead of offering first-time setup', async () => {
  await db.settings.put({ key: PARENT_ACCESS_KEY, value: { version: 1, digest: 'broken' } })
  await expect(getParentAccessStatus()).rejects.toMatchObject({ code: 'storage' })
  await expect(unlockParentAccess('1234')).rejects.toMatchObject({ code: 'storage' })
  await expect(setupParentPin('1234', '1234')).rejects.toMatchObject({ code: 'configured' })
})

const CODE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/
const stored = async () => JSON.stringify((await db.settings.get(PARENT_ACCESS_KEY)).value)

it('gives a recovery code at setup that sets a new PIN once, and is never stored as written', async () => {
  const { recoveryCode } = await setupParentPin('5678', '5678')
  expect(recoveryCode).toMatch(CODE)
  expect(await stored()).not.toContain(recoveryCode.replaceAll('-', ''))
  expect(await getParentAccessStatus()).toMatchObject({ recoverable: true })
  await expect(recoverParentPin('ABC', '2468', '2468')).rejects.toMatchObject({ code: 'recoveryformat' })
  await expect(recoverParentPin(recoveryCode, '2468', '2469')).rejects.toMatchObject({ code: 'mismatch' })
  // Spaces, dashes and lower case are forgiven when the code is typed back.
  const result = await recoverParentPin(` ${recoveryCode.toLowerCase().replaceAll('-', ' ')} `, '2468', '2468')
  expect(result.ok).toBe(true)
  expect(result.recoveryCode).toMatch(CODE)
  expect(result.recoveryCode).not.toBe(recoveryCode)
  expect((await unlockParentAccess('5678')).ok).toBe(false)
  expect((await unlockParentAccess('2468')).ok).toBe(true)
  expect((await recoverParentPin(recoveryCode, '1357', '1357')).ok).toBe(false)
  expect((await recoverParentPin(result.recoveryCode, '1357', '1357')).ok).toBe(true)
})

it('counts wrong recovery codes with wrong PINs towards the same cooldown', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
  const { recoveryCode } = await setupParentPin('5678', '5678')
  for (let attempt = 1; attempt < MAX_PIN_ATTEMPTS; attempt++) expect((await unlockParentAccess('1111')).ok).toBe(false)
  expect(await recoverParentPin('AAAA-BBBB-CCCC-DDDD', '2468', '2468')).toEqual({ ok: false, retryAfterMs: PIN_COOLDOWN_MS })
  expect(await recoverParentPin(recoveryCode, '2468', '2468')).toEqual({ ok: false, retryAfterMs: PIN_COOLDOWN_MS })
})

it('keeps the recovery code when the PIN changes, and makes a new one only with the PIN', async () => {
  const { recoveryCode } = await setupParentPin('5678', '5678')
  expect((await changeParentPin('5678', '2468', '2468')).ok).toBe(true)
  expect((await renewRecoveryCode('9999')).ok).toBe(false)
  const renewed = await renewRecoveryCode('2468')
  expect(renewed.recoveryCode).toMatch(CODE)
  expect((await recoverParentPin(recoveryCode, '1357', '1357')).ok).toBe(false)
  expect((await recoverParentPin(renewed.recoveryCode, '1357', '1357')).ok).toBe(true)
})

it('lets a PIN set before recovery codes keep working and gain a code from the PIN', async () => {
  await setupParentPin('5678', '5678')
  const { recoverySalt, recoveryDigest, ...current } = (await db.settings.get(PARENT_ACCESS_KEY)).value
  await db.settings.put({ key: PARENT_ACCESS_KEY, value: { ...current, version: 1 } })
  expect(await getParentAccessStatus()).toMatchObject({ configured: true, recoverable: false })
  expect((await unlockParentAccess('5678')).ok).toBe(true)
  await expect(recoverParentPin('AAAA-BBBB-CCCC-DDDD', '2468', '2468')).rejects.toMatchObject({ code: 'norecovery' })
  const { recoveryCode } = await renewRecoveryCode('5678')
  expect(await getParentAccessStatus()).toMatchObject({ recoverable: true })
  expect((await recoverParentPin(recoveryCode, '2468', '2468')).ok).toBe(true)
})

it('sets a new PIN and recovery code after the linked account signed in, keeping the format rules', async () => {
  await setupParentPin('5678', '5678')
  await expect(resetParentPinWithAccount('12', '12')).rejects.toMatchObject({ code: 'format' })
  const result = await resetParentPinWithAccount('2468', '2468')
  expect(result.recoveryCode).toMatch(CODE)
  expect((await unlockParentAccess('2468')).ok).toBe(true)
  expect(JSON.stringify(await exportLocalData())).not.toMatch(/recovery|digest|salt/)
})

const emailAccount = { user_id: 'caregiver-a', email: 'parent@example.test', auth_provider: 'firebase' }

it('recovers the local PIN with fresh proof for the unchanged linked email account', async () => {
  await setupParentPin('5678', '5678')
  await db.settings.bulkPut([{ key: 'account', value: emailAccount }, { key: 'token', value: 'fresh-token' }])
  const proof = { account: emailAccount, token: 'fresh-token', gate: await getParentPinVersion() }
  const result = await resetParentPinWithAccount('2468', '2468', proof)
  expect(result.recoveryCode).toMatch(CODE)
  expect((await unlockParentAccess('2468')).ok).toBe(true)
})

it.each(['account switch', 'sign out', 'PIN change'])('rejects email PIN recovery when %s happens during hashing', async kind => {
  await setupParentPin('5678', '5678')
  await db.settings.bulkPut([{ key: 'account', value: emailAccount }, { key: 'token', value: 'fresh-token' }])
  const previous = await db.settings.get(PARENT_ACCESS_KEY)
  const proof = { account: emailAccount, token: 'fresh-token', gate: await getParentPinVersion() }
  // Prepare another tab's changed credential before blocking Web Crypto below.
  await changeParentPin('5678', '9753', '9753')
  const replacement = await db.settings.get(PARENT_ACCESS_KEY)
  await db.settings.put(previous)
  let started, resume
  const hashing = new Promise(resolve => { started = resolve })
  const release = new Promise(resolve => { resume = resolve })
  const derive = crypto.subtle.deriveBits.bind(crypto.subtle)
  const spy = vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(async (...args) => {
    started()
    await release
    return derive(...args)
  })
  const resetting = resetParentPinWithAccount('2468', '2468', proof)
  const rejected = expect(resetting).rejects.toMatchObject({ code: 'changed' })
  await hashing
  if (kind === 'account switch') await db.settings.put({ key: 'account', value: { ...emailAccount, user_id: 'caregiver-b' } })
  else if (kind === 'sign out') await db.settings.delete('token')
  else await db.settings.put(replacement)
  resume()
  await rejected
  spy.mockRestore()
  expect((await unlockParentAccess(kind === 'PIN change' ? '9753' : '5678')).ok).toBe(true)
  expect((await unlockParentAccess('2468')).ok).toBe(false)
})
