import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { db, exportLocalData } from '../src/db.js'
import { changeParentPin, getParentAccessStatus, MAX_PIN_ATTEMPTS, PARENT_ACCESS_KEY, PIN_COOLDOWN_MS, setupParentPin, unlockParentAccess } from '../src/parent-access.js'

beforeEach(async () => { vi.restoreAllMocks(); await db.settings.clear() })

it('leaves a new device unconfigured and only stores a salted derived credential', async () => {
  expect(await getParentAccessStatus()).toEqual({ configured: false, retryAfterMs: 0 })
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
  expect(await getParentAccessStatus()).toEqual({ configured: true, retryAfterMs: PIN_COOLDOWN_MS })
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
