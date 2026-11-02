import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Renders docs/report/report.html to the submitted PDF with headless Edge and reports the page
// count, which the brief limits to five:
//   node app/scripts/render-report.mjs
const source = fileURLToPath(new URL('../../docs/report/report.html', import.meta.url))
const target = fileURLToPath(new URL('../../docs/report/Vuga_Final_Technical_Report.pdf', import.meta.url))
const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' })
  await page.pdf({
    path: target, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    // Black 12 pt, like the rest of the report.
    footerTemplate: '<div style="width:100%;font:12pt Calibri,Arial,sans-serif;color:#000;text-align:center">Vuga · final technical report · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
  })
} finally {
  await browser.close()
}
const pages = ((await readFile(target, 'latin1')).match(/\/Type\s*\/Page[^s]/g) ?? []).length
console.log(`${target}: ${pages} pages`)
if (pages > 5) process.exitCode = 1
