// Match the API's creation/reset policy without changing existing login passwords.
export const PASSWORD_REQUIREMENT_TEXT = 'Koresha inyuguti 8–128, harimo nibura inyuguti nkuru imwe, umubare umwe n’ikimenyetso kimwe (nka !, @ cyangwa #).'
export const EMAIL_FORMAT_TEXT = 'Andika email yuzuye, nka izina@example.com.'

export function passwordRequirements(value) {
  const password = typeof value === 'string' ? value : ''
  const length = [...password].length // Unicode code points, as the Python API counts them.
  return {
    length: length >= 8 && length <= 128,
    uppercase: /\p{Lu}/u.test(password),
    number: /[0-9]/.test(password),
    symbol: /[\p{P}\p{S}]/u.test(password)
  }
}

export const validNewPassword = value => Object.values(passwordRequirements(value)).every(Boolean)

export function normalizeEmailAddress(value) {
  const email = typeof value === 'string' ? value.trim() : ''
  const parts = email.split('@')
  if (parts.length !== 2) return null
  const [local, domain] = parts
  if (!local || local.length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || !domain || /[\s\p{Cc}\\/:@?#%\[\]]/u.test(domain)) return null
  try {
    // A temporary nonnumeric suffix limits URL parsing to IDNA conversion; otherwise
    // it would silently turn a numeric domain such as 127.1 into a different IPv4 host.
    const suffix = '.vuga-validation.invalid'
    const host = new URL(`https://${domain}${suffix}`).hostname
    if (!host.endsWith(suffix)) return null
    const ascii = host.slice(0, -suffix.length)
    const labels = ascii.split('.')
    return local.length + 1 + ascii.length <= 254 && labels.length >= 2
      && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      ? `${local.toLowerCase()}@${ascii}` : null
  } catch { return null }
}

export const validEmailAddress = value => normalizeEmailAddress(value) !== null
