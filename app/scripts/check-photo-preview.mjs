import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('../../docs/screenshots/photos-2026-10-06/', import.meta.url))
const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../public/photos/manifest.json', import.meta.url)), 'utf8'))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const origin = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
const tile = key => page.locator(`.symbol-grid [data-symbol="${key}"]`)
async function waitForImages() {
  await expect.poll(() => page.locator('.symbol-artwork img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
}
try {
  await page.goto(origin)
  await expect(tile('I')).toBeVisible()
  await expect(tile('I').locator('img')).toHaveAttribute('src', '/photos/I.webp')
  await waitForImages()
  expect(await tile('I').locator('img').evaluate(image => getComputedStyle(image).objectFit)).toBe('contain')
  const decoded = await page.evaluate(async images => {
    const result = []
    for (const image of images) {
      const response = await fetch(image.url)
      if (!response.ok) throw new Error(`Missing photo: ${image.symbol_id}`)
      const bitmap = await createImageBitmap(await response.blob())
      result.push({ id: image.symbol_id, width: bitmap.width, height: bitmap.height })
      bitmap.close()
    }
    return result
  }, manifest.images)
  expect(decoded.every(image => image.width === 480 && image.height === 480)).toBe(true)
  await page.screenshot({ path: `${output}/photo-preview-desktop.png` })
  await tile('I').click()
  await tile('WATER').click()
  await expect(page.locator('.message-chip .symbol-artwork--photo')).toHaveCount(2)
  await page.getByRole('button', { name: 'Erekana ubutumwa', exact: true }).click()
  await expect(page.locator('.message-dialog[open] .symbol-artwork--photo')).toHaveCount(2)
  await page.screenshot({ path: `${output}/photo-preview-message.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.symbol-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(2)
  await waitForImages()
  await page.screenshot({ path: `${output}/photo-preview-mobile.png` })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name: 'Ikibaho', exact: true }).click()
  const photoSwitch = page.getByRole('switch', { name: 'Amafoto afatika', exact: true })
  await expect(photoSwitch).toBeChecked()
  await photoSwitch.uncheck()
  await expect(photoSwitch).toBeEnabled()
  await page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
  await expect(tile('I').locator('img')).toHaveAttribute('src', '/symbols/I.png')
  await page.reload()
  await expect(tile('I').locator('img')).toHaveAttribute('src', '/symbols/I.png')
  await page.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name: 'Ikibaho', exact: true }).click()
  await photoSwitch.check()
  await expect(photoSwitch).toBeEnabled()
  await page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
  await expect(tile('I').locator('img')).toHaveAttribute('src', '/photos/I.webp')
  await context.route('**/photos/WATER.webp', route => route.fulfill({ status: 404, body: '' }))
  await page.reload()
  await expect(tile('WATER').locator('img')).toHaveAttribute('src', '/symbols/WATER.png')
  await expect.poll(() => tile('WATER').locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(tile('WATER')).toHaveAccessibleName('amazi')
  await tile('WATER').click()
  await expect(page.locator('.message-chip img')).toHaveAttribute('src', '/symbols/WATER.png')
  expect(errors).toEqual([])
  const report = { status: 'passed', checked_at: new Date().toISOString(), decoded_photos: decoded.length, available_photos: manifest.coverage.available, required_photos: manifest.coverage.expected, all_available_photos_480_square: true, desktop_and_phone_layout: true, photograph_preference_persists: true, deliberate_missing_photo_falls_back_to_pictogram: true, message_composition_survives_photo_failure: true, page_errors: errors, limitation: 'Preview checks only; full offline and speech workflow checks are separate.' }
  await writeFile(`${output}/photo-preview-report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await context.close(); await browser.close() }
