// A Rwandan mobile number (MTN 078 and 079, Airtel 072 and 073) in any usual spelling, kept as
// +2507XXXXXXXX like the Vuga API keeps it, so 0788 123 456 and +250 788 123 456 are one account.
const MOBILE = /^7[2389]\d{7}$/

export function normalisePhone(value) {
  let digits = String(value ?? '').replace(/[\s().-]/g, '')
  for (const prefix of ['+250', '00250', '250', '0']) {
    if (digits.startsWith(prefix) && digits.length === prefix.length + 9) { digits = digits.slice(prefix.length); break }
  }
  return MOBILE.test(digits) ? `+250${digits}` : null
}

// As Rwandans write it: 0788 123 456.
export function displayPhone(value) {
  const phone = normalisePhone(value)
  return phone ? `0${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}` : String(value ?? '')
}

// Numbers saved before they were kept in one form still match their account.
export const samePhone = (a, b) => (normalisePhone(a) ?? a) === (normalisePhone(b) ?? b)
