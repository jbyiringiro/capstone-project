import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { emailAuth } from '../../src/server/email-auth.js'
import { api, getLinkedAccount, getToken, signInQuietly } from '../../src/server/api-client.js'
import { syncPending } from '../../src/server/sync.js'
import { finaliseMessage, logAction, startDraft, SyncState } from '../../src/storage/messages.js'
import { changeParentPin, getParentPinVersion, PARENT_ACCESS_KEY, setupParentPin, unlockParentAccess } from '../../src/parent-access/parent-access.js'

vi.mock('../../src/server/email-auth.js', () => ({ emailAuth: {
  provider: 'firebase', register: vi.fn(), login: vi.fn(), reauthenticate: vi.fn(), resendVerification: vi.fn(), sendPasswordReset: vi.fn(), signOut: vi.fn()
} }))

const FIRST = { user_id: 'adult-1', email: 'parent@example.com', name: 'Uwase', auth_provider: 'firebase' }
const SECOND = { user_id: 'adult-2', email: 'other@example.com', name: 'Mukamana', auth_provider: 'firebase' }
const FRESH = { idToken: 'fresh-provider-token', uid: 'firebase-1', email: FIRST.email, displayName: FIRST.name, expiresIn: 3600 }
const reply = (status, value = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => value })

function server(handler) {
  const requests = []
  vi.stubGlobal('fetch', async (url, options = {}) => {
    const request = { path: new URL(url).pathname, ...options, body: options.body ? JSON.parse(options.body) : undefined }
    requests.push(request)
    return handler(request, requests.length)
  })
  return requests
}

async function linked(account = FIRST, token = 'old-token') {
  await db.settings.bulkPut([
    { key: 'account', value: account }, { key: 'token', value: token },
    { key: 'account-backup', value: { ...account, revision: 7, fingerprint: 'joined-before' } }
  ])
}

async function accountRows() {
  return Promise.all(['account', 'token', 'account-backup'].map(key => db.settings.get(key)))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('navigator', { onLine: true })
  await api.unlinkAccount() // Also discards in-memory deletion retry credentials between tests.
  await Promise.all(db.tables.map(table => table.clear()))
  emailAuth.login.mockReset().mockResolvedValue(FRESH)
  emailAuth.reauthenticate.mockReset().mockResolvedValue(FRESH)
  emailAuth.signOut.mockReset().mockResolvedValue(undefined)
  emailAuth.provider = 'firebase'
})

