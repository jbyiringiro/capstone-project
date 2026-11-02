// Child mode: the caregiver chooses up to 12 pictures and the child sees only those, with no
// categories, message strip or buttons to manage. Ready-made boards cover common routines.
export const MAX_CHILD_BOARD = 12

export const CHILD_PRESETS = Object.freeze([
  { id: 'essentials', rw: 'Iby’ingenzi', keys: ['YES', 'NO', 'HELP', 'TOILET', 'WATER', 'EAT', 'HURT', 'FINISH', 'PLAY'] },
  { id: 'meal', rw: 'Igihe cyo kurya', keys: ['WATER', 'MILK', 'TEA', 'BREAD', 'BANANA', 'RICE', 'AGAIN', 'FINISH', 'NO'] },
  { id: 'play', rw: 'Igihe cyo gukina', keys: ['PLAY', 'BALL', 'MUSIC', 'DANCE', 'SING', 'RUN', 'AGAIN', 'STOP', 'FRIEND'] },
  { id: 'feelings', rw: 'Uko numva', keys: ['HAPPY', 'CRY', 'ANGRY', 'AFRAID', 'TIRED', 'HURT', 'SICK', 'HUNGRY', 'HOT'] },
  { id: 'school', rw: 'Ku ishuri', keys: ['TEACHER', 'BOOK', 'PEN', 'DRAW', 'WRITE', 'READ', 'HELP', 'TOILET', 'FINISH'] },
  { id: 'home', rw: 'Mu rugo', keys: ['MUM', 'DAD', 'HOME', 'BED', 'SLEEP', 'BATHE', 'TV', 'EAT', 'PLAY'] }
].map(Object.freeze))

export const presetById = id => CHILD_PRESETS.find(preset => preset.id === id) ?? null

// Columns x rows that keep cards as large and as square as the screen allows.
export function childGridShape(count, portrait = false) {
  if (count <= 1) return [1, 1]
  if (count <= 2) return portrait ? [1, 2] : [2, 1]
  if (count <= 4) return [2, 2]
  if (count <= 6) return portrait ? [2, 3] : [3, 2]
  if (count <= 9) return [3, 3]
  return portrait ? [3, 4] : [4, 3]
}
