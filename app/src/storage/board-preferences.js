import { db } from './db.js'

export const DEFAULT_APPEARANCE = Object.freeze({ motion: true, largeTiles: false, realisticImages: true })

export function normaliseAppearance(value) {
  // The previous illustratedSymbols setting controlled decorative icons, not
  // photos. Enable this new image set while retaining the other profile choices.
  return Object.fromEntries(Object.entries(DEFAULT_APPEARANCE).map(([key, fallback]) =>
    [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]))
}

const settingKey = profileId => `appearance:${profileId ?? 'demo'}`

export async function getAppearance(profileId) {
  return normaliseAppearance((await db.settings.get(settingKey(profileId)))?.value)
}

export async function saveAppearance(profileId, value) {
  const appearance = normaliseAppearance(value)
  await db.settings.put({ key: settingKey(profileId), value: appearance })
  return appearance
}
