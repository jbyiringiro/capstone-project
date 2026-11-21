import { describe, expect, it } from 'vitest'
import { normalizeEmailAddress, passwordRequirements, validEmailAddress, validNewPassword } from '../../src/shared/account-validation.js'

describe('new account password policy', () => {
  it.each(['Abcdef1!', 'UPPER123#', ' École-12 ', 'Aa1😀bbbb', 'A1!' + 'a'.repeat(125)])('accepts all requirements without trimming (%s)', value => {
    expect(validNewPassword(value)).toBe(true)
  })
  it.each(['', null, 'Ab1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 ', 'A1!' + 'a'.repeat(126), 'Aa1😀😀😀😀'])('rejects missing requirements or wrong code-point length (%s)', value => {
    expect(validNewPassword(value)).toBe(false)
  })
  it('reports each unmet requirement independently for inline guidance', () => {
    expect(passwordRequirements('lowercase')).toEqual({ length: true, uppercase: false, number: false, symbol: false })
    expect(passwordRequirements('Abcdef12')).toEqual({ length: true, uppercase: true, number: true, symbol: false })
    expect(passwordRequirements('Abcdef1!')).toEqual({ length: true, uppercase: true, number: true, symbol: true })
  })
})

describe('email format validation without lookup', () => {
  it('normalizes internationalized domains before case conversion and keeps distinct domains distinct', () => {
    expect(normalizeEmailAddress(' A@faß.de ')).toBe('a@xn--fa-hia.de')
    expect(normalizeEmailAddress('A@fass.de')).toBe('a@fass.de')
    expect(normalizeEmailAddress('A@ÉCOLE.example')).toBe('a@xn--cole-9oa.example')
    expect(normalizeEmailAddress('A@ΟΣ.example')).toBe('a@xn--0xai.example')
    expect(normalizeEmailAddress('A@Ος.example')).toBe('a@xn--0xag.example')
    expect(normalizeEmailAddress('not-an-email')).toBeNull()
  })
  it.each(['127.1', '0x7f.1'])('does not let URL parsing reinterpret the numeric domain %s as IPv4', domain => {
    expect(normalizeEmailAddress(`A@${domain}`)).toBe(`a@${domain}`)
  })
  it.each(['parent@example.com', ' parent+school@school-name.example ', 'Teacher.Name+test@example.test', 'a@école.example', "o'neil@example.com"])
    ('accepts common address forms and internationalized domains (%s)', value => expect(validEmailAddress(value)).toBe(true))
  it.each(['', null, 'parent', 'parent@example', 'a@@example.com', 'a b@example.com', '.a@example.com', 'a.@example.com',
    'a..b@example.com', 'a@-school.example', 'a@school-.example', 'a@example..com', 'a@example.com.',
    'a@example.com/path', 'a@example.com:443', 'a@example.com?x=1', 'a@exam_ple.com', 'a'.repeat(65) + '@example.com'])
    ('rejects obvious local/domain syntax errors (%s)', value => expect(validEmailAddress(value)).toBe(false))
})
