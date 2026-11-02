import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// End-to-end checks for the final-version features on the production build: caregiver custom
// words (FR3), fixed grid pages of 4 to 40 cells and a grid that fits the screen (NFR3), swiping
// between pages on a touch screen, personal suggestions, the vocabulary review screen used for RQ1,
// next words after a picture, words for where the child is, and speaking each picture as it is
// tapped. System voices are hidden so speech falls back deterministically; bundled clips and
// IndexedDB stay real.
//
//   VUGA_PREVIEW_URL=http://127.0.0.1:4175/ VUGA_EVIDENCE_DIR=<folder> node scripts/check-final-features.mjs
const output = process.env.VUGA_EVIDENCE_DIR || fileURLToPath(new URL('../../docs/screenshots/final-2026-10-22/', import.meta.url))
const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
const channel = process.env.VUGA_BROWSER_CHANNEL || 'msedge'
const photo = fileURLToPath(new URL('../public/photos/HOME.webp', import.meta.url))
const clip = fileURLToPath(new URL('../public/audio/rw/WATER.wav', import.meta.url))
await mkdir(output, { recursive: true })
const vocabFile = name => readFile(fileURLToPath(new URL(`../../vocab/${name}`, import.meta.url)), 'utf8')
const reviewWords = (await vocabFile('review_words.csv')).trim().split(/\r?\n/).slice(1)
const labels = Object.fromEntries((await vocabFile('symbols.csv')).trim().split(/\r?\n/).slice(1).map(row => row.split(',').slice(0, 2)))

const browser = await chromium.launch({ channel, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await context.addInitScript(() => {
  if ('speechSynthesis' in window) Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: () => [] })
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const checks = [], screenshots = [], pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))

const board = page.locator('.board:visible')
const tiles = () => board.locator('.symbol-grid .symbol-tile')
const chips = () => board.locator('.message-tray .message-chip')
const suggestionKeys = () => board.locator('.suggestion-row [data-symbol]').evaluateAll(cells => cells.map(cell => cell.dataset.symbol))
const tab = name => page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name, exact: true }).click()
// The caregiver chooses the section in Ikibaho; these checks run with the section tabs off.
async function category(name) {
  await caregiver()
  await tab('Ikibaho')
  const option = page.locator('.dash-section-options label').filter({ hasText: new RegExp(`^${name}$`) })
  if (!(await option.locator('input').isChecked())) { await option.click(); await saved() }
  await back()
}
const saved = () => expect(page.locator('.dash-save-note')).toContainText('Ibyatoranyijwe byabitswe kuri iki gikoresho')

async function check(name, action) {
  await action()
  checks.push({ name, status: 'passed' })
  console.log(`PASS ${checks.length}: ${name}`)
}
async function screenshot(name) {
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
  screenshots.push({ file: `${name}.png`, viewport: page.viewportSize() })
}
async function caregiver() {
  await board.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  const gate = page.locator('.parent-access')
  await expect(gate).toHaveAttribute('data-mode', /setup|unlock/)
  const setup = await gate.getAttribute('data-mode') === 'setup'
  // A first setup offers the caregiver's number; these checks keep the PIN on this device only.
  if (setup) await gate.getByRole('button', { name: 'Komeza nta nimero', exact: true }).click()
  await gate.getByLabel('Umubare w’ibanga', { exact: true }).fill('730521')
  if (setup) {
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('730521')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
    await gate.getByRole('button', { name: 'Nayanditse, komeza', exact: true }).click()
  } else await gate.getByRole('button', { name: 'Injira', exact: true }).click()
  await expect(page.locator('.dash')).toBeVisible()
}
async function back() {
  await page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
  await expect(board).toBeVisible()
}
async function setSwitch(name, checked) {
  const control = page.getByRole('switch', { name, exact: true })
  await expect(control).toBeEnabled()
  if (await control.isChecked() !== checked) { await control.click(); await saved() }
}
async function chooseGrid(label) {
  await page.locator('.dash-grid-options label').filter({ hasText: label }).click()
  await saved()
}
// A finger through the browser's own touch input: a swipe that starts on an element, or a tap.
let touchInput
async function touch(type, points) {
  touchInput ??= await context.newCDPSession(page)
  await touchInput.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) })
}
async function swipe(target, across, down = 0, pause = 16) {
  const box = await target.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  await touch('touchStart', [[x, y]])
  for (let step = 1; step <= 8; step++) {
    await touch('touchMove', [[x + across * step / 8, y + down * step / 8]])
    await page.waitForTimeout(pause)
  }
  await touch('touchEnd', [])
}
async function touchTap(target) {
  const box = await target.boundingBox()
  await touch('touchStart', [[box.x + box.width / 2, box.y + box.height / 2]])
  await touch('touchEnd', [])
}
async function speakAndWait() {
  const before = (await stored()).messages.filter(m => m.spoken_at).length
  await board.getByRole('button', { name: 'Vuga ubutumwa', exact: true }).click()
  await expect.poll(async () => (await stored()).messages.filter(m => m.spoken_at).length, { timeout: 20000 }).toBe(before + 1)
  await expect(chips()).toHaveCount(0)
}
async function stored() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const r = indexedDB.open('vuga'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    try {
      const names = ['messages', 'tap_events', 'custom_symbols', 'recordings', 'vocabulary']
      const transaction = database.transaction(names, 'readonly')
      return Object.fromEntries(await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const r = transaction.objectStore(name).getAll()
        r.onsuccess = () => resolve([name, r.result.map(({ image, blob, ...row }) => ({ ...row, hasImage: !!image, hasBlob: !!blob }))])
        r.onerror = () => reject(r.error)
      }))))
    } finally { database.close() }
  })
}

