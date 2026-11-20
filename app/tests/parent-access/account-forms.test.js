import { describe, expect, it } from 'vitest'
import { caregiverName } from '../../src/parent-access/forms.jsx'
import { codeSentText } from '../../src/server/use-phone-code.js'

describe('the caregiver’s name for a new account', () => {
  it('takes an ordinary name in any script, with its spaces tidied', () => {
    expect(caregiverName('  Uwase   Ange ')).toBe('Uwase Ange')
    for (const name of ['Ñkurunziza Jean-Paul', 'Ange O’Neil', 'Мария', '李明', 'M'.repeat(120)]) expect(caregiverName(name)).toBe(name)
  })
  it('refuses an empty or too long name and control characters, as the server does', () => {
    for (const name of ['', '   ', null, undefined, 'M'.repeat(121), 'Uwase\u0007']) expect(caregiverName(name)).toBeNull()
  })
})

describe('what the caregiver is told once a code is sent', () => {
  it('says a text is on its way only when it went to a phone', () => {
    expect(codeSentText('sms', '0788 123 456')).toMatch(/^Twohereje kode y’imibare 6 kuri 0788 123 456\. Imara iminota 10\./)
    expect(codeSentText(undefined, '0788 123 456')).toMatch(/^Twohereje kode/)
    // The provider's sandbox and a development server's log never reach a phone, and say so.
    expect(codeSentText('simulator', '0788 123 456')).toContain('simulator ya Africa’s Talking (igerageza): ntizagera kuri telefoni')
    expect(codeSentText('log', '0788 123 456')).toContain('ntizagera kuri telefoni')
  })
})
