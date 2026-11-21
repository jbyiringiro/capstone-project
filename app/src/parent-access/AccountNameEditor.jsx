import { useRef, useState } from 'react'
import { api } from '../server/api-client.js'
import { NameField, PasswordField, MESSAGES, caregiverName, errorText } from './forms.jsx'

// Changing the adult's display name preserves their immutable account and child ownership.
export default function AccountNameEditor({ account, disabled, onSaved, onBusyChange }) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(account.name || '')
  const [password, setPassword] = useState(''), [needsLogin, setNeedsLogin] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submitting = useRef(false)
  function close() {
    setEditing(false); setName(account.name || ''); setPassword(''); setNeedsLogin(false); setError('')
  }
  async function save(event) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const validName = caregiverName(name)
    if (!validName) { setError(MESSAGES.name); return }
    submitting.current = true; setBusy(true); onBusyChange(true); setError('')
    try {
      if (needsLogin) await api.reauthenticateEmail(account.email, password, account)
      const saved = await api.updateAccountName(validName, account)
      setPassword(''); setNeedsLogin(false); setEditing(false); onSaved(saved)
    } catch (failure) {
      if (failure.status === 401) setNeedsLogin(true)
      setError(errorText(failure))
    } finally { submitting.current = false; setBusy(false); onBusyChange(false) }
  }
  if (!editing) return <button type="button" className="button-outline" disabled={disabled} onClick={() => {
    setName(account.name || ''); setEditing(true)
  }}>Hindura izina</button>
  return <form className="account-name-editor" aria-label="Hindura izina rya konti" onSubmit={save}>
    <NameField value={name} setValue={setName} disabled={busy || disabled} hint={false} />
    {needsLogin && <>
      <p className="email-help">Ongera winjire kuri {account.email} kugira ngo ubike izina.</p>
      <PasswordField value={password} setValue={setPassword} disabled={busy || disabled} />
    </>}
    {error && <p role="alert" className="parent-form-error">{error}</p>}
    <div className="account-delete-actions">
      <button className="button-primary" disabled={busy || disabled}>{busy ? 'Birimo kubikwa…' : 'Bika izina'}</button>
      <button type="button" className="button-outline" disabled={busy || disabled} onClick={close}>Reka</button>
    </div>
  </form>
}
