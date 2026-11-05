import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { emailAuth } from '../../src/server/email-auth.js'
import { api, getLinkedAccount, getToken, signInQuietly } from '../../src/server/api-client.js'
import { syncPending } from '../../src/server/sync.js'
import { finaliseMessage, logAction, startDraft, SyncState } from '../../src/storage/messages.js'

vi.mock('../../src/server/email-auth.js', () => ({ emailAuth: {
  register: vi.fn(), login: vi.fn(), reauthenticate: vi.fn(), resendVerification: vi.fn(), sendPasswordReset: vi.fn()
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
})

describe('email account API integration', () => {
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