describe('email account API integration', () => {
  const stagedServer = handler => server(request => request.path === '/auth/email/session'
    ? reply(200, { access_token: FRESH.idToken, token_type: 'bearer', user: FIRST })
    : handler ? handler(request) : reply(200, FIRST))

  it('keeps prepared authentication only in memory without changing a current account, backup or local PIN', async () => {
    await linked(SECOND)
    const before = await db.settings.toArray()
    const requests = stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'private password')
    expect(Object.isFrozen(handle)).toBe(true)
    expect(handle).toMatchObject({ email: FIRST.email, name: FIRST.name, devicePin: false })
    expect(Object.keys(handle).sort()).toEqual(['devicePin', 'email', 'expiresAt', 'name'])
    expect(JSON.stringify(handle)).not.toContain(FRESH.idToken)
    expect(await db.settings.toArray()).toEqual(before)
    expect(requests.map(request => request.path)).toEqual(['/auth/email/session'])
    await api.cancelEmailLogin(handle)
    expect(await db.settings.toArray()).toEqual(before)
    expect(emailAuth.signOut).toHaveBeenCalledWith(FRESH.idToken)
  })

  it('revalidates identity and commits the account, token and new local PIN together, returning its recovery code once', async () => {
    await linked(SECOND)
    const controller = new AbortController(), requests = stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password', undefined, { signal: controller.signal })
    const result = await api.completeEmailLogin(handle, { pin: '482619', confirmation: '482619' })
    expect(result).toMatchObject({ access_token: FRESH.idToken, user: FIRST })
    expect(result.recoveryCode).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/)
    expect(await getLinkedAccount()).toEqual(FIRST)
    expect(await getToken()).toBe(FRESH.idToken)
    expect(await db.settings.get('account-backup')).toBeUndefined()
    expect((await unlockParentAccess('482619')).ok).toBe(true)
    expect(JSON.stringify(await db.settings.get(PARENT_ACCESS_KEY))).not.toContain('482619')
    expect(requests.map(request => request.path)).toEqual(['/auth/email/session', '/auth/me'])
    expect(requests[1].headers.Authorization).toBe(`Bearer ${FRESH.idToken}`)
    expect(JSON.stringify(requests)).not.toContain('482619')
    await expect(api.completeEmailLogin(handle, { pin: '482619', confirmation: '482619' })).rejects.toMatchObject({ code: 'email-login-expired' })
    controller.abort(); await api.cancelEmailLogin(handle)
    expect(emailAuth.signOut).not.toHaveBeenCalled()
  })

  it('keeps the pending stage on malformed or mismatched PIN input without requesting identity or persisting authentication', async () => {
    const requests = stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    await expect(api.completeEmailLogin(handle, { pin: '12', confirmation: '12' })).rejects.toMatchObject({ code: 'format' })
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '8642' })).rejects.toMatchObject({ code: 'mismatch' })
    expect(await db.settings.toArray()).toEqual([])
    expect(requests).toHaveLength(1)
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).resolves.toHaveProperty('recoveryCode')
  })

  it('checks an existing device PIN and its lockout without replacing its credential or recovery code', async () => {
    await setupParentPin('2468', '2468')
    const version = await getParentPinVersion()
    const clock = vi.spyOn(Date, 'now'), started = Date.now()
    const requests = stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    expect(handle.devicePin).toBe(true)
    for (let count = 0; count < 5; count++) await expect(api.completeEmailLogin(handle, { pin: '9999' })).rejects.toMatchObject({ localized: true })
    await expect(api.completeEmailLogin(handle, { pin: '2468' })).rejects.toThrow('Tegereza')
    expect(await getToken()).toBeNull()
    expect(await getLinkedAccount()).toBeNull()
    expect(requests).toHaveLength(1)
    clock.mockReturnValue(started + 31_000)
    const result = await api.completeEmailLogin(handle, { pin: '2468' })
    expect(result.recoveryCode).toBeUndefined()
    expect(await getParentPinVersion()).toBe(version)
  })

  it.each(['setup-before-pin', 'change-before-pin', 'setup-during-validation'])('refuses a concurrent device PIN change (%s) without persisting a cloud link', async change => {
    if (change === 'change-before-pin') await setupParentPin('2468', '2468')
    stagedServer(async () => {
      if (change === 'setup-during-validation') await setupParentPin('1111', '1111')
      return reply(200, FIRST)
    })
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    if (change === 'setup-before-pin') await setupParentPin('1111', '1111')
    if (change === 'change-before-pin') await changeParentPin('2468', '1111', '1111')
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-changed' })
    expect(await getLinkedAccount()).toBeNull()
    expect(await getToken()).toBeNull()
    expect((await unlockParentAccess('1111')).ok).toBe(true)
  })

  it.each(['unlink', 'another-account', 'new-session'])('does not overwrite a later %s between the password and PIN stages', async change => {
    await linked()
    stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    if (change === 'unlink') await api.unlinkAccount()
    else await linked(change === 'another-account' ? SECOND : FIRST, 'later-token')
    const before = await db.settings.toArray()
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ localized: true })
    expect(await db.settings.toArray()).toEqual(before)
  })

  it.each(['provider', 'session'])('discards a late %s success after navigation, with no local authentication writes', async phase => {
    let release
    const delayed = new Promise(resolve => { release = resolve })
    if (phase === 'provider') emailAuth.login.mockReturnValue(delayed)
    const requests = server(() => phase === 'session' ? delayed : reply(200, { access_token: FRESH.idToken, user: FIRST }))
    const controller = new AbortController()
    const preparing = api.prepareEmailLogin(FIRST.email, 'password', undefined, { signal: controller.signal })
    const rejected = expect(preparing).rejects.toMatchObject({ code: 'email-login-expired' })
    await vi.waitFor(() => phase === 'provider' ? expect(emailAuth.login).toHaveBeenCalled() : expect(requests).toHaveLength(1))
    controller.abort()
    release(phase === 'provider' ? FRESH : reply(200, { access_token: FRESH.idToken, user: FIRST }))
    await rejected
    await vi.waitFor(() => expect(emailAuth.signOut).toHaveBeenCalledWith(FRESH.idToken))
    expect(await db.settings.toArray()).toEqual([])
    if (phase === 'provider') expect(requests).toHaveLength(0)
  })

  it('discards a late identity validation response after cancellation without storing the prepared PIN', async () => {
    const controller = new AbortController()
    stagedServer(() => { controller.abort(); return reply(200, FIRST) })
    const handle = await api.prepareEmailLogin(FIRST.email, 'password', undefined, { signal: controller.signal })
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-expired' })
    expect(await db.settings.toArray()).toEqual([])
  })

  it('expires pending credentials after five minutes and refuses forged or reused tickets', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    await expect(api.completeEmailLogin({ ...handle }, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-expired' })
    clock.mockReturnValue(1_300_001)
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-expired' })
    expect(await db.settings.toArray()).toEqual([])
  })

  it('rolls back the prepared PIN, account and backup together if local account storage fails', async () => {
    await linked(SECOND)
    stagedServer()
    const before = await db.settings.toArray()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    vi.spyOn(db.settings, 'bulkPut').mockRejectedValueOnce(new Error('disk full'))
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toThrow('disk full')
    expect(await db.settings.toArray()).toEqual(before)
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).resolves.toHaveProperty('recoveryCode')
  })

  it('rolls back all local linking writes when navigation cancels after bulkPut, and revokes the uncommitted token', async () => {
    await linked(SECOND)
    stagedServer()
    const before = await db.settings.toArray(), controller = new AbortController()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password', undefined, { signal: controller.signal })
    const original = db.settings.bulkPut.bind(db.settings)
    vi.spyOn(db.settings, 'bulkPut').mockImplementationOnce(async rows => {
      const result = await original(rows)
      controller.abort()
      return result
    })
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-expired' })
    expect(await db.settings.toArray()).toEqual(before)
    await vi.waitFor(() => expect(emailAuth.signOut).toHaveBeenCalledWith(FRESH.idToken))
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-expired' })
  })

  it('allows only one PIN completion to consume a prepared authentication ticket', async () => {
    let release
    const validation = new Promise(resolve => { release = resolve })
    const requests = stagedServer(() => validation)
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    const completing = api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ code: 'email-login-busy' })
    release(reply(200, FIRST))
    await expect(completing).resolves.toHaveProperty('recoveryCode')
    expect(requests.filter(request => request.path === '/auth/me')).toHaveLength(1)
  })

  it('rejects a revoked or different identity at PIN completion without changing current stored credentials', async () => {
    await linked()
    const before = await db.settings.toArray()
    for (const response of [reply(401), reply(200, SECOND), reply(200, { ...FIRST, email: SECOND.email })]) {
      stagedServer(() => response)
      const handle = await api.prepareEmailLogin(FIRST.email, 'password')
      await expect(api.completeEmailLogin(handle, { pin: '2468', confirmation: '2468' })).rejects.toMatchObject({ localized: true })
      expect(await db.settings.toArray()).toEqual(before)
    }
  })

  it('does not revoke a token that has meanwhile become the current stored session when cancelling', async () => {
    stagedServer()
    const handle = await api.prepareEmailLogin(FIRST.email, 'password')
    await linked(FIRST, FRESH.idToken)
    await api.cancelEmailLogin(handle)
    expect(emailAuth.signOut).not.toHaveBeenCalled()
    expect(await getToken()).toBe(FRESH.idToken)
  })

  it('stores Neon ownership without merging an older Firebase identity with the same email', async () => {
    await linked()
    emailAuth.provider = 'neon'
    const neon = { ...FIRST, user_id: 'neon-vuga-user', auth_provider: 'neon' }
    emailAuth.login.mockResolvedValue({ ...FRESH, idToken: 'neon.sealed-session' })
    server(() => reply(200, { access_token: 'neon.sealed-session', user: neon }))
    await api.loginEmail(FIRST.email, 'password')
    expect(await getLinkedAccount()).toEqual(neon)
    expect(await getToken()).toBe('neon.sealed-session')
    expect(await db.settings.get('account-backup')).toBeUndefined()
  })

  it('rejects an unexpected provider from the API without replacing the local account', async () => {
    await linked()
    const before = await accountRows()
    emailAuth.provider = 'neon'
    server(() => reply(200, { access_token: 'neon.sealed-session', user: FIRST }))
    await expect(api.loginEmail(FIRST.email, 'password')).rejects.toMatchObject({ localized: true })
    expect(await accountRows()).toEqual(before)
  })

  it('revokes a Neon session at sign-out without erasing a newer concurrent login', async () => {
    const neon = { ...FIRST, auth_provider: 'neon' }
    await linked(neon, 'neon.first-session')
    emailAuth.signOut.mockImplementation(async () => linked(neon, 'neon.new-session'))
    await api.logout()
    expect(emailAuth.signOut).toHaveBeenCalledWith('neon.first-session')
    expect(await getToken()).toBe('neon.new-session')
    expect(await getLinkedAccount()).toEqual(neon)
  })

  it('allows local Neon sign-out when the provider is unavailable and preserves PIN recovery identity', async () => {
    const neon = { ...FIRST, auth_provider: 'neon' }
    await linked(neon, 'neon.first-session')
    emailAuth.signOut.mockRejectedValue(new Error('network unavailable'))
    await api.logout()
    expect(await getToken()).toBeNull()
    expect(await getLinkedAccount()).toEqual(neon)
  })

  it('exchanges a verified identity and atomically links its immutable user id without sending a password to Vuga', async () => {
    await linked(SECOND)
    const requests = server(() => reply(200, { access_token: FRESH.idToken, token_type: 'bearer', user: FIRST }))
    await api.loginEmail(FIRST.email, ' private password ')
    expect(emailAuth.login).toHaveBeenCalledWith(FIRST.email, ' private password ')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: '/auth/email/session', method: 'POST', body: { id_token: FRESH.idToken, name: FIRST.name } })
    expect(requests[0].headers.Authorization).toBeUndefined()
    expect(JSON.stringify(requests)).not.toContain('private password')
    expect(await getToken()).toBe(FRESH.idToken)
    expect(await getLinkedAccount()).toEqual(FIRST)
    expect(await db.settings.get('account-backup')).toBeUndefined()
  })

  it('preserves a joined backup for the same user and supplies a missing caregiver name explicitly', async () => {
    await linked()
    emailAuth.login.mockResolvedValue({ ...FRESH, displayName: '' })
    const before = await db.settings.get('account-backup')
    const requests = server(() => reply(200, { access_token: FRESH.idToken, user: FIRST }))
    await api.loginEmail(FIRST.email, 'password', 'Uwase')
    expect(requests[0].body.name).toBe('Uwase')
    expect(await db.settings.get('account-backup')).toEqual(before)
  })

  it.each(['unlink', 'another-account', 'new-session'])('does not overwrite a later %s with a delayed email login response', async change => {
    await linked()
    let stateAfterChange
    server(async () => {
      if (change === 'unlink') await api.unlinkAccount()
      else await linked(change === 'another-account' ? SECOND : FIRST, 'later-session-token')
      stateAfterChange = await accountRows()
      return reply(200, { access_token: FRESH.idToken, user: FIRST })
    })
    await expect(api.loginEmail(FIRST.email, 'password')).rejects.toMatchObject({ localized: true })
    expect(await accountRows()).toEqual(stateAfterChange)
    expect(await getToken()).toBe(change === 'unlink' ? null : 'later-session-token')
    expect(await getLinkedAccount()).toEqual(change === 'unlink' ? null : change === 'another-account' ? SECOND : FIRST)
  })

  it('preserves the current link and token when provider verification or Vuga session creation fails', async () => {
    await linked()
    const before = await accountRows()
    let requests = server(() => reply(503))
    emailAuth.login.mockRejectedValueOnce(Object.assign(new Error('Verify email first'), { code: 'email-unverified' }))
    await expect(api.loginEmail(FIRST.email, 'password')).rejects.toMatchObject({ code: 'email-unverified' })
    expect(requests).toHaveLength(0)
    for (const response of [reply(503), reply(401), reply(200, { access_token: '', user: FIRST }), reply(200, { access_token: FRESH.idToken, user: { ...FIRST, auth_provider: 'phone' } })]) {
      requests = server(() => response)
      await expect(api.loginEmail(FIRST.email, 'password')).rejects.toMatchObject({ localized: true })
      expect(await accountRows()).toEqual(before)
    }
  })

  it('reauthenticates only the immutable linked identity even if a replacement account uses the same email', async () => {
    await linked()
    const before = await accountRows()
    const requests = server(() => reply(200, { ...FIRST, user_id: 'replacement-user' }))
    await expect(api.reauthenticateEmail(FIRST.email, 'password', FIRST)).rejects.toMatchObject({ localized: true })
    expect(requests.map(request => request.path)).toEqual(['/auth/me'])
    expect(requests[0].headers.Authorization).toBe(`Bearer ${FRESH.idToken}`)
    expect(await accountRows()).toEqual(before)
  })

  it('refreshes the same linked identity and keeps a concurrent account switch intact', async () => {
    await linked()
    server(() => reply(200, FIRST))
    expect(await api.reauthenticateEmail(FIRST.email, 'password', FIRST)).toMatchObject({ access_token: FRESH.idToken, user: FIRST })
    expect(await getToken()).toBe(FRESH.idToken)
    expect((await db.settings.get('account-backup')).value.revision).toBe(7)
    server(async () => { await linked(SECOND, 'other-token'); return reply(200, FIRST) })
    await expect(api.reauthenticateEmail(FIRST.email, 'password', FIRST)).rejects.toMatchObject({ localized: true })
    expect(await getLinkedAccount()).toEqual(SECOND)
    expect(await getToken()).toBe('other-token')
    expect((await db.settings.get('account-backup')).value.user_id).toBe(SECOND.user_id)
  })

  it('does not clear an existing Vuga session when explicit reauthentication is refused', async () => {
    await linked()
    const before = await accountRows()
    server(() => reply(401))
    await expect(api.reauthenticateEmail(FIRST.email, 'wrong-password', FIRST)).rejects.toMatchObject({ status: 401 })
    expect(await accountRows()).toEqual(before)
  })

  it('clears a refused pinned backup token only while it remains the current session', async () => {
    await linked()
    let requests = server(() => reply(401))
    await expect(api.backupStatus('old-token')).rejects.toMatchObject({ status: 401 })
    expect(requests[0].headers.Authorization).toBe('Bearer old-token')
    expect(await getToken()).toBeNull()
    expect(await getLinkedAccount()).toEqual(FIRST)

    await linked()
    requests = server(async () => { await linked(SECOND, 'other-token'); return reply(401) })
    await expect(api.backupStatus('old-token')).rejects.toMatchObject({ status: 401 })
    expect(requests[0].headers.Authorization).toBe('Bearer old-token')
    expect(await getToken()).toBe('other-token')
    expect(await getLinkedAccount()).toEqual(SECOND)
  })

  it('updates the account name with its pinned session and preserves the backup, children and local PIN', async () => {
    emailAuth.provider = 'neon'
    const before = { ...FIRST, auth_provider: 'neon' }
    await linked(before, 'neon.original')
    await db.settings.put({ key: 'parent-access:v1', value: { digest: 'local-pin-hash' } })
    await db.profiles.put({ profile_id: 'local-child', code: 'Keza', local_only: true })
    const backup = await db.settings.get('account-backup')
    const updated = { ...before, name: 'Uwase Ange' }
    const requests = server(() => reply(200, updated))
    await expect(api.updateAccountName('  Uwase   Ange  ', before)).resolves.toEqual(updated)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: '/auth/me', method: 'PATCH', body: { name: updated.name }, headers: { Authorization: 'Bearer neon.original' } })
    expect(await getLinkedAccount()).toEqual(updated)
    expect(await getToken()).toBe('neon.original')
    expect(await db.settings.get('account-backup')).toEqual(backup)
    expect((await db.settings.get('parent-access:v1')).value.digest).toBe('local-pin-hash')
    expect(await db.profiles.get('local-child')).toMatchObject({ code: 'Keza' })
  })

  it.each(['', '   ', 'a'.repeat(121), 'Name\u0007', null])('rejects invalid account names before making a request (%j)', async name => {
    await linked()
    const before = await accountRows()
    const requests = server(() => reply(200, FIRST))
    await expect(api.updateAccountName(name, FIRST)).rejects.toMatchObject({ localized: true })
    expect(requests).toHaveLength(0)
    expect(await accountRows()).toEqual(before)
  })

  it('does not attempt a name change offline or without the linked account session', async () => {
    await linked()
    const requests = server(() => reply(200, FIRST))
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.updateAccountName('New name', FIRST)).rejects.toMatchObject({ localized: true })
    vi.stubGlobal('navigator', { onLine: true })
    await linked(FIRST, null)
    await expect(api.updateAccountName('New name', FIRST)).rejects.toMatchObject({ localized: true, status: 401 })
    expect(requests).toHaveLength(0)
  })

  it.each(['unlink', 'another-account', 'new-session'])('does not overwrite a later %s with a delayed name update', async change => {
    await linked()
    let stateAfterChange
    server(async () => {
      if (change === 'unlink') await api.unlinkAccount()
      else await linked(change === 'another-account' ? SECOND : FIRST, 'later-token')
      stateAfterChange = await accountRows()
      return reply(200, { ...FIRST, name: 'New name' })
    })
    await expect(api.updateAccountName('New name', FIRST)).rejects.toMatchObject({ localized: true })
    expect(await accountRows()).toEqual(stateAfterChange)
  })

  it('preserves the local name when a save fails or returns a mismatched identity or name', async () => {
    await linked()
    const before = await accountRows()
    for (const response of [reply(503), reply(422), reply(200, SECOND), reply(200, FIRST), reply(200, { ...FIRST, name: 'New name', email: SECOND.email })]) {
      server(() => response)
      await expect(api.updateAccountName('New name', FIRST)).rejects.toMatchObject({ localized: true })
      expect(await accountRows()).toEqual(before)
    }
  })

  it('requires a new sign-in after an expired name-update session while keeping the account link', async () => {
    await linked()
    server(() => reply(401))
    await expect(api.updateAccountName('New name', FIRST)).rejects.toMatchObject({ status: 401 })
    expect(await getLinkedAccount()).toEqual(FIRST)
    expect(await getToken()).toBeNull()
  })

  it('does not edit an account different from the one shown in the form', async () => {
    await linked(SECOND)
    const requests = server(() => reply(200, SECOND))
    await expect(api.updateAccountName('New name', FIRST)).rejects.toMatchObject({ localized: true })
    expect(requests).toHaveLength(0)
    expect(await getLinkedAccount()).toEqual(SECOND)
  })

  it('distinguishes disabled deletion from confirmed pending cleanup and never clears account data on either', async () => {
    await linked()
    const before = await accountRows()
    server(() => reply(503, { code: 'ACCOUNT_DELETION_DISABLED' }))
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toThrow('Nta makuru yasibwe')
    expect(await accountRows()).toEqual(before)
    server(() => reply(503, { code: 'ACCOUNT_DELETION_PENDING', vugaDataDeleted: true }))
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toThrow('Amakuru ya Vuga yo kuri seriveri yasibwe')
    expect(emailAuth.reauthenticate).toHaveBeenCalledTimes(2)
    expect(await accountRows()).toEqual(before)
  })

  it.each([{ emailSent: true }, null])('does not treat an unconfirmed HTTP200 response (%j) as completed account deletion', async body => {
    await linked()
    const before = await accountRows()
    server(() => reply(200, body))
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toThrow('ntiyemeje')
    expect(await accountRows()).toEqual(before)
  })

  it('retries a partial deletion with its in-memory fresh credential and clears only account keys on success', async () => {
    await linked()
    await db.settings.put({ key: 'pin', value: { hash: 'local-pin-hash', salt: 'local-salt' } })
    await db.settings.put({ key: 'mode', value: 'predictive' })
    await db.profiles.put({ profile_id: 'local-child', code: 'Keza', local_only: true })
    const before = await accountRows()
    const requests = server((request, index) => index === 1 ? reply(503, { detail: 'provider deletion pending' }) : reply(204))
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toMatchObject({ status: 503 })
    expect(await accountRows()).toEqual(before)
    expect(JSON.stringify(await db.settings.toArray())).not.toContain(FRESH.idToken)
    // Provider account may already be gone after a lost response. Retrying must not
    // demand another provider sign-in before the backend can finish the deletion.
    emailAuth.reauthenticate.mockRejectedValue(new Error('provider account already deleted'))
    expect(await api.deleteEmailAccount(FIRST.email, 'password')).toBeNull()
    expect(emailAuth.reauthenticate).toHaveBeenCalledTimes(1)
    expect(requests.map(request => request.body)).toEqual([
      { id_token: FRESH.idToken, user_id: FIRST.user_id }, { id_token: FRESH.idToken, user_id: FIRST.user_id }
    ])
    expect(await accountRows()).toEqual([undefined, undefined, undefined])
    expect((await db.settings.get('pin')).value.hash).toBe('local-pin-hash')
    expect((await db.settings.get('mode')).value).toBe('predictive')
    expect(await db.profiles.get('local-child')).toMatchObject({ code: 'Keza' })
  })

  it('discards a refused deletion credential and obtains a new one on the next attempt', async () => {
    await linked()
    const requests = server((request, index) => index === 1 ? reply(401) : reply(204))
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toMatchObject({ status: 401 })
    emailAuth.reauthenticate.mockResolvedValue({ ...FRESH, idToken: 'second-fresh-token' })
    await api.deleteEmailAccount(FIRST.email, 'password')
    expect(emailAuth.reauthenticate).toHaveBeenCalledTimes(2)
    expect(requests[1].body.id_token).toBe('second-fresh-token')
  })

  it('expires the in-memory deletion retry credential and never persists it for a later session', async () => {
    await linked()
    const started = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(started)
    const requests = server((request, index) => index === 1 ? reply(503) : reply(204))
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toMatchObject({ status: 503 })
    clock.mockReturnValue(started + 4 * 60_000 + 1)
    emailAuth.reauthenticate.mockResolvedValue({ ...FRESH, idToken: 'renewed-fresh-token' })
    await api.deleteEmailAccount(FIRST.email, 'password')
    expect(emailAuth.reauthenticate).toHaveBeenCalledTimes(2)
    expect(requests[1].body.id_token).toBe('renewed-fresh-token')
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('fresh-token')
  })

  it('preserves a new account linked while the previous account deletion was in flight', async () => {
    await linked()
    server(async () => { await linked(SECOND, 'other-token'); return reply(204) })
    await api.deleteEmailAccount(FIRST.email, 'password')
    expect(await getLinkedAccount()).toEqual(SECOND)
    expect(await getToken()).toBe('other-token')
    expect((await db.settings.get('account-backup')).value.user_id).toBe(SECOND.user_id)
  })

  it('does not send a local PIN to Firebase or attempt deletion offline or for another linked email', async () => {
    await linked()
    const requests = server(() => reply(204))
    await signInQuietly('2468')
    expect(emailAuth.login).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
    await expect(api.deleteEmailAccount(SECOND.email, 'password')).rejects.toMatchObject({ localized: true })
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.deleteEmailAccount(FIRST.email, 'password')).rejects.toMatchObject({ localized: true })
    expect(emailAuth.reauthenticate).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['/profiles', false], ['/profiles', true], ['/sync', false], ['/sync', true]
  ])('handles a refused %s sync request without clearing a newer session (switched=%s)', async (refusedPath, switched) => {
    await linked()
    const messageId = await startDraft('owned-child', 'predictive')
    await logAction(messageId, 0, 'select', { symbol_key: 'WATER' })
    await logAction(messageId, 1, 'speak')
    await finaliseMessage(messageId, 2)
    const requests = server(async request => {
      if (request.path === refusedPath) {
        if (switched) await linked(SECOND, 'new-account-token')
        return reply(401)
      }
      return reply(200, [{ profile_id: 'owned-child' }])
    })
    await expect(syncPending('http://localhost:8000', 'old-token')).rejects.toMatchObject({ status: 401, localized: true })
    expect(requests.map(request => request.path)).toEqual(refusedPath === '/profiles' ? ['/profiles'] : ['/profiles', '/sync'])
    expect(requests.every(request => request.headers.Authorization === 'Bearer old-token')).toBe(true)
    expect(await getToken()).toBe(switched ? 'new-account-token' : null)
    expect(await getLinkedAccount()).toEqual(switched ? SECOND : FIRST)
    expect((await db.messages.get(messageId)).synced).toBe(SyncState.PENDING)
  })
})
