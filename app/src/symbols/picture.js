// Turns a phone photo into a small square picture for a custom word: centre-cropped like the
// bundled photographs and scaled to 384 px, so camera-sized images never fill device storage.
import { localizedError } from '../shared/errors-rw.js'

export const PICTURE_SIZE = 384
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024

// Largest centred square of a width x height image.
export function centreSquare(width, height) {
  const side = Math.min(width, height)
  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

export function checkPictureFile(file) {
  if (!(file instanceof Blob) || !file.type.startsWith('image/')) throw localizedError('Hitamo dosiye y’ifoto (JPG, PNG cyangwa WebP).')
  if (!file.size) throw localizedError('Iyi dosiye nta foto irimo. Hitamo indi.')
  if (file.size > MAX_PICTURE_BYTES) throw localizedError('Hitamo ifoto iri munsi ya MB 10.')
}

export async function preparePicture(file, size = PICTURE_SIZE) {
  checkPictureFile(file)
  let bitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw localizedError('Iyi foto ntifunguka. Gerageza indi foto.') }
  try {
    const { x, y, side } = centreSquare(bitmap.width, bitmap.height)
    const target = Math.round(Math.min(size, side))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = target
    const context = canvas.getContext('2d')
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, x, y, side, side, 0, 0, target, target)
    return await encode(canvas)
  } finally {
    bitmap.close?.()
  }
}

// WebP where the browser can encode it (Chrome, Edge, Firefox), JPEG otherwise (older Safari).
async function encode(canvas) {
  for (const [type, quality] of [['image/webp', 0.85], ['image/jpeg', 0.88]]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality))
    if (blob?.type === type && blob.size) return blob
  }
  throw localizedError('Iyi foto ntiyashoboye kubikwa. Gerageza indi foto.')
}
