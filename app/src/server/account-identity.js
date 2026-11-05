import { displayPhone, normalisePhone } from './phone.js'

// Email addresses can be reused after deletion. The server's immutable user id, rather than
// the address, ties a device's backup revision and PIN-recovery permission to an email account.
export function sameAccount(left, right) {
  if (!left || !right) return false
  if (left.user_id && right.user_id) return left.user_id === right.user_id
  if (left.email || right.email || left.auth_provider === 'firebase' || right.auth_provider === 'firebase') return false
  const phone = normalisePhone(left.phone)
  return !!phone && phone === normalisePhone(right.phone)
}

export const displayAccount = account => account?.email || (account?.phone ? displayPhone(account.phone) : '')

export function accountIdentity(account) {
  return account?.email
    ? { user_id: account.user_id, email: account.email, auth_provider: 'firebase' }
    : { phone: account?.phone ?? null, ...(account?.user_id ? { user_id: account.user_id } : {}) }
}
