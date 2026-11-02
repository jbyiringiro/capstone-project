import { useState } from 'react'
import { api } from '../server/api-client.js'
import { clearValidation } from './components.jsx'

// Optional adult account on the Vuga server (FR1). The board never needs it.
export default function LoginForm({ onDone, setError }) {
  const [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState('')
  const [registering, setRegistering] = useState(false), [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { if (registering) await api.register(name, phone, password); await api.login(phone, password); await onDone() }
    catch { setError('Kwinjira ntibyashobotse. Reba ko seriveri iboneka kandi amakuru ya konti ari yo. Ushobora gukomeza gukoresha ibiri kuri iki gikoresho.') }
    finally { setBusy(false) }
  }
  return <form className="card" onSubmit={submit}>
    <h2>{registering ? 'Iyandikishe' : 'Injira'}<small>Konti yo kuri seriveri si ngombwa</small></h2>
    <p className="muted">Injira kugira ngo ubone imyirondoro ya konti yawe kandi wohereze ubutumwa bwayo bwarangiye.</p>
    {registering && <label>Izina <small>Izina ry’umuntu mukuru</small><input value={name} onChange={e => setName(e.target.value)} onInvalid={e => e.currentTarget.setCustomValidity('Andika izina ry’umuntu mukuru.')} onInput={clearValidation} autoComplete="name" required /></label>}
    <label>Telefoni <input value={phone} onChange={e => setPhone(e.target.value)} onInvalid={e => e.currentTarget.setCustomValidity('Andika nimero ya telefoni yawe.')} onInput={clearValidation} inputMode="tel" autoComplete="username" required /></label>
    <label>Ijambobanga <small>Nibura inyuguti cyangwa ibimenyetso 6</small><input type="password" value={password} onChange={e => setPassword(e.target.value)} onInvalid={e => e.currentTarget.setCustomValidity('Andika ijambobanga rifite nibura inyuguti cyangwa ibimenyetso 6.')} onInput={clearValidation} autoComplete={registering ? 'new-password' : 'current-password'} minLength={6} required /></label>
    <button className="primary" disabled={busy}>{busy ? 'Birimo guhuza…' : registering ? 'Fungura konti' : 'Injira'}</button>
    <button type="button" className="ghost" disabled={busy} onClick={() => setRegistering(!registering)}>{registering ? 'Mfite konti' : 'Fungura konti y’umuntu mukuru'}</button>
  </form>
}
