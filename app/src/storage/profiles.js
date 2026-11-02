import { db } from './db.js'
import { localizedError } from '../shared/errors-rw.js'

export const PROFILE_CODE = /^[A-Z]-\d{2,3}$/
// A child on this device goes by a code such as P-01 or by the name the family uses. Only
// server profiles, whose messages can be uploaded, are kept to codes.
export const PROFILE_NAME_MAX = 30
const PROFILE_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’-]*$/u

export async function getProfiles() {
  return db.profiles.orderBy('code').toArray()
}

export async function createLocalProfile(code, age_band = null) {
  code = code.trim().replace(/\s+/g, ' ')
  const isCode = PROFILE_CODE.test(code.toUpperCase())
  if (isCode) code = code.toUpperCase()
  else if (code.length > PROFILE_NAME_MAX || !PROFILE_NAME.test(code)) throw localizedError(`Andika izina cyangwa kode y’umwana, nka Keza cyangwa P-01. Inyuguti ntizirenge ${PROFILE_NAME_MAX}.`)
  return db.transaction('rw', db.profiles, async () => {
    if (await db.profiles.where('code').equalsIgnoreCase(code).count()) throw localizedError(isCode ? 'Iyi kode isanzwe iri kuri iki gikoresho.' : 'Iri zina risanzwe riri kuri iki gikoresho.')
    const profile = { profile_id: `local-${crypto.randomUUID()}`, code, age_band, access_method: 'touch', local_only: true }
    await db.profiles.add(profile)
    return profile
  })
}

export async function saveServerProfiles(profiles) {
  await db.profiles.bulkPut(profiles.map(profile => ({ ...profile, local_only: false })))
}