try {
  await page.goto(baseURL)
  await expect(board).toBeVisible()
  // A new device opens with the section tabs and word suggestions on (the Kinyarwanda suite's first
  // check). These checks pick the section in Ikibaho, which needs the tabs off; the section check
  // below turns them on and off again.
  await expect(board.locator('.category-bar')).toBeVisible()
  await caregiver()
  await tab('Ikibaho')
  await setSwitch('Ibyiciro ku kibaho cy’umwana', false)
  await back()

  let customKey
  await check('A caregiver adds a word from a phone photo; the picture is cropped square and stored on the device only', async () => {
    await caregiver()
    await tab('Amagambo mashya')
    await expect(page.getByRole('heading', { name: 'Ongeraho amagambo y’ubuzima bw’umwana.' })).toBeVisible()
    await page.getByLabel('Ifoto y’ijambo', { exact: true }).setInputFiles(photo)
    await expect(page.locator('.custom-word-preview img')).toBeVisible()
    await page.getByLabel('Izina ry’ijambo').fill('  nyogokuru ')
    await page.getByLabel('Icyiciro').selectOption('people')
    await page.getByRole('button', { name: 'Bika ijambo', exact: true }).click()
    await expect(page.locator('.custom-word-saved')).toContainText('Ijambo “nyogokuru” ryongewe ku kibaho')
    await expect(page.locator('.custom-word-item')).toHaveCount(1)
    await expect(page.locator('.custom-word-item')).toContainText('Nta jwi rirabikwa')
    const words = (await stored()).custom_symbols
    expect(words).toHaveLength(1)
    expect(words[0]).toMatchObject({ label_rw: 'nyogokuru', category: 'people', hasImage: true })
    customKey = words[0].symbol_id
    expect(customKey).toMatch(/^CUSTOM-[0-9A-F]{8}$/)
    const size = await page.locator('.custom-word-item > .symbol-artwork img').evaluate(img => [img.naturalWidth, img.naturalHeight])
    expect(size[0]).toBe(size[1])
    await screenshot('caregiver-custom-words')
  })

  await check('Duplicate labels and non-image files are refused with Kinyarwanda messages', async () => {
    await page.getByLabel('Ifoto y’ijambo', { exact: true }).setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') })
    await expect(page.locator('.custom-word-form [role="alert"]')).toContainText('JPG, PNG cyangwa WebP')
    await page.getByLabel('Ifoto y’ijambo', { exact: true }).setInputFiles(photo)
    await expect(page.locator('.custom-word-preview img')).toBeVisible()
    await page.getByLabel('Izina ry’ijambo').fill('Amazi')
    await page.getByRole('button', { name: 'Bika ijambo', exact: true }).click()
    await expect(page.locator('.custom-word-form [role="alert"]')).toContainText('risanzwe ku kibaho')
    expect((await stored()).custom_symbols).toHaveLength(1)
  })

  await check('The new word appears in its category on the board with its own photo, and Erekana still works without speech', async () => {
    await back()
    await category('Abantu')
    const cell = board.locator(`.symbol-grid [data-symbol="${customKey}"]`)
    await expect(cell).toHaveAccessibleName('nyogokuru')
    expect(await cell.locator('img').getAttribute('src')).toMatch(/^blob:/)
    await cell.click()
    await expect(chips()).toHaveCount(1)
    await board.getByRole('button', { name: 'Vuga ubutumwa', exact: true }).click()
    const failed = page.getByRole('dialog', { name: 'Erekana ubutumwa bwawe.' })
    await expect(failed).toBeVisible()
    await expect(failed).toContainText('nyogokuru')
    await failed.getByRole('button', { name: 'Erekana', exact: true }).click()
    const shown = page.getByRole('dialog', { name: 'Ubutumwa bwanjye' })
    await expect(shown).toContainText('nyogokuru')
    await shown.getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
    await expect(chips()).toHaveCount(1)
    expect((await stored()).messages.filter(m => m.spoken_at)).toHaveLength(0)
  })

  await check('A familiar-voice recording makes the custom word speak, and its message is kept off the server', async () => {
    await caregiver()
    await tab('Amagambo mashya')
    await page.getByRole('button', { name: 'Fata ijwi rya nyogokuru', exact: true }).click()
    await expect(page.locator('.audio-word-list button[aria-pressed="true"]')).toContainText('nyogokuru')
    await page.getByLabel('Dosiye y’ijwi', { exact: true }).setInputFiles(clip)
    await page.getByRole('button', { name: 'Bika ijwi', exact: true }).click()
    await expect(page.locator('.audio-status')).toContainText('ryabitswe')
    await back()
    await expect(chips()).toHaveCount(1)
    await speakAndWait()
    const data = await stored()
    const message = data.messages.find(m => m.spoken_at)
    expect(message.synced).toBe(-1)
    expect(data.tap_events.filter(e => e.message_id === message.message_id && e.action_type === 'select').map(e => e.symbol_key)).toEqual([customKey])
  })

  await check('Deleting a custom word removes it, its recording and its place on every board', async () => {
    await caregiver()
    await tab('Amagambo mashya')
    await page.getByRole('button', { name: 'Siba nyogokuru', exact: true }).click()
    await page.getByRole('button', { name: 'Siba ijambo', exact: true }).click()
    await expect(page.locator('.dash-save-note')).toContainText('Ijambo “nyogokuru” ryasibwe.')
    const data = await stored()
    expect(data.custom_symbols).toHaveLength(0)
    expect(data.recordings.filter(r => r.key === customKey)).toHaveLength(0)
    await back()
    await category('Abantu')
    await expect(board.locator(`[data-symbol="${customKey}"]`)).toHaveCount(0)
  })

  let corePages
  await check('A 9-cell grid shows fixed 3 x 3 pages; turning a page is logged as a navigation action', async () => {
    await caregiver()
    await tab('Ikibaho')
    await chooseGrid('3 × 3')
    await expect(page.getByRole('switch', { name: 'Amashusho manini cyane', exact: true })).toBeDisabled()
    await screenshot('caregiver-board-grid-settings')
    await back()
    await category('Ingenzi')
    await expect(board).toHaveClass(/fixed-grid/)
    await expect(tiles()).toHaveCount(9)
    const indicator = board.locator('.page-controls [aria-live]')
    const total = Number((await indicator.textContent()).match(/\/(\d+)/)[1])
    corePages = total
    expect(total).toBeGreaterThan(1)
    const firstPage = await tiles().evaluateAll(cells => cells.map(cell => cell.dataset.symbol))
    const firstBox = await tiles().first().boundingBox()
    await screenshot('board-grid-9-tablet')
    await board.getByRole('button', { name: 'Urupapuro rukurikira', exact: true }).click()
    await expect(indicator).toHaveText(`Urupapuro 2/${total}`)
    const secondPage = await tiles().evaluateAll(cells => cells.map(cell => cell.dataset.symbol))
    expect(secondPage.some(key => firstPage.includes(key))).toBe(false)
    const secondBox = await tiles().first().boundingBox()
    expect(Math.abs(secondBox.width - firstBox.width)).toBeLessThan(1)
    expect(firstBox.width).toBeGreaterThan(150)
    await tiles().first().click()
    await expect.poll(async () => (await stored()).tap_events.some(e => e.action_type === 'navigate' && e.context === 'page:2')).toBe(true)
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
  })

  await check('The last page keeps the grid shape with empty slots, and tiles stay at least 2 cm on a phone', async () => {
    const indicator = board.locator('.page-controls [aria-live]')
    while (!(await indicator.textContent()).startsWith(`Urupapuro ${corePages}/`)) {
      await board.getByRole('button', { name: 'Urupapuro rukurikira', exact: true }).click()
    }
    await expect(board.getByRole('button', { name: 'Urupapuro rukurikira', exact: true })).toBeDisabled()
    const shown = await tiles().count(), empty = await board.locator('.grid-slot').count()
    expect(shown + empty).toBe(9)
    await page.setViewportSize({ width: 390, height: 844 })
    await category('Ibiryo')
    await expect(tiles().first()).toBeVisible()
    const box = await tiles().first().boundingBox()
    // 2 cm is about 76 CSS px at the 96 px/inch reference; NFR3 asks for at least 2 cm targets.
    expect(box.width).toBeGreaterThanOrEqual(76)
    await screenshot('board-grid-9-phone')
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  await check('A 40-cell grid fits the whole everyday page, and "Byikora" fits the grid to a tablet and a phone with no page scroll', async () => {
    await caregiver()
    await tab('Ikibaho')
    await chooseGrid('8 × 5')
    await back()
    await category('Ingenzi')
    await expect(board.locator('.page-controls')).toHaveCount(0)
    const count = await tiles().count()
    expect(count).toBeLessThanOrEqual(40)
    await expect(board.locator('.grid-slot')).toHaveCount(40 - count)
    await caregiver()
    await tab('Ikibaho')
    await chooseGrid('Bihuza n’igikoresho')
    await back()
    await expect(board).toHaveClass(/fit-grid/)
    for (const [width, height, columns] of [[1280, 900, 10], [390, 844, 3]]) {
      await page.setViewportSize({ width, height })
      await expect.poll(() => board.locator('.symbol-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(columns)
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
      const first = await tiles().first().boundingBox(), last = await board.locator('.symbol-grid > *').last().boundingBox()
      expect(Math.min(first.width, first.height)).toBeGreaterThanOrEqual(76)
      expect(last.y + last.height).toBeLessThanOrEqual(height + 1)
      await screenshot(`board-fit-${width}`)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  await check('Personal suggestions need word suggestions on and lift a word this child uses after "I"', async () => {
    await caregiver()
    await tab('Ikibaho')
    const personal = page.getByRole('switch', { name: 'Amagambo umwana akunze gukoresha', exact: true })
    await setSwitch('Amagambo afasha', false)
    await expect(personal).toBeDisabled()
    await setSwitch('Amagambo afasha', true)
    await expect(personal).toBeEnabled()
    await back()
    await board.locator('.symbol-grid [data-symbol="I"]').click()
    const base = await suggestionKeys()
    expect(base).toHaveLength(3)
    expect(base).not.toContain('LIKE')
    await board.locator('.symbol-grid [data-symbol="LIKE"]').click()
    await speakAndWait()
    for (const key of ['I', 'LIKE']) await board.locator(`.symbol-grid [data-symbol="${key}"]`).click()
    await speakAndWait()
    await board.locator('.symbol-grid [data-symbol="I"]').click()
    expect(await suggestionKeys()).toEqual(base)
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Amagambo umwana akunze gukoresha', true)
    await back()
    await board.locator('.symbol-grid [data-symbol="I"]').click()
    await expect.poll(suggestionKeys).toContain('LIKE')
    await screenshot('board-personal-suggestions')
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
  })

  await check('The vocabulary review shows the sheet words one at a time, in order, with their voice', async () => {
    await caregiver()
    await tab('Amashusho')
    await page.getByRole('button', { name: 'Suzuma amagambo rimwe rimwe', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Gusuzuma amagambo', exact: true })
    const word = review.locator('.review-word'), progress = review.locator('.review-progress')
    await expect(word).toHaveAttribute('data-symbol', reviewWords[0])
    await expect(progress).toHaveText(`Ijambo 1 / ${reviewWords.length}`)
    await expect(review.getByRole('button', { name: 'Ijambo ribanziriza', exact: true })).toBeDisabled()
    await review.getByRole('button', { name: 'Ijambo rikurikira', exact: true }).click()
    await expect(word).toHaveAttribute('data-symbol', reviewWords[1])
    await page.keyboard.press('ArrowRight')
    await expect(word).toHaveAttribute('data-symbol', reviewWords[2])
    await expect(word.locator('figcaption')).toHaveText(labels[reviewWords[2]])
    await swipe(word, -220)
    await expect(word).toHaveAttribute('data-symbol', reviewWords[3])
    await swipe(word, 220)
    await expect(word).toHaveAttribute('data-symbol', reviewWords[2])
    await review.getByRole('button', { name: 'Vuga ijambo', exact: true }).click()
    await screenshot('caregiver-vocabulary-review')
    await review.getByLabel('Urutonde', { exact: true }).selectOption('all')
    await expect(progress).toHaveText(`Ijambo 1 / ${Object.keys(labels).length}`)
  })

  await check('Closing the review leaves no trace: no message, action or vocabulary change is stored', async () => {
    const before = await stored()
    const review = page.getByRole('dialog', { name: 'Gusuzuma amagambo', exact: true })
    await review.getByRole('button', { name: 'Ijambo rikurikira', exact: true }).click()
    await review.getByRole('button', { name: 'Funga isuzuma', exact: true }).click()
    await expect(review).toHaveCount(0)
    await page.getByRole('button', { name: 'Suzuma amagambo rimwe rimwe', exact: true }).click()
    await expect(review.locator('.review-word')).toHaveAttribute('data-symbol', reviewWords[0])
    await page.keyboard.press('Escape')
    await expect(review).toHaveCount(0)
    const after = await stored()
    for (const store of ['messages', 'tap_events', 'vocabulary']) expect(after[store]).toEqual(before[store])
    await back()
  })

  await check('Vuga says I + want + water as the sentence “Ndashaka amazi.”, Erekana shows it, and want alone stays “gushaka”', async () => {
    const audio = []
    const listen = request => { const path = new URL(request.url()).pathname; if (path.startsWith('/audio/')) audio.push(path) }
    page.on('request', listen)
    try {
      await category('Ingenzi')
      for (const key of ['I', 'WANT', 'WATER']) await board.locator(`.symbol-grid [data-symbol="${key}"]`).click()
      await board.getByRole('button', { name: 'Erekana ubutumwa', exact: true }).click()
      const shown = page.getByRole('dialog', { name: 'Ubutumwa bwanjye' })
      await expect(shown.locator('.display-sentence')).toHaveText('Ndashaka amazi.')
      await screenshot('board-erekana-sentence')
      await shown.getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
      // Each tap already said its own word; count only the message's audio.
      await expect.poll(() => audio).toContain('/audio/rw/WATER.wav')
      audio.length = 0
      await speakAndWait()
      expect(audio).toContain('/audio/rw/forms/ndashaka.mp3')
      expect(audio).toContain('/audio/rw/WATER.wav')
      expect(audio).not.toContain('/audio/rw/WANT.wav')
      // a picture on its own is its own word: no "I" is added
      audio.length = 0
      await board.locator('.symbol-grid [data-symbol="WANT"]').click()
      await board.getByRole('button', { name: 'Erekana ubutumwa', exact: true }).click()
      await expect(shown.locator('.display-sentence')).toHaveText('Gushaka.')
      await shown.getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
      await speakAndWait()
      expect(audio).toContain('/audio/rw/WANT.wav')
      expect(audio.filter(path => path.includes('/forms/'))).toEqual([])
    } finally { page.off('request', listen) }
  })

  await check('With “Vuga interuro yuzuye” off, the same pictures are spoken word by word again', async () => {
    const audio = []
    const listen = request => { const path = new URL(request.url()).pathname; if (path.startsWith('/audio/')) audio.push(path) }
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Vuga interuro yuzuye', false)
    await back()
    page.on('request', listen)
    try {
      for (const key of ['I', 'WANT', 'WATER']) await board.locator(`.symbol-grid [data-symbol="${key}"]`).click()
      await speakAndWait()
      expect(audio).toEqual(expect.arrayContaining(['/audio/rw/I.wav', '/audio/rw/WANT.wav', '/audio/rw/WATER.wav']))
      expect(audio.filter(path => path.startsWith('/audio/rw/forms/'))).toEqual([])
    } finally { page.off('request', listen) }
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Vuga interuro yuzuye', true)
    await back()
  })

  const navigations = data => data.tap_events.filter(e => e.action_type === 'navigate').length
  const note = text => expect(page.locator('.dash-save-note')).toContainText(text)
  await check('With next words on, “kunywa” opens drinks (cup, juice, milk) in the grid; one choice returns to the same page without navigation taps', async () => {
    await caregiver()
    await tab('Amagambo akurikira')
    await page.getByRole('switch', { name: 'Erekana amashusho akurikira', exact: true }).click()
    await note('Amashusho akurikira arafunguye')
    await screenshot('caregiver-next-words')
    await back()
    await category('Ingenzi')
    const before = await stored()
    await board.locator('.symbol-grid [data-symbol="DRINK"]').click()
    await expect(board.locator('.related-tab')).toBeVisible()
    expect(await tiles().evaluateAll(cells => cells.map(cell => cell.dataset.symbol))).toEqual(expect.arrayContaining(['CUP', 'JUICE', 'MILK', 'WATER']))
    await screenshot('board-next-words-drink')
    await board.locator('.symbol-grid [data-symbol="JUICE"]').click()
    await expect(board.locator('.related-tab')).toHaveCount(0)
    await expect(board.locator('.symbol-grid [data-symbol="DRINK"]')).toBeVisible()
    await expect(chips()).toHaveCount(2)
    const after = await stored()
    expect(navigations(after)).toBe(navigations(before))
    expect(after.tap_events.find(e => e.symbol_key === 'JUICE' && !before.tap_events.some(old => old.event_id === e.event_id))?.context).toBe('related:DRINK')
    await board.getByRole('button', { name: 'Erekana ubutumwa', exact: true }).click()
    const shown = page.getByRole('dialog', { name: 'Ubutumwa bwanjye' })
    await expect(shown.locator('.display-sentence')).toHaveText('Kunywa umutobe.')
    await shown.getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
    await speakAndWait()
    await board.locator('.symbol-grid [data-symbol="DRINK"]').click()
    await board.getByRole('button', { name: 'Funga amagambo akurikira kunywa', exact: true }).click()
    await expect(board.locator('.related-tab')).toHaveCount(0)
    await expect.poll(async () => (await stored()).tap_events.some(e => e.action_type === 'navigate' && e.context === 'back')).toBe(true)
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
  })

  await check('A caregiver changes the pictures after “kunywa” for this child and can restore the starting list', async () => {
    await caregiver()
    await tab('Amagambo akurikira')
    await page.getByRole('button', { name: 'Kuraho amata', exact: true }).click()
    await note('yabitswe')
    await back()
    await board.locator('.symbol-grid [data-symbol="DRINK"]').click()
    await expect(board.locator('.symbol-grid [data-symbol="CUP"]')).toBeVisible()
    await expect(board.locator('.symbol-grid [data-symbol="MILK"]')).toHaveCount(0)
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
    await expect(board.locator('.related-tab')).toHaveCount(0)
    await caregiver()
    await tab('Amagambo akurikira')
    await page.getByRole('button', { name: 'Garura uko byari bimeze', exact: true }).click()
    await note('yasubiye uko yari ameze')
    await page.getByRole('switch', { name: 'Erekana amashusho akurikira', exact: true }).click()
    await note('Amashusho akurikira arafunze')
    await back()
    await board.locator('.symbol-grid [data-symbol="DRINK"]').click()
    await expect(board.locator('.related-tab')).toHaveCount(0)
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
  })

  await check('A chosen place puts its words first on the board, core words after them, and opens on its first page', async () => {
    const first = count => tiles().evaluateAll((cells, n) => cells.slice(0, n).map(cell => cell.dataset.symbol), count)
    const choosePlace = async (name, done) => {
      await caregiver()
      await tab('Aho umwana ari')
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
      await note(done)
    }
    await category('Amashusho yose')
    await choosePlace('Igihe cyo kurya', 'aza mbere ku kibaho')
    await screenshot('caregiver-place')
    await back()
    await expect(board.locator('.place-status')).toHaveText('Igihe cyo kurya')
    expect(await first(4)).toEqual(['MUM', 'DAD', 'FOOD', 'WATER'])
    for (const key of ['SPOON', 'PLATE', 'I', 'WANT', 'HELP']) await expect(board.locator(`.symbol-grid [data-symbol="${key}"]`)).toBeVisible()
    await expect(board.locator('.symbol-grid [data-symbol="PEN"]')).toHaveCount(0)
    await screenshot('board-place-meal')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(board.locator('.place-status')).toBeVisible()
    expect(await first(1)).toEqual(['MUM'])
    await screenshot('board-place-meal-phone')
    await board.getByRole('button', { name: 'Urupapuro rukurikira', exact: true }).click()
    await choosePlace('Ku ishuri', 'aza mbere ku kibaho')
    await back()
    await expect(board.locator('.place-status')).toHaveText('Ku ishuri')
    expect(await first(1)).toEqual(['TEACHER'])
    await expect(board.locator('.page-controls [aria-live]')).toContainText('Urupapuro 1/')
    await page.setViewportSize({ width: 1280, height: 900 })
    await choosePlace('Ahantu hose', 'amashusho yose')
    await back()
    await expect(board.locator('.place-status')).toHaveCount(0)
    expect(await first(3)).toEqual(['I', 'WANT', 'HELP'])
    await category('Ingenzi')
  })

  await check('Each picture is said as soon as it is tapped, and a caregiver can switch that off and on', async () => {
    const audio = []
    const listen = request => { const path = new URL(request.url()).pathname; if (path.startsWith('/audio/')) audio.push(path) }
    page.on('request', listen)
    try {
      await board.locator('.symbol-grid [data-symbol="HELP"]').click()
      await expect.poll(() => audio).toContain('/audio/rw/HELP.wav')
      await expect(chips()).toHaveCount(1)
      await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
      await caregiver()
      await tab('Ikibaho')
      await expect(page.getByRole('switch', { name: 'Vuga buri shusho ikimara gukandwaho', exact: true })).toBeChecked()
      await setSwitch('Vuga buri shusho ikimara gukandwaho', false)
      await back()
      audio.length = 0
      await board.locator('.symbol-grid [data-symbol="HELP"]').click()
      await expect(chips()).toHaveCount(1)
      await page.waitForTimeout(1000)
      expect(audio).toEqual([])
    } finally { page.off('request', listen) }
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Vuga buri shusho ikimara gukandwaho', true)
    await back()
  })

  await check('With the section tabs turned off, the caregiver picks the section, or every picture in pages, and can bring the tabs back', async () => {
    await expect(board.locator('.category-bar')).toHaveCount(0)
    await category('Inyamaswa')
    await expect(board.locator('.symbol-grid [data-symbol="COW"]')).toBeVisible()
    await expect(board.locator('.symbol-grid [data-symbol="I"]')).toHaveCount(0)
    await screenshot('board-section-animals')
    await category('Amashusho yose')
    const seen = new Set(await tiles().evaluateAll(cells => cells.map(cell => cell.dataset.symbol)))
    const next = board.getByRole('button', { name: 'Urupapuro rukurikira', exact: true })
    while (await next.count() && await next.isEnabled()) {
      await next.click()
      for (const key of await tiles().evaluateAll(cells => cells.map(cell => cell.dataset.symbol))) seen.add(key)
    }
    expect(seen.size).toBe(Object.keys(labels).length)
    await category('Ingenzi')
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Ibyiciro ku kibaho cy’umwana', true)
    await expect(page.locator('.dash-section-options input').first()).toBeDisabled()
    await back()
    await board.getByRole('navigation', { name: 'Ibyiciro', exact: true }).getByRole('button', { name: 'Ibiryo', exact: true }).click()
    await expect(board.locator('.symbol-grid [data-symbol="MILK"]')).toBeVisible()
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Ibyiciro ku kibaho cy’umwana', false)
    await back()
    await expect(board.locator('.category-bar')).toHaveCount(0)
    await expect(board.locator('.symbol-grid [data-symbol="I"]')).toBeVisible()
  })

  await check('Keys show the picture with its word on top, and a caregiver can choose pictures only', async () => {
    const water = board.locator('.symbol-grid [data-symbol="WATER"]')
    await expect(water.locator('.label')).toHaveText('amazi')
    const withWord = await water.locator('.symbol-artwork').boundingBox()
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Amagambo ku mashusho', false)
    await back()
    await expect(water.locator('.label')).toHaveCount(0)
    await expect(water).toHaveAccessibleName('amazi')
    const alone = await water.locator('.symbol-artwork').boundingBox()
    expect(alone.height).toBeGreaterThan(withWord.height)
    await water.click()
    await expect(chips().locator('.symbol-artwork')).toHaveCount(1)
    await screenshot('board-pictures-only')
    await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Amagambo ku mashusho', true)
    await back()
    await expect(water.locator('.label')).toHaveText('amazi')
  })

  await check('The final-feature workflow raised no uncaught page errors', async () => {
    expect(pageErrors).toEqual([])
  })

  // Added after the 22 October run, last so that the check numbers the reports cite stay the same.
  await check('A sideways swipe turns the page without choosing a picture, a tap straight after still chooses, and a caregiver can switch swiping off', async () => {
    await caregiver()
    await tab('Ikibaho')
    await chooseGrid('3 × 3')
    await back()
    await category('Ingenzi')
    const clear = board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true })
    if (await clear.isEnabled()) await clear.click()
    const previous = board.getByRole('button', { name: 'Urupapuro rubanziriza', exact: true })
    while (await previous.isEnabled()) await previous.click()
    const indicator = board.locator('.page-controls [aria-live]')
    const total = Number((await indicator.textContent()).match(/\/(\d+)/)[1])
    expect(total).toBeGreaterThan(1)
    const turns = async () => (await stored()).tap_events.filter(e => e.action_type === 'navigate' && e.context === 'page:2').length
    const before = await turns()
    await swipe(tiles().first(), -220)
    await expect(indicator).toHaveText(`Urupapuro 2/${total}`)
    await expect.poll(turns).toBe(before + 1)
    await expect(chips()).toHaveCount(0)
    await touchTap(tiles().nth(1))
    await expect(chips()).toHaveCount(1)
    await swipe(tiles().first(), 220)
    await expect(indicator).toHaveText(`Urupapuro 1/${total}`)
    // Mostly up and down, or slower than a second: not a swipe.
    await swipe(tiles().first(), 40, -220)
    await swipe(tiles().first(), -220, 0, 160)
    await page.waitForTimeout(300)
    await expect(indicator).toHaveText(`Urupapuro 1/${total}`)
    await expect(chips()).toHaveCount(1)
    await clear.click()
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Hindura urupapuro unyuza urutoki', false)
    await back()
    await swipe(tiles().first(), -220)
    await page.waitForTimeout(300)
    await expect(indicator).toHaveText(`Urupapuro 1/${total}`)
    await caregiver()
    await tab('Ikibaho')
    await setSwitch('Hindura urupapuro unyuza urutoki', true)
    await back()
    expect(pageErrors).toEqual([])
  })
  const report = { generated_at: new Date().toISOString(), browser: `Headless ${channel}`, base_url: baseURL, total: checks.length, status: 'passed', checks, screenshots, pageErrors }
  await writeFile(`${output}/final-features-report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(`Final features: ${checks.length} checks passed`)
} catch (error) {
  await page.screenshot({ path: `${output}/final-features-failure.png` }).catch(() => {})
  await writeFile(`${output}/final-features-report.json`, JSON.stringify({ generated_at: new Date().toISOString(), status: 'failed', checks, error: error.message, pageErrors }, null, 2) + '\n')
  throw error
} finally {
  await browser.close()
}
