// Erekana gives the message's pictures all the room the screen has: the largest cards that fit every
// picture between the sentence and the footer, in as many columns as suits the count. A card is a
// square picture with its word under it, so it is a little taller than it is wide.
export const CARD_GAP = 14
const CARD_HEIGHT = 1.25
// About 2.5 cm, so a long message keeps readable cards and scrolls instead of shrinking further.
const MIN_CARD = 96
const MAX_CARD = 560

export function cardLayout(count, width, height, gap = CARD_GAP) {
  let columns = 1, size = 0
  for (let tried = 1; tried <= Math.max(count, 1); tried++) {
    const rows = Math.ceil(count / tried)
    const fits = Math.min((width - gap * (tried - 1)) / tried, (height - gap * (rows - 1)) / rows / CARD_HEIGHT)
    if (fits > size) { columns = tried; size = fits }
  }
  if (size >= MIN_CARD) return { columns, size: Math.floor(Math.min(size, MAX_CARD)) }
  size = Math.min(MIN_CARD, Math.floor(width))
  return { columns: Math.max(1, Math.min(count, Math.floor((width + gap) / (size + gap)))), size }
}
