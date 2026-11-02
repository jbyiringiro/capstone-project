import { expect, it } from 'vitest'
import { localizedError, userError } from '../src/errors-rw.js'

it('keeps technical/browser English errors out of the user interface', () => {
  expect(userError(new Error('NetworkError: failed to fetch private endpoint'))).toBe('Ntibyashobotse. Ongera ugerageze.')
  expect(userError(new Error('QuotaExceededError'), 'Ububiko bwuzuye.')).toBe('Ububiko bwuzuye.')
})
it('preserves explicitly localized actionable errors', () => {
  expect(userError(localizedError('Iyi kode isanzwe iri kuri iki gikoresho.'))).toBe('Iyi kode isanzwe iri kuri iki gikoresho.')
})
