import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { api, getLinkedAccount, signInQuietly, waitText } from '../../src/server/api-client.js'

// A stand-in for the Vuga API: `replies` answers each path, and every request is kept.
function fakeServer(replies) {
  const requests = []
  vi.stubGlobal('fetch', async (url, { method = 'GET', headers = {}, body } = {}) => {
    const path = new URL(url).pathname
    requests.push({ path, method, headers, body: typeof body === 'string' ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body)) })
    const [status, value] = replies[path] ?? [404, {}]
    return { ok: status < 300, status, json: async () => value }
  })
  return requests
}

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); vi.unstubAllGlobals() })

describe('accounts by mobile number and one PIN', () => {
  it('asks for a code, opens the account with it and the PIN, and signs in with the number in one form', async () => {
    const requests = fakeServer({ '/auth/code': [202, { resend_after: 60, expires_in: 600 }], '/auth/register': [201, { phone: '+250788123456' }], '/auth/login': [200, { access_token: 't-1' }] })
    expect(await api.sendCode('+250788123456', 'register')).toEqual({ resend_after: 60, expires_in: 600 })
    await api.register('+250788123456', '123456', '2468')
    await api.login('0788 123 456', '2468')
    expect(requests.map(request => request.path)).toEqual(['/auth/code', '/auth/register', '/auth/login'])
    expect(requests[0].body).toEqual({ phone: '+250788123456', purpose: 'register' })
    expect(requests[1].body).toMatchObject({ name: '', phone: '+250788123456', code: '123456', pin: '2468' })
    expect(requests[2].body).toEqual({ username: '+250788123456', password: '2468' })
    expect(requests.some(request => request.headers.Authorization)).toBe(false)
    expect(await getLinkedAccount()).toEqual({ phone: '+250788123456' })
  })
  it('replaces a forgotten PIN with a code, and changes a known PIN', async () => {
    const requests = fakeServer({ '/auth/reset-pin': [204, null], '/auth/change-pin': [204, null] })
    expect(await api.resetPin('+250788123456', '654321', '1357')).toBeNull()
    expect(await api.changePin('+250788123456', '1357', '9753')).toBeNull()
    expect(requests[0]).toMatchObject({ path: '/auth/reset-pin', method: 'POST', body: { phone: '+250788123456', code: '654321', pin: '1357' } })
    expect(requests[1]).toMatchObject({ path: '/auth/change-pin', body: { phone: '+250788123456', pin: '1357', new_pin: '9753' } })
  })
  it('says in Kinyarwanda what went wrong with a code or a PIN, and how long to wait', async () => {
    fakeServer({ '/auth/code': [429, { detail: 'wait', retry_after: 42 }], '/auth/register': [400, { detail: 'wrong or expired code' }] })
    await expect(api.sendCode('+250788123456', 'register')).rejects.toThrow('Tegereza amasegonda 42, wongere usabe kode.')
    await expect(api.register('+250788123456', '000000', '2468')).rejects.toThrow('Kode si yo cyangwa yararangiye.')
    fakeServer({ '/auth/code': [409, { detail: 'phone already registered' }] })
    await expect(api.sendCode('+250788123456', 'register')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('isanzwe ifite konti ya Vuga') })
    fakeServer({ '/auth/code': [502, { detail: 'could not send the code' }] })
    await expect(api.sendCode('+250788123456', 'reset')).rejects.toThrow('Ntibyashobotse kohereza SMS.')
    fakeServer({ '/auth/code': [404, { detail: 'no account for this number' }] })
    await expect(api.sendCode('+250722000000', 'reset')).rejects.toMatchObject({ status: 404, message: 'Iyi nimero ntifite konti ya Vuga. Reba ko wayanditse neza, cyangwa ufungure konti nshya.' })
    fakeServer({ '/auth/login': [401, { detail: 'wrong phone or PIN' }] })
    await expect(api.login('0788123456', '1111')).rejects.toThrow('Nimero cyangwa umubare w’ibanga si byo.')
    fakeServer({ '/auth/login': [429, { detail: 'too many wrong PINs', retry_after: 900 }] })
    await expect(api.login('0788123456', '1111')).rejects.toThrow('Umubare w’ibanga wanditswe nabi inshuro eshanu. Tegereza iminota 15')
    expect(waitText(2695)).toBe('iminota 45')
  })
  it('signs the linked account in again with the PIN, and stops once the account no longer takes it', async () => {
    await db.settings.put({ key: 'account', value: { phone: '+250788123456' } })
    let requests = fakeServer({ '/auth/login': [401, { detail: 'wrong phone or PIN' }] })
    await signInQuietly('2468')
    expect(requests).toHaveLength(1)
    expect(await getLinkedAccount()).toEqual({ phone: '+250788123456', stale: true })
    await signInQuietly('2468')
    expect(requests).toHaveLength(1)
    // Signing in on purpose with the account's PIN clears the mark.
    requests = fakeServer({ '/auth/login': [200, { access_token: 't-2' }] })
    await api.login('+250788123456', '1357')
    expect(await getLinkedAccount()).toEqual({ phone: '+250788123456' })
    await signInQuietly('1357')
    expect(requests).toHaveLength(2)
  })
})
