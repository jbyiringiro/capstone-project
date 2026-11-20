import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { createBackup } from '../../src/storage/backup.js'
import { api } from '../../src/server/api-client.js'
import { accountIdentity, displayAccount, sameAccount } from '../../src/server/account-identity.js'
import { accountBackupState, connectAccount, restoreFromAccount, saveToAccount } from '../../src/server/account-backup.js'

const FIRST = { user_id: 'adult-1', email: 'parent@example.com', name: 'Uwase', auth_provider: 'firebase' }
const SECOND = { user_id: 'adult-2', email: 'parent@example.com', name: 'New owner', auth_provider: 'firebase' }

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('navigator', { onLine: true })
  await Promise.all(db.tables.map(table => table.clear()))
})

async function device(account, state = null) {
  await db.settings.bulkPut([{ key: 'account', value: account }, { key: 'token', value: 'test-token' }, { key: 'mode', value: 'predictive' }])
  if (state) await db.settings.put({ key: 'account-backup', value: { ...state, revision: 7, fingerprint: 'older-copy' } })
}

function remoteCopy() {
  let saved
  const status = vi.spyOn(api, 'backupStatus').mockResolvedValue({ revision: 0, saved_at: null })
  const save = vi.spyOn(api, 'saveBackup').mockImplementation(async (snapshot, revision) => {
    saved = { ...snapshot, revision: revision + 1, saved_at: '2026-11-05T12:00:00Z' }
    return { revision: saved.revision, saved_at: saved.saved_at }
  })
  const read = vi.spyOn(api, 'loadBackup').mockImplementation(async () => saved)
  return { status, save, read }
}

describe('account identity and backup ownership', () => {
  it('uses immutable user ids for email accounts, including reused and renamed addresses', () => {
    expect(sameAccount(FIRST, { ...FIRST, email: 'renamed@example.com' })).toBe(true)
    expect(sameAccount(FIRST, SECOND)).toBe(false)
    expect(sameAccount(FIRST, { email: FIRST.email })).toBe(false)
    expect(sameAccount({ email: FIRST.email }, { email: FIRST.email })).toBe(false)
    expect(accountIdentity(FIRST)).toEqual({ user_id: FIRST.user_id, email: FIRST.email, auth_provider: 'firebase' })
    expect(displayAccount(FIRST)).toBe(FIRST.email)
  })

  it('never matches null or absent phone numbers while preserving normalized legacy phone matching', () => {
    expect(sameAccount(null, null)).toBe(false)
    expect(sameAccount({ phone: null }, { phone: null })).toBe(false)
    expect(sameAccount({}, {})).toBe(false)
    expect(sameAccount({ phone: '0788 123 456' }, { phone: '+250788123456' })).toBe(true)
    expect(sameAccount({ phone: '+250788123456', auth_provider: 'firebase' }, { phone: '+250788123456' })).toBe(false)
    expect(sameAccount({ phone: '+250788123456', user_id: 'old' }, { phone: '+250788123456', user_id: 'new' })).toBe(false)
  })

  it('keeps Neon ownership and refuses to merge a prior Firebase account by email', () => {
    const neon = { ...FIRST, user_id: 'neon-vuga-user', auth_provider: 'neon' }
    expect(accountIdentity(neon)).toEqual({ user_id: neon.user_id, email: neon.email, auth_provider: 'neon' })
    expect(sameAccount(neon, FIRST)).toBe(false)
    expect(sameAccount(neon, { email: FIRST.email })).toBe(false)
    expect(sameAccount(neon, { ...neon, email: 'renamed@example.test' })).toBe(true)
    expect(sameAccount({ phone: '+250788123456', auth_provider: 'neon' }, { phone: '+250788123456' })).toBe(false)
  })

  it('rejects a saved backup join from a former owner of the same email without any upload', async () => {
    await device(SECOND, FIRST)
    const remote = remoteCopy()
    expect(await accountBackupState()).toBeNull()
    expect(await saveToAccount()).toBeNull()
    expect(remote.save).not.toHaveBeenCalled()
  })

  it('rejects a missing-identity backup join for an email account even if both phones are absent', async () => {
    await device(FIRST, { phone: null })
    const remote = remoteCopy()
    expect(await accountBackupState()).toBeNull()
    expect(await saveToAccount()).toBeNull()
    expect(remote.save).not.toHaveBeenCalled()
  })

  it('records the immutable email identity when first joining and saves only that joined revision', async () => {
    await device(FIRST)
    const remote = remoteCopy()
    expect(await connectAccount()).toMatchObject({ action: 'saved', revision: 1 })
    expect(await accountBackupState()).toMatchObject({ user_id: FIRST.user_id, email: FIRST.email, revision: 1 })
    expect(remote.status).toHaveBeenCalledWith('test-token')
    expect(remote.read).toHaveBeenCalledWith('test-token')
    expect(remote.save.mock.calls[0][2]).toBe('test-token')
    await db.settings.put({ key: 'mode', value: 'static' })
    expect(await saveToAccount()).toMatchObject({ revision: 2 })
    expect(remote.save.mock.calls[1][1]).toBe(1)
    expect(remote.save.mock.calls[1][0].data.settings).toContainEqual({ key: 'mode', value: 'static' })
    expect((await createBackup()).data.settings.some(setting => ['account', 'token', 'account-backup'].includes(setting.key))).toBe(false)
  })

  it('continues saving a legacy phone backup with the previous normalized phone identity', async () => {
    await device({ phone: '+250788123456' }, { phone: '0788 123 456' })
    const remote = remoteCopy()
    expect(await accountBackupState()).toMatchObject({ revision: 7 })
    expect(await saveToAccount()).toMatchObject({ revision: 8 })
    expect(remote.save.mock.calls[0][1]).toBe(7)
    expect(await accountBackupState()).toMatchObject({ phone: '+250788123456', revision: 8 })
  })

  it('does not join another account using the result of an upload started before the linked account changed', async () => {
    await device(FIRST)
    const remote = remoteCopy()
    const originalSave = remote.save.getMockImplementation()
    remote.save.mockImplementation(async (...args) => {
      const result = await originalSave(...args)
      await db.settings.bulkPut([{ key: 'account', value: SECOND }, { key: 'token', value: 'other-token' }])
      return result
    })
    // A changed-account error or no-op is acceptable, but A's revision cannot become B's join.
    await connectAccount().catch(() => {})
    expect(await accountBackupState()).toBeNull()
    expect(remote.read).not.toHaveBeenCalled()
    expect((await db.settings.get('account')).value).toEqual(SECOND)
    expect((await db.settings.get('token')).value).toBe('other-token')
  })

  it('does not restore the old account response after a different account becomes linked during the read', async () => {
    await device(FIRST)
    const snapshot = await createBackup()
    snapshot.data.settings.find(setting => setting.key === 'mode').value = 'static'
    vi.spyOn(api, 'loadBackup').mockImplementation(async () => {
      await db.settings.bulkPut([{ key: 'account', value: SECOND }, { key: 'token', value: 'other-token' }])
      return { ...snapshot, revision: 3, saved_at: '2026-11-05T12:00:00Z' }
    })
    const save = vi.spyOn(api, 'saveBackup')
    await restoreFromAccount().catch(() => {})
    expect((await db.settings.get('mode')).value).toBe('predictive')
    expect(await accountBackupState()).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect((await db.settings.get('account')).value).toEqual(SECOND)
  })
})
