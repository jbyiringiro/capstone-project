import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNeonEmailAuth } from '../../src/server/neon-email-auth.js'
import { createConfiguredEmailAuth } from '../../src/server/email-auth.js'

const base = 'https://vuga-api.example.test'
const email = 'caregiver@example.test'
const session = { idToken: 'neon.sealed-session', uid: 'neon-user-1', email, displayName: 'Uwase Ange', expiresIn: 3600 }
const reply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value })
function client(...responses) {
  const fetchImpl = vi.fn()
  responses.forEach(value => fetchImpl.mockResolvedValueOnce(value))
  return { auth: createNeonEmailAuth({ apiBase: base, fetchImpl }), fetchImpl }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Neon email accounts through the Vuga API', () => {
  it('selects only the requested provider and fails closed for unknown values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(session))
    const options = { apiBase: base, apiKey: 'rollback-firebase-key', projectId: 'rollback-project', fetchImpl }
    const auth = createConfiguredEmailAuth({ ...options, provider: 'neon' })
    expect(auth.provider).toBe('neon'); expect(auth.verificationMethod).toBe('code')
    await auth.login(email, 'correct password')
    expect(fetchImpl.mock.calls[0][0]).toBe(`${base}/auth/neon/login`)
    expect(createConfiguredEmailAuth(options).verificationMethod).toBe('link')
    const invalid = createConfiguredEmailAuth({ ...options, provider: 'typo' })
    expect(invalid.configured()).toBe(false)
    await expect(invalid.login(email, 'password')).rejects.toMatchObject({ code: 'not-configured' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('registers and verifies with codes without returning any session before password login', async () => {
    const { auth, fetchImpl } = client(reply({ email, verificationSent: true }), reply({ email, verified: true }), reply({ email, verificationSent: true }))
    expect(await auth.register(` ${email.toUpperCase()} `, '  pass Word!  ', ' Uwase   Ange ')).toEqual({ email, verificationSent: true })
    expect(await auth.verifyEmail(email, '032145')).toEqual({ email, verified: true })
    expect(await auth.resendVerification(email)).toEqual({ email, verificationSent: true })
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/auth/neon/register', '/auth/neon/verify', '/auth/neon/resend'])
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ email, password: '  pass Word!  ', name: 'Uwase Ange' })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ email, otp: '032145' })
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ email })
    expect(fetchImpl.mock.calls.every(([, options]) => options.credentials === 'omit' && options.cache === 'no-store' && !options.headers.Authorization)).toBe(true)
  })

  it('returns only validated sealed session fields and never retains provider cookies or passwords', async () => {
    const { auth } = client(reply({ ...session, cookie: 'must-not-return', refreshToken: 'must-not-return', password: 'must-not-return' }))
    expect(await auth.login(email, ' password ')).toEqual(session)
  })

  it.each([
    {}, { ...session, idToken: 'firebase-token' }, { ...session, uid: '' }, { ...session, email: 'another@example.test' },
    { ...session, expiresIn: 'NaN' }, { ...session, expiresIn: 0 }
  ])('rejects malformed or mismatched session replies', async invalid => {
    const { auth } = client(reply(invalid))
    await expect(auth.login(email, 'password')).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('validates inputs without sending incomplete codes or altered passwords', async () => {
    const { auth, fetchImpl } = client()
    await expect(auth.register(email, 'short', 'Uwase')).rejects.toMatchObject({ code: 'weak-password' })
    await expect(auth.register(email, 'p'.repeat(129), 'Uwase')).rejects.toMatchObject({ code: 'weak-password' })
    await expect(auth.register(email, 'password', 'A\0B')).rejects.toMatchObject({ code: 'invalid-name' })
    await expect(auth.login('bad email', 'password')).rejects.toMatchObject({ code: 'invalid-email' })
    await expect(auth.login(email, '')).rejects.toMatchObject({ code: 'invalid-password' })
    await expect(auth.verifyEmail(email, '12345')).rejects.toMatchObject({ code: 'invalid-code' })
    await expect(auth.verifyEmail(email, '1234567')).rejects.toMatchObject({ code: 'invalid-code' })
    await expect(auth.confirmPasswordReset(email, '123456', 'short')).rejects.toMatchObject({ code: 'weak-password' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('confirms a password reset only after a valid code and exposes no account-existence flag', async () => {
    const { auth, fetchImpl } = client(reply({ sent: true }), reply({ sent: true, exists: false }), reply({ reset: true }))
    expect(await auth.sendPasswordReset(email)).toEqual({ requested: true })
    expect(await auth.sendPasswordReset('missing@example.test')).toEqual({ requested: true })
    expect(await auth.confirmPasswordReset(email, '012345', ' new password ')).toEqual({ reset: true })
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ email, otp: '012345', password: ' new password ' })
  })

  it('finishes a partial reset with the new password without reusing a consumed code', async () => {
    const { auth, fetchImpl } = client(reply({ detail: { code: 'PASSWORD_RESET_COMPLETED', passwordReset: true } }, 503), reply({ reset: true }))
    await expect(auth.confirmPasswordReset(email, '123456', 'new password')).rejects.toMatchObject({ code: 'password-reset-completed', passwordReset: true })
    expect(await auth.finishPasswordReset(email, 'new password')).toEqual({ reset: true })
    expect(fetchImpl.mock.calls[1][0]).toBe(`${base}/auth/neon/password-reset/finish`)
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ email, password: 'new password' })
  })

  it.each([
    ['EMAIL_NOT_VERIFIED', 'email-unverified'], ['INVALID_EMAIL_OR_PASSWORD', 'invalid-credentials'],
    ['INVALID_OTP', 'invalid-code'], ['OTP_EXPIRED', 'invalid-code'], ['TOO_MANY_REQUESTS', 'too-many-requests'],
    ['USER_ALREADY_EXISTS', 'email-exists'], ['NEW_UNKNOWN_CODE', 'unknown']
  ])('localizes %s without exposing server diagnostics', async (code, expected) => {
    const { auth } = client(reply({ detail: { code, message: 'private password parent@example.test', accountCreated: true } }, 400))
    const error = await auth.login(email, 'password').catch(value => value)
    expect(error).toMatchObject({ code: expected, localized: true, accountCreated: true })
    expect(error.message).not.toContain('private password'); expect(error.message).not.toContain('parent@example.test')
  })

  it('requires a secure API origin and stops offline before sending credentials', async () => {
    const fetchImpl = vi.fn()
    for (const apiBase of ['', 'bad-url', 'http://public.example.test', 'https://user:secret@example.test']) {
      const auth = createNeonEmailAuth({ apiBase, fetchImpl })
      expect(auth.configured()).toBe(false)
      await expect(auth.login(email, 'password')).rejects.toMatchObject({ code: 'not-configured' })
    }
    expect(createNeonEmailAuth({ apiBase: 'http://127.0.0.1:8001' }).configured()).toBe(true)
    vi.stubGlobal('navigator', { onLine: false })
    await expect(createNeonEmailAuth({ apiBase: base, fetchImpl }).login(email, 'password')).rejects.toMatchObject({ code: 'offline' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('handles network errors and aborts a stalled cold-start request', async () => {
    const offline = createNeonEmailAuth({ apiBase: base, fetchImpl: async () => { throw new Error('secret') } })
    await expect(offline.login(email, 'password')).rejects.toMatchObject({ code: 'network' })
    vi.useFakeTimers()
    let signal
    const timed = createNeonEmailAuth({ apiBase: base, timeoutMs: 20, fetchImpl: (_, options) => {
      signal = options.signal
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    } })
    const result = timed.login(email, 'password').catch(error => error)
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toMatchObject({ code: 'timeout' }); expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('revokes only Neon sessions through the API', async () => {
    const { auth, fetchImpl } = client(reply(null, 204))
    await auth.signOut('old-firebase-token'); expect(fetchImpl).not.toHaveBeenCalled()
    await auth.signOut(session.idToken)
    expect(fetchImpl.mock.calls[0][0]).toBe(`${base}/auth/neon/signout`)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ id_token: session.idToken })
  })
})
