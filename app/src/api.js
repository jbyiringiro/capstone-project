// Thin client for the Vuga API. The token lives in IndexedDB settings so the dashboard survives reloads.
import { db } from './db.js'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

export async function getToken() { return (await db.settings.get('token'))?.value ?? null }
export async function setToken(value) { await db.settings.put({ key: 'token', value }) }

async function req(path, { method = 'GET', body, form, auth = true } = {}) {
  const headers = {}
  if (auth) { const t = await getToken(); if (t) headers.Authorization = `Bearer ${t}` }
  let payload
  if (form) { payload = new URLSearchParams(form); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json' }
  const r = await fetch(`${API_BASE}${path}`, { method, headers, body: payload })
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

export const api = {
  register: (name, phone, password, role = 'teacher') => req('/auth/register', { method: 'POST', body: { name, phone, password, role }, auth: false }),
  login: async (phone, password) => { const t = await req('/auth/login', { method: 'POST', form: { username: phone, password }, auth: false }); await setToken(t.access_token); return t },
  logout: () => setToken(null),
  symbols: () => req('/symbols', { auth: false }),
  profiles: () => req('/profiles'),
  createProfile: (code, age_band) => req('/profiles', { method: 'POST', body: { code, age_band } }),
  vocabulary: (pid) => req(`/profiles/${pid}/vocabulary`),
  setVocabulary: (pid, symbol_ids) => req(`/profiles/${pid}/vocabulary`, { method: 'PUT', body: { symbol_ids } }),
  summary: (pid) => req(`/profiles/${pid}/summary`),
  health: () => req('/health', { auth: false })
}
