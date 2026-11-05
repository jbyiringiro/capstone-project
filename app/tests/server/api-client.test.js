import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/storage/db.js'
import { api, getLinkedAccount, getToken, signInQuietly, waitText } from '../../src/server/api-client.js'

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
  it('asks for a code, opens the account with it, the caregiver’s name and the PIN, and signs in with the number in one form', async () => {
    const requests = fakeServer({
      '/auth/code': [202, { resend_after: 60, expires_in: 600, delivery: 'sms' }], '/auth/register': [201, { phone: '+250788123456', name: 'Uwase Ange' }],
      '/auth/login': [200, { access_token: 't-1' }], '/auth/me': [200, { phone: '+250788123456', name: 'Uwase Ange' }]
    })
    expect(await api.sendCode('+250788123456', 'register')).toEqual({ resend_after: 60, expires_in: 600, delivery: 'sms' })
    await api.register('+250788123456', '123456', '2468', 'Uwase Ange')
    await api.login('0788 123 456', '2468')
    expect(requests.map(request => request.path)).toEqual(['/auth/code', '/auth/register', '/auth/login', '/auth/me'])
    expect(requests[0].body).toEqual({ phone: '+250788123456', purpose: 'register' })
    expect(requests[1].body).toMatchObject({ name: 'Uwase Ange', phone: '+250788123456', code: '123456', pin: '2468' })
    expect(requests[2].body).toEqual({ username: '+250788123456', password: '2468' })
    expect(requests.slice(0, 3).some(request => request.headers.Authorization)).toBe(false)
    expect(requests[3].headers.Authorization).toBe('Bearer t-1')
    expect(await getLinkedAccount()).toEqual({ phone: '+250788123456', name: 'Uwase Ange' })
  })
  it('keeps an account without a name working, and the name it knew when the server cannot say', async () => {
    fakeServer({ '/auth/login': [200, { access_token: 't-1' }], '/auth/me': [200, { phone: '+250788123456', name: '' }] })
    await api.login('0788123456', '2468')
    expect(await getLinkedAccount()).toEqual({ phone: '+250788123456' })
    await db.settings.put({ key: 'account', value: { phone: '+250788123456', name: 'Mukamana' } })
    fakeServer({ '/auth/login': [200, { access_token: 't-2' }], '/auth/me': [503, {}] })
    await api.login('0788123456', '2468')
    expect(await getLinkedAccount()).toEqual({ phone: '+250788123456', name: 'Mukamana' })
    expect(await getToken()).toBe('t-2')
    // Another number signing in does not take that name.
    await api.login('0722000000', '2468')
    expect(await getLinkedAccount()).toEqual({ phone: '+250722000000' })
  })
  it('replaces a forgotten PIN with a code, and changes a known PIN', async () => {
    const requests = fakeServer({ '/auth/reset-pin': [204, null], '/auth/change-pin': [204, null] })
    expect(await api.resetPin('+250788123456', '654321', '1357')).toBeNull()
    expect(await api.changePin('+250788123456', '1357', '9753')).toBeNull()
    expect(requests[0]).toMatchObject({ path: '/auth/reset-pin', method: 'POST', body: { phone: '+250788123456', code: '654321', pin: '1357' } })
    expect(requests[1]).toMatchObject({ path: '/auth/change-pin', body: { phone: '+250788123456', pin: '1357', new_pin: '9753' } })
  })
  it('signs a signed-in device in again after a PIN change, which ends the sessions opened with the old PIN', async () => {
    await db.settings.put({ key: 'token', value: 'opened-with-1357' })
    const requests = fakeServer({ '/auth/change-pin': [204, null], '/auth/login': [200, { access_token: 'opened-with-9753' }] })
    await api.changePin('+250788123456', '1357', '9753')
    expect(requests.map(request => request.path)).toEqual(['/auth/change-pin', '/auth/login', '/auth/me'])
    expect(requests[1].body).toEqual({ username: '+250788123456', password: '9753' })
    expect(await getToken()).toBe('opened-with-9753')
  })
  it('erases the account with the PIN, then forgets it, its session and its account copy on this device', async () => {
    const joined = { key: 'account-backup', value: { phone: '+250788123456', revision: 3 } }
    await db.settings.bulkPut([{ key: 'token', value: 't-1' }, { key: 'account', value: { phone: '+250788123456', name: 'Uwase' } }, { key: 'pin', value: 'kept' }, joined])
    await db.profiles.put({ profile_id: 'local-1', code: 'Keza', local_only: true })
    const unchanged = async () => {
      expect(await getToken()).toBe('t-1')
      expect(await getLinkedAccount()).toEqual({ phone: '+250788123456', name: 'Uwase' })
      expect(await db.settings.get('account-backup')).toEqual(joined)
    }
    // A wrong PIN, a lock, a server that fails or cannot be reached, or no internet: nothing is forgotten.
    for (const [reply, message] of [[[401, { detail: 'wrong phone or PIN' }], 'si byo'], [[429, { retry_after: 900 }], 'iminota 15'], [[500, {}], 'Seriveri ntiyabashije']]) {
      fakeServer({ '/auth/delete-account': reply })
      await expect(api.deleteAccount('+250788123456', '1111')).rejects.toMatchObject({ status: reply[0], message: expect.stringContaining(message) })
      await unchanged()
    }
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    await expect(api.deleteAccount('+250788123456', '2468')).rejects.toMatchObject({ localized: true, message: expect.stringContaining('seriveri ya Vuga') })
    await unchanged()
    const requests = fakeServer({ '/auth/delete-account': [204, null] })
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.deleteAccount('+250788123456', '2468')).rejects.toThrow('Nta interineti')
    expect(requests).toHaveLength(0)
    await unchanged()
    vi.stubGlobal('navigator', { onLine: true })
    expect(await api.deleteAccount('+250788123456', '2468')).toBeNull()
    expect(requests[0]).toMatchObject({ path: '/auth/delete-account', method: 'POST', body: { phone: '+250788123456', pin: '2468' } })
    expect(requests[0].headers.Authorization).toBeUndefined()
    expect(await getToken()).toBeNull()
    expect(await getLinkedAccount()).toBeNull()
    expect(await db.settings.get('account-backup')).toBeUndefined()
    // What the caregiver keeps on this device stays.
    expect((await db.settings.get('pin')).value).toBe('kept')
    expect(await db.profiles.count()).toBe(1)
  })
  it('changes and deletes a server child with the signed-in account, and says when the account does not have it', async () => {
    await db.settings.put({ key: 'token', value: 't-1' })
    const requests = fakeServer({ '/profiles/p-1': [200, { profile_id: 'p-1', code: 'P-17', age_band: '7-9' }] })
    expect(await api.updateProfile('p-1', { code: 'P-17', age_band: '7-9' })).toMatchObject({ code: 'P-17' })
    expect(requests[0]).toMatchObject({ method: 'PATCH', body: { code: 'P-17', age_band: '7-9' }, headers: { Authorization: 'Bearer t-1' } })
    fakeServer({ '/profiles/p-1': [409, { detail: 'code already used' }] })
    await expect(api.updateProfile('p-1', { code: 'P-08' })).rejects.toThrow('Iyi kode isanzwe ikoreshwa')
    fakeServer({ '/profiles/p-1': [404, { detail: 'profile not found' }] })
    await expect(api.deleteProfile('p-1')).rejects.toMatchObject({ status: 404, message: expect.stringContaining('ntari kuri konti') })
  })
  it('ends the session on this device when the server refuses it, as after a PIN change elsewhere', async () => {
    await db.settings.put({ key: 'token', value: 'opened-with-1357' })
    fakeServer({ '/backup/status': [401, { detail: 'invalid or expired token' }] })
    await expect(api.backupStatus()).rejects.toMatchObject({ status: 401, message: expect.stringContaining('Ongera winjire') })
    expect(await getToken()).toBeNull()
    // A wrong PIN at sign-in is not a refused session: the device keeps its own until then.
    await db.settings.put({ key: 'token', value: 'opened-with-1357' })
    fakeServer({ '/auth/login': [401, { detail: 'wrong phone or PIN' }] })
    await expect(api.login('0788123456', '1111')).rejects.toMatchObject({ status: 401 })
    expect(await getToken()).toBe('opened-with-1357')
  })
  it('says in Kinyarwanda what went wrong with a code or a PIN, and how long to wait', async () => {
    fakeServer({ '/auth/code': [429, { detail: 'wait', retry_after: 42, reason: 'wait' }], '/auth/register': [400, { reason: 'wrong', attempts_left: 3 }] })
    await expect(api.sendCode('+250788123456', 'register')).rejects.toThrow('Tegereza amasegonda 42, wongere usabe kode.')
    await expect(api.register('+250788123456', '000000', '2468', 'Uwase')).rejects.toThrow('Kode wanditse si yo. Reba SMS wongere uyandike: usigaje kugerageza inshuro 3.')
    fakeServer({ '/auth/code': [429, { retry_after: 2400, reason: 'limit' }], '/auth/reset-pin': [400, { reason: 'spent' }] })
    await expect(api.sendCode('+250788123456', 'register')).rejects.toThrow('Iyi nimero yohererejwe kode eshanu mu isaha imwe. Tegereza iminota 40')
    await expect(api.resetPin('+250788123456', '000000', '2468')).rejects.toThrow('Kode yanditswe nabi inshuro eshanu, ntigikora. Saba indi kode.')
    fakeServer({ '/auth/reset-pin': [400, { reason: 'expired' }] })
    await expect(api.resetPin('+250788123456', '000000', '2468')).rejects.toThrow('Kode yararangiye cyangwa yamaze gukoreshwa')
    // A server with no SMS set up says so, apart from a text the SMS service refused.
    fakeServer({ '/auth/code': [503, { detail: 'sms is not set up on this server' }] })
    await expect(api.sendCode('+250788123456', 'register')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('ntibirashyirwaho') })
    fakeServer({ '/auth/code': [409, { detail: 'phone already registered' }] })
    await expect(api.sendCode('+250788123456', 'register')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('isanzwe ifite konti ya Vuga') })
    fakeServer({ '/auth/code': [502, { detail: 'could not send the code' }] })
    await expect(api.sendCode('+250788123456', 'reset')).rejects.toThrow('SMS ntiyabashije koherezwa.')
    // Offline, and online but the server did not answer (or refused this app's address), differ.
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    await expect(api.sendCode('+250788123456', 'reset')).rejects.toThrow('Ntibyashobotse guhuza na seriveri ya Vuga.')
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.sendCode('+250788123456', 'reset')).rejects.toThrow('Nta interineti iri kuri iki gikoresho.')
    vi.unstubAllGlobals()
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
    expect(requests.filter(request => request.path === '/auth/login')).toHaveLength(2)
  })
})
