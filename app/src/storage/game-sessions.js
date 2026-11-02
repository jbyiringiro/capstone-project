// Results of the picture-finding game, kept per child on this device for the caregiver's progress
// view and to choose which words to practise. Never exported or synchronised.
import { db } from './db.js'

export async function saveGameSession(profileId, startedAt, results) {
  return db.game_sessions.add({
    profile_id: profileId, started_at: startedAt, finished_at: new Date().toISOString(),
    rounds: results, stars: results.length
  })
}

export async function listGameSessions(profileId) {
  return db.game_sessions.where('profile_id').equals(profileId).sortBy('finished_at')
}

// For each word: how often it was asked and how often it was found at the first try.
export function wordHistory(sessions) {
  const history = {}
  for (const session of sessions) {
    for (const { target, misses } of session.rounds) {
      const entry = history[target] ??= { asked: 0, firstTry: 0 }
      entry.asked += 1
      if (misses === 0) entry.firstTry += 1
    }
  }
  return history
}

export function gameProgress(sessions, recent = 7) {
  const history = wordHistory(sessions)
  const practice = Object.entries(history).filter(([, h]) => h.asked > h.firstTry)
    .sort((a, b) => (b[1].asked - b[1].firstTry) - (a[1].asked - a[1].firstTry) || a[0].localeCompare(b[0]))
    .slice(0, 5).map(([key, h]) => ({ key, ...h }))
  return {
    totalStars: sessions.reduce((sum, s) => sum + s.stars, 0),
    games: sessions.slice(-recent).reverse().map(s => ({
      finished_at: s.finished_at, stars: s.stars,
      firstTry: s.rounds.filter(r => r.misses === 0).length, hints: s.rounds.filter(r => r.hinted).length
    })),
    practice
  }
}
