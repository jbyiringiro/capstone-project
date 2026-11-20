import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmailAuth } from '../../src/server/email-auth.js'

const session = { localId: 'caregiver-1', email: 'parent@example.com', idToken: 'fresh-id-token', expiresIn: '3600', refreshToken: 'must-not-retain' }
const user = { localId: session.localId, email: session.email, displayName: 'Uwase Ange', emailVerified: true }
const ok = value => ({ ok: true, status: 200, json: async () => value })
const refused = (message, status = 400) => ({ ok: false, status, json: async () => ({ error: { message } }) })

function client(...replies) {
  const fetchImpl = vi.fn()
  for (const reply of replies) fetchImpl.mockResolvedValueOnce(reply)
  return { auth: createEmailAuth({ apiKey: 'public-test-key', projectId: 'vuga-test', fetchImpl }), fetchImpl }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Firebase email accounts', () => {
  it('registers the caregiver name, sends verification, and returns no credential before verification', async () => {
    const { auth, fetchImpl } = client(ok(session), ok({ idToken: 'updated-id-token' }), ok({ email: session.email }))
    expect(await auth.register(' parent@example.com ', '  pass Word!  ', ' Uwase   Ange ')).toEqual({ email: session.email, verificationSent: true })
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/v1/accounts:signUp', '/v1/accounts:update', '/v1/accounts:sendOobCode'
    ])
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ email: session.email, password: '  pass Word!  ', returnSecureToken: true })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ idToken: session.idToken, displayName: 'Uwase Ange', returnSecureToken: true })
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ requestType: 'VERIFY_EMAIL', idToken: 'updated-id-token' })
    expect(fetchImpl.mock.calls.every(([, options]) => options.cache === 'no-store' && options.credentials === 'omit')).toBe(true)
  })

  it('returns a fresh token only after lookup confirms a verified matching identity, without a refresh token', async () => {
    const { auth, fetchImpl } = client(ok(session), ok({ users: [user] }))
    expect(await auth.login(' parent@example.com ', '  1234  ')).toEqual({ idToken: session.idToken, uid: session.localId,
      email: session.email, expiresIn: 3600, displayName: user.displayName })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).password).toBe('  1234  ')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ idToken: session.idToken })
  })

  it('blocks unverified accounts, then reauthenticates after the email link has been used', async () => {
    const { auth, fetchImpl } = client(ok(session), ok({ users: [{ ...user, emailVerified: false }] }), ok({ ...session, idToken: 'verified-fresh-token' }), ok({ users: [user] }))
    await expect(auth.login(session.email, 'password')).rejects.toMatchObject({ code: 'email-unverified', localized: true, email: session.email })
    expect((await auth.reauthenticate(session.email, 'password')).idToken).toBe('verified-fresh-token')
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('signInWithPassword'))).toHaveLength(2)
  })

  it('resends verification with a freshly authenticated token and skips sending for an already verified account', async () => {
    const { auth, fetchImpl } = client(ok(session), ok({ users: [{ ...user, emailVerified: false }] }), ok({ email: session.email }), ok(session), ok({ users: [user] }))
    expect(await auth.resendVerification(session.email, 'password')).toEqual({ email: session.email, verificationSent: true })
    expect(await auth.resendVerification(session.email, 'password')).toEqual({ email: session.email, verificationSent: false, alreadyVerified: true })
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('sendOobCode'))).toHaveLength(1)
  })

  it('keeps password-reset results identical for existing, missing, and disabled accounts', async () => {
    const { auth, fetchImpl } = client(ok({ email: session.email }), refused('EMAIL_NOT_FOUND'), refused('USER_DISABLED'))
    for (let index = 0; index < 3; index++) expect(await auth.sendPasswordReset(' parent@example.com ')).toEqual({ requested: true })
    expect(fetchImpl.mock.calls.every(([, options]) => JSON.parse(options.body).requestType === 'PASSWORD_RESET')).toBe(true)
  })

  it('marks partial signup failures so the UI can offer resend without losing the created account', async () => {
    const { auth } = client(ok(session), ok({ idToken: 'updated-id-token' }), refused('TOO_MANY_ATTEMPTS_TRY_LATER'))
    await expect(auth.register(session.email, 'password', user.displayName)).rejects.toMatchObject({ accountCreated: true, email: session.email, code: 'too-many-requests' })
    const updateFailure = client(ok(session), refused('INTERNAL_ERROR', 503))
    await expect(updateFailure.auth.register(session.email, 'password', user.displayName)).rejects.toMatchObject({ accountCreated: true, code: 'unavailable' })
  })

  it('validates input without network calls and never enforces signup password length at login', async () => {
    const { auth, fetchImpl } = client()
    await expect(auth.register(session.email, 'short', user.displayName)).rejects.toMatchObject({ code: 'weak-password' })
    await expect(auth.register(session.email, 'password', '   ')).rejects.toMatchObject({ code: 'invalid-name' })
    await expect(auth.register(session.email, 'password', 'A'.repeat(121))).rejects.toMatchObject({ code: 'invalid-name' })
    await expect(auth.register(session.email, 'password', 'A\u0000B')).rejects.toMatchObject({ code: 'invalid-name' })
    await expect(auth.login('not-an-email', 'password')).rejects.toMatchObject({ code: 'invalid-email' })
    await expect(auth.login(session.email, '')).rejects.toMatchObject({ code: 'invalid-password' })
    expect(fetchImpl).not.toHaveBeenCalled()
    const short = client(ok(session), ok({ users: [user] }))
    await expect(short.auth.login(session.email, '123456')).resolves.toMatchObject({ uid: session.localId })
  })

  it.each([
    ['INVALID_LOGIN_CREDENTIALS', 'invalid-credentials'],
    ['INVALID_PASSWORD', 'invalid-credentials'],
    ['EMAIL_NOT_FOUND', 'invalid-credentials'],
    ['EMAIL_EXISTS', 'email-exists'],
    ['OPERATION_NOT_ALLOWED', 'not-configured'],
    ['WEAK_PASSWORD : provider details', 'weak-password'],
    ['NEW_ERROR : parent@example.com secret-value', 'unknown']
  ])('maps %s without exposing provider details', async (provider, code) => {
    const { auth } = client(refused(provider))
    const error = await auth.login(session.email, 'password').catch(error => error)
    expect(error).toMatchObject({ code, localized: true })
    expect(error.message).not.toContain('parent@example.com')
    expect(error.message).not.toContain('secret-value')
  })

  it('fails closed on malformed successful responses and mismatched identities', async () => {
    for (const malformed of [{}, { ...session, idToken: '' }, { ...session, expiresIn: 'NaN' }]) {
      const { auth } = client(ok(malformed))
      await expect(auth.login(session.email, 'password')).rejects.toMatchObject({ code: 'invalid-response' })
    }
    for (const malformed of [{ users: [] }, { users: [{ ...user, localId: 'other' }] }, { users: [{ ...user, email: 'other@example.com' }] }, { users: [{ ...user, emailVerified: 'true' }] }]) {
      const { auth } = client(ok(session), ok(malformed))
      await expect(auth.login(session.email, 'password')).rejects.toMatchObject({ code: 'invalid-response' })
    }
  })

  it('requires public project configuration and stops offline before sending a password', async () => {
    const fetchImpl = vi.fn()
    const missing = createEmailAuth({ apiKey: 'key', fetchImpl })
    expect(missing.configured()).toBe(false)
    await expect(missing.login(session.email, 'password')).rejects.toMatchObject({ code: 'not-configured' })
    vi.stubGlobal('navigator', { onLine: false })
    const offline = createEmailAuth({ apiKey: 'key', projectId: 'vuga', fetchImpl })
    await expect(offline.login(session.email, 'password')).rejects.toMatchObject({ code: 'offline' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a network failure safely and aborts a timed out request', async () => {
    const network = createEmailAuth({ apiKey: 'key', projectId: 'vuga', fetchImpl: async () => { throw new Error('Secret response') } })
    await expect(network.login(session.email, 'password')).rejects.toMatchObject({ code: 'network', localized: true })
    vi.useFakeTimers()
    let signal
    const timed = createEmailAuth({ apiKey: 'key', projectId: 'vuga', timeoutMs: 20, fetchImpl: (_, options) => {
      signal = options.signal
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    } })
    const result = timed.login(session.email, 'password').catch(error => error)
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toMatchObject({ code: 'timeout', localized: true })
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
