import { chromium } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Local contact sheets for visual review; no source image is changed.
const repository = fileURLToPath(new URL('../../', import.meta.url))
const photos = `${repository}/app/public/photos`
const output = `${repository}/docs/screenshots/licensed-2026-10-10/catalog`
const manifest = JSON.parse(await readFile(`${photos}/manifest.json`, 'utf8'))
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 1280 }, deviceScaleFactor: 1 })
const pages = []
try {
  for (let start = 0; start < manifest.images.length; start += 25) {
    const entries = manifest.images.slice(start, start + 25)
    const cards = await Promise.all(entries.map(async entry => {
      const encoded = (await readFile(`${photos}/${entry.symbol_id}.webp`)).toString('base64')
      return `<figure><img src="data:image/webp;base64,${encoded}"><figcaption><b>${escape(entry.label_rw)}</b><small>${escape(entry.symbol_id)}</small></figcaption></figure>`
    }))
    await page.setContent(`<!doctype html><html lang="rw"><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f7f5ec;color:#173d37;font:16px Arial,sans-serif}h1{font-size:20px;margin:0 0 16px}main{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}figure{margin:0;padding:8px;background:white;border:1px solid #d9ddd1;border-radius:12px}img{display:block;width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px}figcaption{text-align:center;padding:7px 0 2px}b{display:block;font-size:16px}small{display:block;margin-top:4px;color:#556b63;font-size:11px}</style><h1>Vuga · Amafoto ${start + 1}–${start + entries.length}</h1><main>${cards.join('')}</main></html>`)
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
    const filename = `pictures-${String(pages.length + 1).padStart(2, '0')}.png`
    await page.screenshot({ path: `${output}/${filename}`, fullPage: true })
    pages.push({ file: filename, symbol_ids: entries.map(entry => entry.symbol_id) })
  }
} finally { await browser.close() }
await writeFile(`${output}/index.json`, JSON.stringify({ generated_at: new Date().toISOString(), count: manifest.images.length, pages }, null, 2) + '\n')
console.log(JSON.stringify({ count: manifest.images.length, pages: pages.length, output }))
