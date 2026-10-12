import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Production UI in a fresh browser context. Native audio playback, IndexedDB,
// model inference and service-worker caching remain real. Installed system
// voices are hidden to make file-based playback deterministic. The upload
// fixture is an explicitly synthetic tone, never a pronunciation sample.
const output = fileURLToPath(new URL('../../docs/screenshots/licensed-2026-10-10/', import.meta.url))
const baseURL = process.env.VUGA_PREVIEW_URL || 'http://127.0.0.1:4175/'
const channel = process.env.VUGA_BROWSER_CHANNEL || 'msedge'
const resultPath = `${output}/browser-report.json`
await mkdir(output, { recursive: true })
await unlink(resultPath).catch(error => { if (error.code !== 'ENOENT') throw error })
const browser = await chromium.launch({ channel, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' })
const allMediaEvents = [], requests = [], pageErrors = [], checks = [], screenshots = [], audits = []
context.on('request', request => requests.push(request.url()))
await context.exposeBinding('__recordVugaMedia', (_source, event) => allMediaEvents.push(event))
await context.addInitScript(() => {
  if ('speechSynthesis' in window) Object.defineProperty(window.speechSynthesis, 'getVoices', { configurable: true, value: () => [] })
  window.__audioEvents = []
  let sequence = 0
  const observed = new WeakSet()
  const nativePlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    if (!observed.has(this)) {
      observed.add(this)
      const id = ++sequence
      for (const type of ['playing', 'ended', 'pause', 'error']) this.addEventListener(type, () => {
        const event = { id, type, time: this.currentTime, duration: this.duration, paused: this.paused, error: this.error?.code ?? null }
        window.__audioEvents.push(event)
        window.__recordVugaMedia(event).catch(() => {})
      })
    }
    return nativePlay.apply(this, args)
  }
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', error => pageErrors.push(error.message))
const board = page.locator('.board:visible')
const tiles = () => board.locator('.symbol-grid .symbol-tile')
const tile = key => board.locator(`.symbol-grid [data-symbol="${key}"]`)
const chips = () => board.locator('.message-tray .message-chip')
const rwPlay = () => board.getByRole('button', { name: 'Vuga ubutumwa', exact: true })
const tab = name => page.getByRole('navigation', { name: 'Ibyiciro by’umurezi', exact: true }).getByRole('button', { name, exact: true }).click()
const toggle = name => page.getByRole('switch', { name, exact: true })
const profileCard = code => page.locator('.dash-profile-card').filter({ has: page.getByRole('heading', { name: code, exact: true }) })
const mediaEvents = () => page.evaluate(() => window.__audioEvents)
const endedCount = async () => (await mediaEvents()).filter(event => event.type === 'ended').length
const playingCount = async () => (await mediaEvents()).filter(event => event.type === 'playing').length
let completedMessages = 0
const vocabulary = (await readFile(fileURLToPath(new URL('../../vocab/symbols.csv', import.meta.url)), 'utf8')).trim().split(/\r?\n/).slice(1).map(row => row.split(',')[0])

async function settings() {
  await board.getByRole('button', { name: "Igenamiterere ry'umurezi", exact: true }).focus()
  await page.keyboard.press('Enter')
  const gate = page.locator('.parent-access')
  await expect(gate).toBeVisible()
  await expect(gate).toHaveAttribute('data-mode', /setup|unlock/)
  await gate.getByLabel('Umubare w’ibanga', { exact: true }).fill('629418')
  if (await gate.getAttribute('data-mode') === 'setup') {
    await gate.getByLabel('Ongera wandike umubare w’ibanga', { exact: true }).fill('629418')
    await gate.getByRole('button', { name: 'Bika kandi winjire', exact: true }).click()
  } else await gate.getByRole('button', { name: 'Injira', exact: true }).click()
  await expect(page.locator('.dash')).toBeVisible()
}
async function back() {
  await page.locator('.dash .app-header').getByRole('button', { name: 'Subira ku kibaho', exact: true }).click()
  await expect(board).toBeVisible()
}
async function clear() {
  if (await chips().count()) await board.getByRole('button', { name: 'Siba ubutumwa bwose', exact: true }).click()
  await expect(chips()).toHaveCount(0)
}
async function setToggle(name, checked) {
  const control = toggle(name)
  await expect(control).toBeEnabled()
  if (await control.isChecked() !== checked) {
    await control.click()
    if (checked) await expect(control).toBeChecked()
    else await expect(control).not.toBeChecked()
    await expect(control).toBeEnabled()
    await expect(page.locator('.dash-save-note')).toContainText('Ibyatoranyijwe byabitswe kuri iki gikoresho')
  }
}
async function createProfile(code) {
  await tab('Abana')
  await page.getByRole('button', { name: /Ongeramo umwirondoro/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Ongeramo umwirondoro', exact: true })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await dialog.getByPlaceholder('P-01', { exact: true }).fill(code)
  await dialog.getByRole('button', { name: 'Bika umwirondoro', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^Hitamo / }).first()).toBeVisible()
}
async function storage() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('vuga')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const names = ['profiles', 'settings', 'vocabulary', 'messages', 'tap_events', 'recordings']
      const transaction = database.transaction(names, 'readonly')
      const entries = await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const request = transaction.objectStore(name).getAll()
        request.onsuccess = () => resolve([name, name === 'recordings' ? request.result.map(({ key, blob }) => ({ key, size: blob.size, type: blob.type })) : request.result])
        request.onerror = () => reject(request.error)
      })))
      return Object.fromEntries(entries)
    } finally { database.close() }
  })
}
async function expectCompletions(count = completedMessages) {
  await expect.poll(async () => (await storage()).messages.filter(message => message.spoken_at).length).toBe(count)
  expect((await storage()).tap_events.filter(event => event.action_type === 'speak')).toHaveLength(count)
}
async function screenshot(name, region = null) {
  await page.evaluate(() => scrollTo(0, 0))
  await page.evaluate(() => document.fonts.ready)
  await (region ?? page).screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
  screenshots.push({ file: `${name}.png`, viewport: page.viewportSize(), capture: region ? 'region' : 'viewport' })
}
async function positions() {
  await page.evaluate(() => scrollTo(0, 0))
  return tiles().evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect()
    return { id: button.dataset.symbol, x: Math.round(bounds.x), y: Math.round(bounds.y + scrollY), width: Math.round(bounds.width) }
  }))
}
async function auditLanguage(name) {
  const content = await page.evaluate(() => {
    const attributes = [...document.querySelectorAll('[aria-label],[placeholder],[title],img[alt]')]
      .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
      .flatMap(element => ['aria-label', 'placeholder', 'title', 'alt'].map(key => element.getAttribute(key) || ''))
    return [document.body.innerText, ...attributes].join('\n')
  })
  // Guard against known former UI copy. Names/licenses such as Vuga, ARASAAC,
  // Sergio Palao and Government of Aragon are retained attribution, not UI copy.
  const obsoleteEnglish = /\b(English|Caregiver|Profiles|Vocabulary|Preferences|Choose|Search|Settings|Loading|Preview|Save recording|Delete recording|Stop recording|Test sound|Speak message|Show message|Clear message|Back to board|Participant code|Word recordings|No matching words|No enabled pictures|Create profile|Sign in|Password|Gentle motion|Extra large pictures|Illustrated symbols|Original illustrations|Local summary|Sync & export)\b/i
  expect(content.match(obsoleteEnglish), `${name} contains obsolete English UI`).toBeNull()
  expect(content).not.toMatch(/\b(?:undefined|null)\b/)
  audits.push({ screen: name, visibleCharacters: content.length, obsoleteEnglishMatches: 0 })
}
async function check(name, action) {
  const evidence = await action()
  checks.push({ name, status: 'passed', ...(evidence ? { evidence } : {}) })
  console.log(`PASS ${checks.length}: ${name}`)
}
function toneWav() {
  const rate = 16000, length = Math.round(rate * 0.65)
  const buffer = Buffer.alloc(44 + length * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(length * 2, 40)
  for (let index = 0; index < length; index++) {
    const envelope = Math.min(1, index / 400, (length - index - 1) / 400)
    buffer.writeInt16LE(Math.round(9000 * envelope * Math.sin(2 * Math.PI * 440 * index / rate)), 44 + index * 2)
  }
  return buffer
}

try {
  await check('Fresh production UI uses rw document language, local artwork and Kinyarwanda controls', async () => {
    await page.goto(baseURL)
    await expect(tile('I')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'rw')
    await expect(rwPlay()).toBeVisible()
    await expect(board.locator('.category-button')).toHaveCount(14)
    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 })
      const labels = await board.locator('.category-copy b').evaluateAll(elements => elements.map(element => {
        const range = document.createRange(); range.selectNodeContents(element)
        const text = range.getBoundingClientRect()
        const button = element.closest('button').getBoundingClientRect()
        return { text: element.textContent, lines: range.getClientRects().length, fits: text.left >= button.left && text.right <= button.right - 3 }
      }))
      for (const label of labels) {
        expect(label.fits, `${width}px: ${label.text}`).toBe(true)
        if (!label.text.includes(' ')) expect(label.lines, `${width}px: ${label.text}`).toBe(1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(tile('I').locator('img')).toHaveAttribute('src', '/photos/I.webp')
    await expect.poll(() => tile('I').locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60000 }).toBe(true)
    expect(await page.evaluate(() => speechSynthesis.getVoices().length)).toBe(0)
    expect((await storage()).settings.find(setting => setting.key === 'speech-mode')?.value).toBe('kinyarwanda')
    await auditLanguage('board')
    await screenshot('board-desktop')
    return { documentLanguage: 'rw', categories: 14, installedVoicesAvailableToTest: 0 }
  })

  await check('All 181 licensed online photos have attribution, are precached, match their manifest and decode at 480 square', async () => {
    const audit = await page.evaluate(async () => {
      const manifest = await (await fetch('/photos/manifest.json')).json()
      const cachedPaths = new Set()
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) cachedPaths.add(new URL(request.url).pathname)
      }
      if (!cachedPaths.has('/photos/credits.html')) throw new Error('Photo credits are not available offline')
      const creditsResponse = await fetch('/photos/credits.html')
      if (!creditsResponse.ok) throw new Error('Photo credits unavailable')
      const credits = new DOMParser().parseFromString(await creditsResponse.text(), 'text/html')
      if (credits.documentElement.lang !== 'rw' || credits.querySelectorAll('article').length !== 181) throw new Error('Incomplete Kinyarwanda photo credits')
      const images = []
      for (const entry of manifest.images) {
        if (entry.synthetic !== false || !entry.creator || !entry.title || !entry.source_page?.startsWith('https://') || !entry.license || !entry.license_url?.startsWith('https://')) throw new Error(`Missing online licence or attribution: ${entry.symbol_id}`)
        if (!cachedPaths.has(entry.url)) throw new Error(`Photo not precached: ${entry.symbol_id}`)
        const response = await fetch(entry.url)
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/webp')) throw new Error(`Missing photo: ${entry.symbol_id}`)
        const bytes = await response.arrayBuffer()
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
        if (sha256 !== entry.sha256) throw new Error(`Photo hash mismatch: ${entry.symbol_id}`)
        const decoded = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }))
        images.push({ id: entry.symbol_id, width: decoded.width, height: decoded.height, bytes: bytes.byteLength })
        decoded.close()
      }
      return { synthetic: manifest.synthetic, coverage: manifest.coverage, images }
    })
    expect(audit.synthetic).toBe(false)
    expect(audit.coverage.complete).toBe(true)
    expect(audit.images.map(image => image.id).sort()).toEqual([...vocabulary].sort())
    for (const image of audit.images) expect(image, image.id).toMatchObject({ width: 480, height: 480 })
    return { decodedAndHashVerified: audit.images.length, precachedBeforeFetch: audit.images.length, width: 480, height: 480, totalBytes: audit.images.reduce((sum, image) => sum + image.bytes, 0), synthetic: false, licensedOnlineSources: true }
  })

  await check('A missing photo falls back to its pictogram and remains usable in a composed message', async () => {
    const fallbackContext = await browser.newContext({ serviceWorkers: 'block' })
    const fallbackPage = await fallbackContext.newPage()
    const errors = []
    fallbackPage.on('pageerror', error => errors.push(error.message))
    try {
      await fallbackContext.route('**/photos/WATER.webp', route => route.fulfill({ status: 404, body: '' }))
      await fallbackPage.goto(baseURL)
      const water = fallbackPage.locator('.symbol-grid [data-symbol="WATER"]')
      await expect(water.locator('img')).toHaveAttribute('src', '/symbols/WATER.png')
      await expect.poll(() => water.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
      await expect(water).toHaveAccessibleName('amazi')
      await water.click()
      await expect(fallbackPage.locator('.message-chip img')).toHaveAttribute('src', '/symbols/WATER.png')
      await fallbackPage.getByRole('button', { name: 'Erekana ubutumwa', exact: true }).click()
      await expect(fallbackPage.locator('.message-dialog[open] .display-chip')).toContainText('amazi')
      await expect(fallbackPage.locator('.message-dialog[open] .display-chip img')).toHaveAttribute('src', '/symbols/WATER.png')
      expect(errors).toEqual([])
      return { failedPhoto: 'WATER', fallback: '/symbols/WATER.png', wordSelectable: true, fullMessageDisplay: true, pageErrors: errors }
    } finally { await fallbackContext.close() }
  })

  await check('A saved legacy English demo preference migrates to persistent Kinyarwanda', async () => {
    await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('vuga')
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('settings', 'readwrite')
          transaction.objectStore('settings').put({ key: 'speech-mode', value: 'english-demo' })
          transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error)
        })
      } finally { database.close() }
    })
    await page.reload()
    await expect(tile('I')).toBeVisible()
    expect((await storage()).settings.find(setting => setting.key === 'speech-mode')?.value).toBe('kinyarwanda')
    await expect(rwPlay()).toBeVisible()
    return { previousMode: 'english-demo', migratedMode: 'kinyarwanda' }
  })

  await check('Profile dialog uses Kinyarwanda validation and creates a local profile with 181 choices', async () => {
    await settings()
    await page.getByRole('button', { name: /Ongeramo umwirondoro/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Ongeramo umwirondoro', exact: true })
    const code = dialog.getByPlaceholder('P-01', { exact: true })
    await expect(code).toBeFocused()
    await dialog.getByRole('button', { name: 'Bika umwirondoro', exact: true }).click()
    expect(await code.evaluate(input => input.validationMessage)).toContain('Andika inyuguti imwe')
    await code.fill('P-01')
    await auditLanguage('profile dialog')
    await screenshot('profile-dialog')
    await dialog.getByRole('button', { name: 'Bika umwirondoro', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('checkbox', { name: /^Hitamo / })).toHaveCount(181)
    expect((await storage()).profiles.some(profile => profile.code === 'P-01' && profile.local_only)).toBe(true)
    return { localProfile: 'P-01', vocabularyChoices: 181, nativeValidationLanguage: 'rw' }
  })

  await check('Intentionally empty vocabulary survives reload and all 181 choices can be restored', async () => {
    await page.getByRole('button', { name: 'Kuraho yose', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /^Hitamo / }).first()).not.toBeChecked()
    await back()
    await expect(tiles()).toHaveCount(0)
    await expect(board.getByText(/Nta mashusho yatoranyijwe/)).toBeVisible()
    await page.reload()
    await expect(board.getByText(/Nta mashusho yatoranyijwe/)).toBeVisible()
    expect((await storage()).settings.find(setting => setting.key === 'profile').value.code).toBe('P-01')
    await settings(); await tab('Amashusho')
    await page.getByRole('button', { name: 'Hitamo yose', exact: true }).click()
    await expect.poll(() => page.getByRole('checkbox', { name: /^Hitamo / }).evaluateAll(inputs => inputs.filter(input => input.checked).length)).toBe(181)
    await back()
    await expect(tile('I')).toBeVisible()
    return { afterEmptyReload: 0, restoredChoices: 181 }
  })

  await check('Appearance settings affect the real board, persist and remain separate for each profile', async () => {
    const initialHeight = (await tile('I').boundingBox()).height
    await settings(); await tab('Ikibaho')
    await setToggle('Amashusho anyeganyega buhoro', false)
    await setToggle('Amashusho manini cyane', true)
    await back()
    expect((await tile('I').boundingBox()).height).toBeGreaterThan(initialHeight + 15)
    await settings(); await tab('Ikibaho')
    await setToggle('Amafoto afatika', false)
    await back()
    await expect(board).toHaveClass(/no-motion/)
    await expect(board).toHaveClass(/large-tiles/)
    await expect(tile('I').locator('img')).toHaveAttribute('src', '/symbols/I.png')
    await tile('I').click()
    expect(await chips().first().evaluate(chip => getComputedStyle(chip).animationName)).toBe('none')
    await page.reload()
    await expect(board).toHaveClass(/no-motion/)
    await expect(board).toHaveClass(/large-tiles/)
    await expect(tile('I').locator('img')).toHaveAttribute('src', '/symbols/I.png')
    await settings(); await createProfile('P-02'); await tab('Ikibaho')
    await expect(toggle('Amashusho anyeganyega buhoro')).toBeChecked()
    await expect(toggle('Amashusho manini cyane')).not.toBeChecked()
    await expect(toggle('Amafoto afatika')).toBeChecked()
    await tab('Abana'); await profileCard('P-01').click(); await tab('Ikibaho')
    await expect(toggle('Amashusho anyeganyega buhoro')).not.toBeChecked()
    await expect(toggle('Amashusho manini cyane')).toBeChecked()
    await expect(toggle('Amafoto afatika')).not.toBeChecked()
    await setToggle('Amashusho anyeganyega buhoro', true)
    await setToggle('Amashusho manini cyane', false)
    await setToggle('Amafoto afatika', true)
    await back()
    return { profiles: ['P-01', 'P-02'], persistedAndIsolatedSettings: ['motion', 'largeTiles', 'realisticImages'] }
  })

  await check('Real predictions provide three allowed suggestions without moving the main grid', async () => {
    const staticPositions = await positions()
    await settings(); await tab('Ikibaho'); await setToggle('Amagambo afasha', true); await back()
    await expect(board.locator('.suggestion-tile')).toHaveCount(3)
    expect(await positions()).toEqual(staticPositions)
    const predictions = await board.locator('.suggestion-tile').evaluateAll(buttons => buttons.map(button => button.dataset.symbol))
    const data = await storage()
    const activeId = data.settings.find(setting => setting.key === 'profile').value.profile_id
    const allowed = new Set(data.vocabulary.filter(row => row.profile_id === activeId).map(row => row.key))
    expect(predictions.every(key => allowed.has(key))).toBe(true)
    return { actualPredictions: predictions, gridPositionChanges: 0 }
  })

  await check('Five rapid taps remain ordered in one draft and Clear adds exactly one correction', async () => {
    await tile('I').evaluate(button => { for (let count = 0; count < 5; count++) button.click() })
    await expect(chips()).toHaveCount(5)
    let draftId
    await expect.poll(async () => {
      const data = await storage()
      draftId = data.messages.filter(message => message.board_mode === 'predictive').at(-1)?.message_id
      return data.tap_events.filter(event => event.message_id === draftId).length
    }).toBe(5)
    const events = (await storage()).tap_events.filter(event => event.message_id === draftId).sort((a, b) => a.action_index - b.action_index)
    expect(events.map(event => event.action_index)).toEqual([0, 1, 2, 3, 4])
    expect(events.map(event => event.symbol_key)).toEqual(['I', 'I', 'I', 'I', 'I'])
    await clear()
    await expect.poll(async () => (await storage()).tap_events.filter(event => event.message_id === draftId).length).toBe(6)
    expect((await storage()).tap_events.find(event => event.message_id === draftId && event.action_index === 5)).toMatchObject({ action_type: 'correct', context: 'clear' })
    return { orderedSelectEvents: 5, clearEvents: 1 }
  })

  await check('Literal Kinyarwanda composition survives caregiver visits and all main tabs use localized copy', async () => {
    const initialPositions = await positions()
    for (const key of ['I', 'WANT', 'WATER']) await tile(key).click()
    await expect(chips()).toHaveCount(3)
    expect(await chips().locator(':scope > span:last-child').allTextContents()).toEqual(['njye', 'gushaka', 'amazi'])
    expect(await positions()).toEqual(initialPositions)
    await settings()
    for (const [name, file] of [['Abana', 'caregiver-profiles'], ['Amashusho', 'caregiver-vocabulary'], ['Ikibaho', 'caregiver-preferences'], ['Incamake', null], ['Ohereza', null]]) {
      await tab(name)
      await auditLanguage(name)
      if (file) await screenshot(file)
    }
    await back()
    await expect(chips()).toHaveCount(3)
    expect(await chips().locator(':scope > span:last-child').allTextContents()).toEqual(['njye', 'gushaka', 'amazi'])
    return { literalWords: ['njye', 'gushaka', 'amazi'], gridPositionChanges: 0, retainedDuringCaregiverVisit: 3 }
  })

  await check('Show dialog is localized, keeps background controls inert and restores keyboard focus without completing speech', async () => {
    const trigger = board.getByRole('button', { name: 'Erekana ubutumwa', exact: true })
    await trigger.focus(); await page.keyboard.press('Enter')
    const dialog = page.locator('.message-dialog[open]')
    await expect(dialog.locator('.display-chip')).toHaveCount(3)
    await auditLanguage('show dialog')
    await screenshot('message-display')
    let chromeVisits = 0
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press('Tab')
      const focus = await dialog.evaluate(element => ({ inside: element.contains(document.activeElement), documentFocused: document.hasFocus(), activeTag: document.activeElement.tagName, modal: element.matches(':modal') }))
      expect(focus.modal).toBe(true)
      if (!focus.inside) { expect(focus).toMatchObject({ documentFocused: false, activeTag: 'BODY' }); chromeVisits++ }
    }
    if (!await dialog.evaluate(element => element.contains(document.activeElement))) await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await expectCompletions()
    return { tabSteps: 6, browserChromeVisits: chromeVisits, backgroundControlsFocused: 0, successfulSpeechEvents: completedMessages }
  })

  await check('Every one of the 181 bundled Kinyarwanda clips decodes to non-silent audio', async () => {
    const decoded = await page.evaluate(async keys => {
      const audio = new AudioContext()
      try {
        const results = []
        for (const key of keys) {
          const response = await fetch(`/audio/rw/${key}.wav`)
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error(`Missing Kinyarwanda clip ${key}: ${response.status}`)
          const data = await audio.decodeAudioData(await response.arrayBuffer())
          let peak = 0, sum = 0
          const samples = data.getChannelData(0)
          for (const value of samples) { peak = Math.max(peak, Math.abs(value)); sum += value * value }
          results.push({ key, duration: data.duration, sampleRate: data.sampleRate, samples: samples.length, peak, rms: Math.sqrt(sum / samples.length) })
        }
        return results
      } finally { await audio.close() }
    }, vocabulary)
    expect(decoded).toHaveLength(181)
    for (const clip of decoded) {
      expect(clip.duration, clip.key).toBeGreaterThan(0.1)
      expect(clip.peak, clip.key).toBeGreaterThan(0.02)
      expect(clip.rms, clip.key).toBeGreaterThan(0.001)
    }
    return { decodedClips: decoded.length, minimumDuration: Math.min(...decoded.map(clip => clip.duration)), maximumDuration: Math.max(...decoded.map(clip => clip.duration)), minimumRms: Math.min(...decoded.map(clip => clip.rms)), sampleClips: decoded.filter(clip => ['I', 'WANT', 'WATER'].includes(clip.key)), pronunciationReview: false }
  })

  await check('Three Kinyarwanda clips finish through native media playback before exactly one Speak completion', async () => {
    const baseline = await endedCount()
    await rwPlay().click()
    await expect.poll(endedCount, { timeout: 30000 }).toBe(baseline + 3)
    await expect(chips()).toHaveCount(0)
    await expectCompletions(++completedMessages)
    const data = await storage()
    const completed = data.messages.find(message => message.spoken_at)
    const events = data.tap_events.filter(event => event.message_id === completed.message_id).sort((a, b) => a.action_index - b.action_index)
    expect(events.filter(event => event.action_type === 'speak')).toHaveLength(1)
    expect(events.filter(event => event.action_type === 'select').slice(-3).map(event => event.symbol_key)).toEqual(['I', 'WANT', 'WATER'])
    return { nativeMediaEnds: 3, totalCompletedMessages: completedMessages, finalWords: ['njye', 'gushaka', 'amazi'] }
  })

  await check('Stop interrupts native audio, retains all selected symbols and adds no successful Speak event', async () => {
    await tile('I').evaluate(button => { for (let count = 0; count < 12; count++) button.click() })
    const baseline = await playingCount()
    await rwPlay().click()
    await expect.poll(playingCount).toBeGreaterThan(baseline)
    await board.getByRole('button', { name: 'Hagarika ijwi', exact: true }).click()
    await expect(rwPlay()).toBeEnabled()
    await expect(chips()).toHaveCount(12)
    await expectCompletions()
    const events = await mediaEvents()
    const stoppedId = events.filter(event => event.type === 'playing').at(-1).id
    await expect.poll(async () => (await mediaEvents()).some(event => event.id === stoppedId && event.type === 'pause' && event.time < event.duration)).toBe(true)
    await auditLanguage('stopped speech notice')
    await clear()
    return { retainedSymbols: 12, totalCompletedMessages: completedMessages, cancelledPartPausedBeforeEnd: true }
  })

  await check('Caregiver tests the Kinyarwanda word and a separate speaker tone without any language selector or completion', async () => {
    await settings(); await tab('Ijwi')
    await expect(page.locator('.voice-settings select')).toHaveCount(0)
    await expect(page.locator('audio[controls]')).toHaveCount(0)
    const baseline = await endedCount()
    await page.getByRole('button', { name: 'Umva “amazi”', exact: true }).click()
    await expect.poll(endedCount).toBe(baseline + 1)
    await expect(page.locator('.voice-test-status')).toContainText('Ijambo “amazi” rirangiye')
    await page.getByRole('button', { name: 'Gerageza indangururamajwi', exact: true }).click()
    await expect.poll(endedCount).toBe(baseline + 2)
    await expectCompletions()
    await auditLanguage('voice and recording settings')
    await screenshot('caregiver-voice')
    return { nativeMediaEnds: 2, languageSelectors: 0, totalCompletedMessages: completedMessages }
  })

  await check('Silent and corrupt uploads receive Kinyarwanda errors without saving a recording', async () => {
    await page.getByRole('searchbox', { name: 'Shaka ijambo', exact: true }).fill('njye')
    await page.getByRole('group', { name: 'Amagambo yo gufatira amajwi', exact: true }).getByRole('button').filter({ hasText: 'njye' }).click()
    await expect(page.locator('.audio-selected h2')).toHaveText('njye')
    const input = page.locator('.audio-settings input[type="file"]')
    const silent = toneWav(); silent.fill(0, 44)
    await input.setInputFiles({ name: 'ijwi-ridafite-amajwi.wav', mimeType: 'audio/wav', buffer: silent })
    await expect(page.locator('.audio-error')).toContainText('Nta jwi ryumvikana')
    await expect(page.getByRole('button', { name: 'Bika ijwi', exact: true })).toHaveCount(0)
    await auditLanguage('silent upload error')
    await input.setInputFiles({ name: 'dosiye-itujuje.wav', mimeType: 'audio/wav', buffer: Buffer.from('Nta jwi ririmo.') })
    await expect(page.locator('.audio-error')).toContainText('ntifunguka')
    await auditLanguage('corrupt upload error')
    expect((await storage()).recordings).toHaveLength(0)
    return { rejectedUploads: ['silent WAV', 'corrupt WAV'], savedRecordings: 0, errorLanguage: 'rw' }
  })

  await check('Valid synthetic upload previews and saves through custom Kinyarwanda audio controls', async () => {
    await page.locator('.audio-settings input[type="file"]').setInputFiles({ name: 'ijwi-ry-igerageza.wav', mimeType: 'audio/wav', buffer: toneWav() })
    const preview = page.getByRole('group', { name: 'Ijwi rishya rya njye', exact: true })
    const baseline = await endedCount()
    await preview.getByRole('button', { name: 'Umva: Ijwi rishya rya njye', exact: true }).click()
    await expect.poll(endedCount).toBe(baseline + 1)
    await page.getByRole('button', { name: 'Bika ijwi', exact: true }).click()
    await expect.poll(async () => (await storage()).recordings.find(row => row.key === 'I')?.size ?? 0).toBe(toneWav().length)
    const saved = page.getByRole('group', { name: 'Ijwi ryabitswe rya njye', exact: true })
    await saved.getByRole('button', { name: 'Umva: Ijwi ryabitswe rya njye', exact: true }).click()
    await expect.poll(endedCount).toBe(baseline + 2)
    await expect(page.locator('audio[controls]')).toHaveCount(0)
    await expectCompletions()
    await auditLanguage('saved recording')
    await screenshot('saved-recording', page.locator('.audio-settings'))
    return { fixture: 'Generated 0.65 s 440 Hz PCM tone, not Kinyarwanda speech.', storedBytes: toneWav().length, actualMediaEnds: 2, nativeEnglishAudioControls: 0 }
  })

  await check('Saved word recording overrides the bundled clip and finalizes one message after playback', async () => {
    await back(); await tile('I').click()
    const baseline = await endedCount(), requestsBefore = requests.length
    await rwPlay().click()
    await expect.poll(endedCount).toBe(baseline + 1)
    await expect(chips()).toHaveCount(0)
    await expectCompletions(++completedMessages)
    const ended = (await mediaEvents()).filter(event => event.type === 'ended').at(-1)
    expect(ended.duration).toBeCloseTo(0.65, 2)
    expect(requests.slice(requestsBefore).some(url => new URL(url).pathname === '/audio/rw/I.wav')).toBe(false)
    return { savedOverrideDuration: ended.duration, bundledIRequestsDuringOverride: 0, totalCompletedMessages: completedMessages }
  })

  await check('Summary, export and account validation remain localized and export real local data only', async () => {
    await settings(); await tab('Incamake')
    await expect(page.locator('.dash-main table tbody tr')).toHaveCount(1)
    await expect(page.locator('.dash-main table tbody tr').first()).toContainText('Amagambo afasha')
    await auditLanguage('completed message summary')
    await tab('Ohereza')
    await expect(page.getByRole('button', { name: 'Ohereza ubu', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Injira', exact: true }).click()
    expect(await page.getByRole('textbox', { name: 'Telefoni', exact: true }).evaluate(input => input.validationMessage)).toBe('Andika nimero ya telefoni yawe.')
    await page.getByRole('button', { name: 'Fungura konti y’umuntu mukuru', exact: true }).click()
    await auditLanguage('account registration')
    await page.getByRole('button', { name: 'Mfite konti', exact: true }).click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Kuramo ubutumwa bwo kuri iki gikoresho', exact: true }).click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/^vuga-ubutumwa-\d{4}-\d{2}-\d{2}\.json$/)
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
    const data = await storage()
    expect(exported.format).toBe('vuga-local-export-v1')
    expect(exported.profiles.map(profile => profile.code).sort()).toEqual(['P-01', 'P-02'])
    expect(exported.messages).toHaveLength(data.messages.length)
    expect(exported.messages.flatMap(message => message.events)).toHaveLength(data.tap_events.length)
    expect(exported.messages.filter(message => message.spoken_at)).toHaveLength(completedMessages)
    const privateFields = new Set(['password', 'token', 'access_token', 'refresh_token', 'recordings', 'auth'])
    const hasPrivate = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => privateFields.has(key) || hasPrivate(child))
    expect(Boolean(hasPrivate(exported))).toBe(false)
    await back()
    return { exportedProfiles: 2, exportedMessages: exported.messages.length, completedMessages, recordingOrAuthDataExported: false }
  })

  await check('Phone board retains two readable columns, large touch controls and a wrapping long-message dialog', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await board.locator('.symbol-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(2)
    expect(await tile('I').locator('.label').evaluate(label => parseFloat(getComputedStyle(label).fontSize))).toBeGreaterThanOrEqual(18)
    const sizes = await board.locator('.edit-button,.show-button,.speak-button,.caregiver-button').evaluateAll(buttons => buttons.map(button => ({ label: button.getAttribute('aria-label'), height: button.getBoundingClientRect().height })))
    expect(sizes.every(control => control.height >= 48)).toBe(true)
    await tile('WATER').evaluate(button => { for (let count = 0; count < 12; count++) button.click() })
    await board.getByRole('button', { name: 'Erekana ubutumwa', exact: true }).click()
    const dialog = page.locator('.message-dialog[open]')
    await expect(dialog.locator('.display-chip')).toHaveCount(12)
    expect(await dialog.locator('.display-message').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.keyboard.press('Escape'); await clear()
    return { viewport: '390×844', columns: 2, messageSymbols: 12, controls: sizes }
  })

  await check('Operating-system reduced motion disables chip animation even when gentle motion is enabled', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await tile('WATER').click()
    const animation = await chips().first().evaluate(chip => ({ name: getComputedStyle(chip).animationName, duration: getComputedStyle(chip).animationDuration }))
    expect(animation.name === 'none' || parseFloat(animation.duration) <= 0.00001).toBe(true)
    await clear(); await page.emulateMedia({ reducedMotion: 'no-preference' })
    return animation
  })

  await check('Offline reload preserves the profile, predictions, all realistic images and bundled Kinyarwanda playback', async () => {
    await context.setOffline(true)
    await page.reload()
    await expect(tile('I')).toBeVisible()
    await expect(board.locator('.suggestion-tile')).toHaveCount(3)
    expect(await page.evaluate(() => navigator.onLine)).toBe(false)
    expect((await storage()).settings.find(setting => setting.key === 'profile').value.code).toBe('P-01')
    await expect.poll(() => board.locator('.symbol-artwork--photo img').evaluateAll(images => images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    const offlinePhotoCount = await page.evaluate(async ids => {
      for (const id of ids) {
        const response = await fetch(`/photos/${id}.webp`)
        if (!response.ok) throw new Error(`Offline photo unavailable: ${id}`)
        const image = await createImageBitmap(await response.blob())
        if (image.width !== 480 || image.height !== 480) throw new Error(`Offline photo size: ${id}`)
        image.close()
      }
      return ids.length
    }, vocabulary)
    expect(offlinePhotoCount).toBe(181)
    for (const key of ['WANT', 'WATER']) await tile(key).click()
    await screenshot('board-mobile-offline')
    await rwPlay().click()
    await expect.poll(endedCount, { timeout: 30000 }).toBe(2)
    await expect(chips()).toHaveCount(0)
    await expectCompletions(++completedMessages)
    return { online: false, decodedOfflinePhotos: offlinePhotoCount, actualBundledMediaEnds: 2, totalCompletedMessages: completedMessages }
  })

  await check('Saved recording still overrides speech offline and deletion restores the bundled Kinyarwanda clip', async () => {
    expect((await storage()).recordings.find(row => row.key === 'I').size).toBe(toneWav().length)
    await tile('I').click()
    const baseline = await endedCount()
    await rwPlay().click()
    await expect.poll(endedCount).toBe(baseline + 1)
    expect((await mediaEvents()).filter(event => event.type === 'ended').at(-1).duration).toBeCloseTo(0.65, 2)
    await expectCompletions(++completedMessages)
    await settings(); await tab('Ijwi')
    await page.getByRole('searchbox', { name: 'Shaka ijambo', exact: true }).fill('njye')
    await page.getByRole('group', { name: 'Amagambo yo gufatira amajwi', exact: true }).getByRole('button').filter({ hasText: 'njye' }).click()
    await page.getByRole('button', { name: 'Siba ijwi ryabitswe', exact: true }).click()
    await auditLanguage('delete recording confirmation')
    await page.getByRole('button', { name: 'Gumana ijwi', exact: true }).click()
    expect((await storage()).recordings).toHaveLength(1)
    await page.getByRole('button', { name: 'Siba ijwi ryabitswe', exact: true }).click()
    await page.getByRole('button', { name: 'Siba ijwi', exact: true }).click()
    await expect.poll(async () => (await storage()).recordings.length).toBe(0)
    await back(); await tile('I').click()
    const beforeBundle = await endedCount()
    await rwPlay().click()
    await expect.poll(endedCount).toBe(beforeBundle + 1)
    await expectCompletions(++completedMessages)
    return { savedOverrideOffline: true, recordingsAfterDeletion: 0, bundledPlaybackAfterDeletion: true, totalCompletedMessages: completedMessages }
  })

  await check('A missing offline clip produces a Kinyarwanda notice, retains the draft and permits visual communication', async () => {
    // Deliberately remove only WATER from this isolated test context's cache to
    // exercise the genuinely missing asset branch without mocking playback.
    const removed = await page.evaluate(async () => {
      let count = 0
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) if (new URL(request.url).pathname === '/audio/rw/WATER.wav') {
          if (await cache.delete(request)) count++
        }
      }
      return count
    })
    expect(removed).toBeGreaterThan(0)
    await tile('WATER').click()
    const baseline = await playingCount()
    await rwPlay().click()
    const notice = page.locator('.audio-dialog[open]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('amazi')
    await expect(chips()).toHaveCount(1)
    await auditLanguage('missing audio notice')
    await screenshot('missing-audio')
    expect(await playingCount()).toBe(baseline)
    await expectCompletions()
    await notice.getByRole('button', { name: 'Erekana', exact: true }).click()
    await expect(page.locator('.message-dialog[open] .display-chip')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await clear()
    return { deliberatelyRemovedCachedEntries: removed, retainedSymbols: 1, unexpectedPlaybackStarts: 0, totalCompletedMessages: completedMessages }
  })

  await check('No English audio is requested or cached, and the complete workflow has no uncaught or native media errors', async () => {
    const cacheURLs = await page.evaluate(async () => {
      const urls = []
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
      return urls
    })
    expect(requests.filter(url => /\/audio\/en(?:-demo)?\//.test(url))).toEqual([])
    expect(cacheURLs.filter(url => /\/audio\/en(?:-demo)?\//.test(url))).toEqual([])
    const rwFiles = new Set(cacheURLs.filter(url => /\/audio\/rw\/[^/]+\.wav/.test(url)).map(url => new URL(url).pathname))
    // WATER was deliberately removed by the preceding missing-asset check.
    expect(rwFiles.size).toBe(180)
    expect(pageErrors).toEqual([])
    expect(allMediaEvents.filter(event => event.type === 'error')).toEqual([])
    expect(screenshots).toHaveLength(10)
    await auditLanguage('offline board')
    return { requestedEnglishAudio: 0, cachedEnglishAudio: 0, remainingKinyarwandaCachedClips: rwFiles.size, deliberatelyRemovedClips: 1, pageErrors, nativeMediaErrors: 0, actualMediaEndsAcrossReloads: allMediaEvents.filter(event => event.type === 'ended').length, auditedViews: audits.length }
  })

  await writeFile(resultPath, JSON.stringify({
    status: 'passed', checked_at: new Date().toISOString(), passed_checks: checks.length,
    browser: `Headless ${channel}`, base_url: baseURL,
    data: 'Isolated synthetic P-01 and P-02 profiles and generated tone upload; no participant data, microphone permission request or existing user browser data.',
    observation: 'Original HTMLMediaElement.play executes unchanged; native playing/ended/pause/error events are observed. All 181 bundled WAV files are decoded and checked for nonzero samples. Installed system voices are hidden. One cached WATER file is deliberately deleted offline to exercise missing-file handling.',
    checks, screenshots, language_audits: audits, page_errors: pageErrors,
    limitations: ['Automated playback events do not establish physical speaker audibility.', 'Bundled synthetic Kinyarwanda pronunciation and translation still require native-speaker and intended-user review.', 'Generated upload tone validates recording transport and storage, not speech pronunciation.', 'Known prior English UI phrases are audited; this is not a comprehensive linguistic quality assessment.', 'No participant, target-tablet, microphone capture or screen-reader usability validation was performed.']
  }, null, 2) + '\n')
  console.log(`Passed ${checks.length} Kinyarwanda browser checks; ${screenshots.length} screenshots and report: ${resultPath}`)
} finally {
  await context.close()
  await browser.close()
}
