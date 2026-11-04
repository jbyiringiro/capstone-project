import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Renders docs/report/report.md to the submitted PDF with headless Edge and reports the page
// count, which the brief limits to five:
//   node app/scripts/render-report.mjs
const source = fileURLToPath(new URL('../../docs/report/report.md', import.meta.url))
const target = fileURLToPath(new URL('../../docs/report/Vuga_Final_Technical_Report.pdf', import.meta.url))

// Every word of the report is black and 12 pt: body, tables, headings, notes and the footer.
const style = `
  @page { size: A4; margin: 14mm 15mm 17mm 15mm; }
  body { margin: 0; color: #000; background: #fff; font: 12pt/1.22 Calibri, Carlito, Arial, sans-serif; }
  h1, h2 { font-size: 12pt; font-weight: 700; margin: 9pt 0 3pt; }
  h1 { margin-top: 0; }
  p { margin: 0 0 5pt; }
  ul { margin: 0 0 5pt; padding-left: 15pt; }
  li { margin: 0 0 2pt; }
  a { color: #000; text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; margin: 3pt 0 6pt; font-size: 12pt; line-height: 1.15; }
  th, td { border: 0.75pt solid #000; padding: 1.5pt 3.5pt; vertical-align: top; text-align: left; }
  th { font-weight: 700; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .keep { break-inside: avoid; }`

// The Markdown the report uses: # and ## headings, paragraphs (a line ending in \ breaks the line),
// one-line bullets, pipe tables, and **bold**, *italic*, [links](url), \* and inline HTML such as
// <sup>. A row with only its first cell filled spans its table as a group heading. Comments before
// a table shape it and survive table formatters: <!-- widths: 24 21 14 --> sets the first columns'
// widths in per cent (the rest share what is left) and <!-- keep --> keeps the table on one page.
function inline (text) {
  return text
    .replace(/<(?![a-z/])/gi, '&lt;')
    .replace(/\\\*/g, '&#42;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())

function table ([head, separator, ...body], { keep = false, widths = [] }) {
  const columns = separator.map((cell, c) => ({ num: cell.endsWith(':'), width: widths[c] ? `${widths[c]}%` : null }))
  const num = c => columns[c].num ? ' class="num"' : ''
  const header = head.map((cell, c) =>
    `<th${num(c)}${columns[c].width ? ` style="width:${columns[c].width}"` : ''}>${inline(cell)}</th>`)
  const rows = body.map(row => row.slice(1).every(cell => !cell)
    ? `<tr class="group"><th colspan="${columns.length}">${inline(row[0])}</th></tr>`
    : `<tr>${row.map((cell, c) => `<td${num(c)}>${inline(cell)}</td>`).join('')}</tr>`)
  return `<table${keep ? ' class="keep"' : ''}><thead><tr>${header.join('')}</tr></thead><tbody>${rows.join('\n')}</tbody></table>`
}

function toHtml (markdown) {
  const lines = markdown.split(/\r?\n/)
  const html = []
  let layout = {}
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    const heading = line.match(/^(#{1,2}) (.*)/)
    const comment = line.trim().match(/^<!--\s*(.*?)\s*-->$/)
    if (!line.trim()) {
      i++
    } else if (comment) {
      const widths = comment[1].match(/^widths:\s*(.*)/)
      if (comment[1] === 'keep') layout.keep = true
      if (widths) layout.widths = widths[1].split(/\s+/).map(Number)
      i++
    } else if (heading) {
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
      i++
    } else if (line.startsWith('|')) {
      const rows = []
      while (lines[i]?.startsWith('|')) rows.push(cells(lines[i++]))
      html.push(table(rows, layout))
      layout = {}
    } else if (line.startsWith('- ')) {
      const items = []
      while (lines[i]?.startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`)
      html.push(`<ul>${items.join('\n')}</ul>`)
    } else {
      const paragraph = []
      while (lines[i]?.trim() && !/^(#|\||- |<!--)/.test(lines[i])) paragraph.push(lines[i++])
      html.push(`<p>${inline(paragraph.join('\n').replace(/\\\n/g, '<br>'))}</p>`)
    }
  }
  return html.join('\n')
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vuga final technical report</title>
<style>${style}</style></head><body>
${toHtml(await readFile(source, 'utf8'))}
</body></html>`

const browser = await chromium.launch({ channel: process.env.VUGA_BROWSER_CHANNEL || 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'load' })
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
