import { describe, expect, it } from 'vitest'
import { displayPhone, normalisePhone, samePhone } from '../../src/server/phone.js'

describe('mobile numbers', () => {
  it('reads a Rwandan mobile number in any usual spelling as one number', () => {
    for (const spelling of ['0788123456', '0788 123 456', '+250 788 123 456', '250788123456', '00250-788-123-456', '788123456', '(078) 812-3456']) {
      expect(normalisePhone(spelling)).toBe('+250788123456')
    }
    for (const number of ['0722123456', '0732123456', '0792123456']) expect(normalisePhone(number)).toBe(`+250${number.slice(1)}`)
  })
  it('refuses what is not a Rwandan mobile number', () => {
    for (const wrong of ['', '0788', '07881234567', '0748123456', '+254712345678', '07881234ab', null, undefined]) expect(normalisePhone(wrong)).toBeNull()
  })
  it('shows a number as Rwandans write it and matches numbers saved in another spelling', () => {
    expect(displayPhone('+250788123456')).toBe('0788 123 456')
    expect(displayPhone('not a number')).toBe('not a number')
    expect(samePhone('0780000001', '+250780000001')).toBe(true)
    expect(samePhone('0780000001', '0780000002')).toBe(false)
  })
})
