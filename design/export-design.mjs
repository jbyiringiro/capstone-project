/**
 * Export the local Vuga design to directly importable, editable Figma SVG files.
 * Run from any directory: node design/export-design.mjs
 * Requires the existing Playwright dependency in vuga-aac/app/node_modules.
 * Screens are built from DOM geometry, vector icons and live text; SVG outputs
 * contain no raster screenshots or foreignObject elements.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const directory = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.resolve(directory, '../app/package.json'))
const { chromium } = require('@playwright/test')
const tabletStates = ['board', 'compose', 'food', 'feelings', 'show', 'audio', 'profiles', 'new-profile', 'vocabulary', 'preferences', 'summary', 'empty-board']
const mobileStates = ['board', 'compose', 'profiles']
const selected = process.argv.find(arg => arg.startsWith('--states='))?.slice(9).split(',')
const svgDirectory = path.join(directory, 'figma-import')
const pngDirectory = path.join(directory, 'previews')
const verificationDirectory = path.join(directory, 'verification')
await Promise.all([svgDirectory, pngDirectory, verificationDirectory].map(dir => fs.mkdir(dir, { recursive: true })))

let browser
try { browser = await chromium.launch({ headless: true }) }
catch { browser = await chromium.launch({ channel: 'msedge', headless: true }) }
const page = await browser.newPage({ deviceScaleFactor: 1 })
const sourceErrors = []
page.on('pageerror', error => sourceErrors.push(error.message))
const snapshots = []
const manifest = []
const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]))
const number = value => Math.round(Number(value) * 100) / 100
const transparent = color => !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
const splitCSS = value => value.split(/,(?![^()]*\))/).map(part => part.trim())

// All measurements happen inside Chromium, including wrapping and glyph placement.
async function takeSnapshot(rootSelector, name) {
  return page.evaluate(({ rootSelector, name }) => {
    const root = document.querySelector(rootSelector)
    if (!root) throw new Error(`Missing design root ${rootSelector}`)
    const rootBounds = root.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    let sequence = 0
    const round = value => Math.round(value * 100) / 100
    const rect = bounds => ({ x: round(bounds.x - rootBounds.x), y: round(bounds.y - rootBounds.y), width: round(bounds.width), height: round(bounds.height) })
    const properties = ['backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopStyle', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'outlineWidth', 'outlineColor', 'outlineOffset', 'outlineStyle', 'boxShadow', 'backdropFilter', 'opacity', 'overflowX', 'overflowY', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textAlign', 'textTransform', 'textDecorationLine', 'paddingLeft', 'paddingRight', 'zIndex', 'position', 'accentColor']
    const styleObject = style => Object.fromEntries(properties.map(key => [key, style[key]]))
    function textSnapshot(node, element) {
      const style = getComputedStyle(element)
      const source = node.nodeValue
      if (!source.trim()) return null
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const metrics = context.measureText('Hg')
      const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * 0.92
      const lines = []
      let current = null
      for (let i = 0; i < source.length; i++) {
        if (/[\uDC00-\uDFFF]/.test(source[i]) && i > 0 && /[\uD800-\uDBFF]/.test(source[i - 1])) continue
        const length = /[\uD800-\uDBFF]/.test(source[i]) && i + 1 < source.length ? 2 : 1
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + length)
        const bounds = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
        if (!bounds) continue
        let char = source.slice(i, i + length).replace(/[\r\n\t]/g, ' ')
        if (style.textTransform === 'uppercase') char = char.toUpperCase()
        else if (style.textTransform === 'lowercase') char = char.toLowerCase()
        else if (style.textTransform === 'capitalize' && (i === 0 || /\s/.test(source[i - 1]))) char = char.toUpperCase()
        if (!current || Math.abs(current.top - bounds.top) > 1) {
          current = { top: bounds.top, y: round(bounds.top - rootBounds.top + ascent), text: '', x: [], bounds: rect(bounds) }
          lines.push(current)
        }
        // A collapsed space has zero advance and should not become an extra SVG glyph.
        const x = round(bounds.left - rootBounds.left)
        if (char === ' ' && current.text.endsWith(' ') && current.x.at(-1) === x) continue
        current.text += char
        current.x.push(x)
        current.bounds.width = round(bounds.right - rootBounds.left - current.bounds.x)
      }
      for (const line of lines) delete line.top
      return lines.length ? { kind: 'text', id: `${name}-text-${sequence++}`, style: styleObject(style), lines } : null
    }
    function svgSnapshot(element) {
      const clone = element.cloneNode(true)
      const originals = [element, ...element.querySelectorAll('*')]
      const copies = [clone, ...clone.querySelectorAll('*')]
      const attrs = ['fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity', 'color']
      originals.forEach((original, index) => {
        const computed = getComputedStyle(original)
        for (const attr of attrs) copies[index].setAttribute(attr, computed.getPropertyValue(attr))
        copies[index].removeAttribute('class')
        copies[index].removeAttribute('style')
      })
      let matrix = new DOMMatrix()
      for (let ancestor = element; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        const transform = getComputedStyle(ancestor).transform
        if (transform && transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix)
      }
      const bounds = rect(element.getBoundingClientRect())
      let transform = null
      if (Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001) {
        const width = parseFloat(getComputedStyle(element).width), height = parseFloat(getComputedStyle(element).height)
        const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
        transform = `translate(${cx} ${cy}) matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} 0 0) translate(${-cx} ${-cy})`
        Object.assign(bounds, { x: round(cx - width / 2), y: round(cy - height / 2), width, height })
      }
      return { kind: 'svg', id: `${name}-icon-${sequence++}`, label: element.getAttribute('aria-label') ?? 'Icon', bounds, transform, viewBox: element.getAttribute('viewBox') ?? `0 0 ${element.clientWidth} ${element.clientHeight}`, content: clone.innerHTML, attrs: Object.fromEntries(attrs.map(attr => [attr, clone.getAttribute(attr)])) }
    }
    function visit(element) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null
      const bounds = element.getBoundingClientRect()
      // display:contents participates in layout through its children without a box.
      if (!bounds.width && !bounds.height && style.display !== 'contents') return null
      if (element instanceof SVGElement) return svgSnapshot(element)
      const output = { kind: 'element', id: `${name}-${element.tagName.toLowerCase()}-${sequence++}`, label: element.dataset.name || element.getAttribute('aria-label') || element.id || element.className || element.tagName, tag: element.tagName.toLowerCase(), classes: typeof element.className === 'string' ? element.className : '', bounds: rect(bounds), style: styleObject(style), children: [] }
      for (const child of element.childNodes) {
        const result = child.nodeType === Node.ELEMENT_NODE ? visit(child) : child.nodeType === Node.TEXT_NODE ? textSnapshot(child, element) : null
        if (result) output.children.push(result)
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const value = element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent ?? '' : element.value || element.placeholder
        const type = element.type
        output.control = { type, value, checked: Boolean(element.checked), placeholder: !element.value, min: element.min, max: element.max }
        if (value && !['checkbox', 'radio', 'range', 'color'].includes(type)) {
          context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const metrics = context.measureText(value)
          const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * 0.92
          const descent = metrics.fontBoundingBoxDescent ?? parseFloat(style.fontSize) * 0.25
          output.children = [{ kind: 'text', id: `${output.id}-value`, style: { ...output.style, color: element.value ? style.color : getComputedStyle(element, '::placeholder').color }, lines: [{ text: value, x: [round(bounds.x - rootBounds.x + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth))], y: round(bounds.y - rootBounds.y + (bounds.height - ascent - descent) / 2 + ascent) }] }]
        }
      }
      return output
    }
    return { name, width: round(rootBounds.width), height: round(rootBounds.height), root: visit(root) }
  }, { rootSelector, name })
}

function serialize(snapshot) {
  const defs = []
  let definition = 0
  function radius(value, width, height) {
    return Math.min(width / 2, height / 2, value.endsWith('%') ? parseFloat(value) * Math.min(width, height) / 100 : parseFloat(value) || 0)
  }
  function roundedRect(bounds, style, inset = 0) {
    const x = number(bounds.x + inset), y = number(bounds.y + inset)
    const w = number(Math.max(0, bounds.width - inset * 2)), h = number(Math.max(0, bounds.height - inset * 2))
    const [tl, tr, br, bl] = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => Math.max(0, radius(style[`border${corner}Radius`] ?? '0', bounds.width, bounds.height) - inset))
    return `M ${number(x + tl)} ${y} H ${number(x + w - tr)} Q ${number(x + w)} ${y} ${number(x + w)} ${number(y + tr)} V ${number(y + h - br)} Q ${number(x + w)} ${number(y + h)} ${number(x + w - br)} ${number(y + h)} H ${number(x + bl)} Q ${x} ${number(y + h)} ${x} ${number(y + h - bl)} V ${number(y + tl)} Q ${x} ${y} ${number(x + tl)} ${y} Z`
  }
  function gradient(image) {
    if (!image?.startsWith('linear-gradient(')) return null
    const parts = splitCSS(image.slice(16, -1))
    let direction = parts[0]
    if (/^(to |[\d.-]+deg)/.test(direction)) parts.shift()
    else direction = '180deg'
    const angle = direction.endsWith('deg') ? parseFloat(direction) : ({ 'to right': 90, 'to bottom right': 135, 'to bottom': 180, 'to bottom left': 225, 'to left': 270, 'to top': 0 }[direction] ?? 180)
    const radians = angle * Math.PI / 180
    const dx = Math.sin(radians) / 2, dy = -Math.cos(radians) / 2
    const id = `${snapshot.name}-gradient-${definition++}`
    const stops = parts.map((part, index) => {
      const match = part.match(/^(rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+)(?:\s+([\d.]+)%?)?$/i)
      if (!match) return ''
      return `<stop offset="${match[2] ?? (index * 100 / Math.max(1, parts.length - 1))}%" stop-color="${xml(match[1])}"/>`
    }).join('')
    defs.push(`<linearGradient id="${id}" x1="${number((0.5 - dx) * 100)}%" y1="${number((0.5 - dy) * 100)}%" x2="${number((0.5 + dx) * 100)}%" y2="${number((0.5 + dy) * 100)}%">${stops}</linearGradient>`)
    return `url(#${id})`
  }
  function shadow(value) {
    if (!value || value === 'none') return null
    const shadows = splitCSS(value).filter(part => !part.includes('inset'))
    if (!shadows.length) return null
    const id = `${snapshot.name}-shadow-${definition++}`
    const effects = shadows.map(part => {
      const color = part.match(/rgba?\([^)]*\)/)?.[0] ?? 'rgba(0,0,0,0.12)'
      const sizes = part.replace(color, '').trim().split(/\s+/).map(parseFloat)
      return `<feDropShadow dx="${sizes[0] || 0}" dy="${sizes[1] || 0}" stdDeviation="${(sizes[2] || 0) / 2}" flood-color="${xml(color)}"/>`
    }).join('')
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${effects}</filter>`)
    return `url(#${id})`
  }
  function render(node) {
    if (node.kind === 'text') {
      const s = node.style
      return `<g id="${node.id}" data-name="${xml(node.lines.map(line => line.text).join(' ').trim())}">${node.lines.map(line => `<text x="${line.x.join(' ')}" y="${line.y}" fill="${xml(s.color)}" font-family="${xml(s.fontFamily)}" font-size="${parseFloat(s.fontSize)}" font-weight="${s.fontWeight}" font-style="${s.fontStyle}"${s.textDecorationLine !== 'none' ? ` text-decoration="${xml(s.textDecorationLine)}"` : ''} xml:space="preserve">${xml(line.text)}</text>`).join('')}</g>`
    }
    if (node.kind === 'svg') {
      const b = node.bounds
      return `<g id="${node.id}" data-name="${xml(node.label)}"${node.transform ? ` transform="${node.transform}"` : ''}><svg x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" viewBox="${xml(node.viewBox)}" ${Object.entries(node.attrs).map(([key, value]) => `${key}="${xml(value)}"`).join(' ')}>${node.content}</svg></g>`
    }
    const { bounds: b, style: s } = node
    const parts = []
    const fill = gradient(s.backgroundImage) ?? s.backgroundColor
    const effect = shadow(s.boxShadow)
    if (!transparent(fill) || effect) parts.push(`<path d="${roundedRect(b, s)}" fill="${xml(transparent(fill) ? 'none' : fill)}"${effect ? ` filter="${effect}"` : ''}/>`)
    const borders = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({ width: parseFloat(s[`border${side}Width`]) || 0, color: s[`border${side}Color`] }))
    if (borders.every(border => border.width === borders[0].width && border.color === borders[0].color)) {
      if (borders[0].width) parts.push(`<path d="${roundedRect(b, s, borders[0].width / 2)}" fill="none" stroke="${xml(borders[0].color)}" stroke-width="${borders[0].width}"${s.borderTopStyle === 'dashed' ? ' stroke-dasharray="7 5"' : s.borderTopStyle === 'dotted' ? ' stroke-dasharray="2 4"' : ''}/>`)
    } else {
      const lines = [[b.x, b.y + borders[0].width / 2, b.x + b.width, b.y + borders[0].width / 2], [b.x + b.width - borders[1].width / 2, b.y, b.x + b.width - borders[1].width / 2, b.y + b.height], [b.x, b.y + b.height - borders[2].width / 2, b.x + b.width, b.y + b.height - borders[2].width / 2], [b.x + borders[3].width / 2, b.y, b.x + borders[3].width / 2, b.y + b.height]]
      borders.forEach((border, index) => { if (border.width) parts.push(`<path d="M ${lines[index].slice(0, 2).map(number).join(' ')} L ${lines[index].slice(2).map(number).join(' ')}" fill="none" stroke="${xml(border.color)}" stroke-width="${border.width}"/>`) })
    }
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth)) {
      const outlineWidth = parseFloat(s.outlineWidth)
      parts.push(`<path d="${roundedRect(b, s, -(parseFloat(s.outlineOffset) + outlineWidth / 2))}" fill="none" stroke="${xml(s.outlineColor)}" stroke-width="${outlineWidth}"/>`)
    }
    if (node.control?.type === 'checkbox') {
      const accent = s.accentColor === 'auto' ? '#176b62' : s.accentColor
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="3" fill="${node.control.checked ? accent : '#ffffff'}" stroke="${node.control.checked ? accent : '#7a847d'}"/>`)
      if (node.control.checked) parts.push(`<path d="M ${number(b.x + b.width * 0.2)} ${number(b.y + b.height * 0.5)} L ${number(b.x + b.width * 0.43)} ${number(b.y + b.height * 0.72)} L ${number(b.x + b.width * 0.8)} ${number(b.y + b.height * 0.25)}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`)
    }
    if (node.tag === 'select') {
      const x = b.x + b.width - 15, y = b.y + b.height / 2
      parts.push(`<path d="M ${number(x - 4)} ${number(y - 2)} L ${number(x)} ${number(y + 2)} L ${number(x + 4)} ${number(y - 2)}" stroke="${xml(s.color)}" stroke-width="1.4" fill="none"/>`)
    }
    let children = ''
    for (const child of [...node.children].sort((a, b) => (Number(a.style?.zIndex) || 0) - (Number(b.style?.zIndex) || 0))) {
      const blur = child.style?.backdropFilter?.match(/blur\(([\d.]+)px\)/)?.[1]
      if (blur && children) {
        const id = `${snapshot.name}-backdrop-${definition++}`
        defs.push(`<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${blur}"/></filter>`)
        children = `<g filter="url(#${id})">${children}</g>`
      }
      children += render(child)
    }
    let clip
    if (['hidden', 'auto', 'scroll', 'clip'].includes(s.overflowX) || ['hidden', 'auto', 'scroll', 'clip'].includes(s.overflowY)) {
      clip = `${snapshot.name}-clip-${definition++}`
      defs.push(`<clipPath id="${clip}"><path d="${roundedRect(b, s)}"/></clipPath>`)
    }
    parts.push(clip ? `<g clip-path="url(#${clip})">${children}</g>` : children)
    return `<g id="${node.id}" data-name="${xml(node.label)}"${Number(s.opacity) !== 1 ? ` opacity="${s.opacity}"` : ''}>${parts.join('')}</g>`
  }
  const body = render(snapshot.root)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${snapshot.width}" height="${snapshot.height}" viewBox="0 0 ${snapshot.width} ${snapshot.height}"><title>${xml(snapshot.name)}</title><desc>Vuga concept design. Editable vector paths and live text; no embedded screenshots.</desc><defs>${defs.join('')}</defs><g id="${snapshot.name}" data-name="${snapshot.name}">${body}</g></svg>\n`
}

async function exportScreen(state, device, source = 'preview.html', selector = '#app') {
  const width = device === 'mobile' ? 390 : device === 'foundations' ? 1440 : 1280
  await page.setViewportSize({ width, height: device === 'mobile' ? 844 : 900 })
  await page.goto(pathToFileURL(path.join(directory, source)).href, { waitUntil: 'load' })
  if (source === 'preview.html') await page.evaluate(state => window.vugaPreview.show(state), state)
  if (source === 'preview.html') await page.addStyleTag({ content: 'body{padding:0!important}.preview-toolbar,.preview-footer{display:none!important}#app{margin:0!important;max-width:none!important;width:100%!important}*{animation:none!important;transition:none!important}' })
  await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  // Pseudo-elements have no DOM bounding API. Materialise their already-computed
  // styles so the browser positions their vector geometry exactly like the source.
  await page.evaluate(selector => {
    const definitions = []
    for (const element of document.querySelector(selector).querySelectorAll('*')) {
      if (element instanceof SVGElement) continue
      for (const pseudo of ['::before', '::after']) {
        const computed = getComputedStyle(element, pseudo)
        if (computed.content === 'none' || computed.content === 'normal' || computed.display === 'none') continue
        definitions.push({ element, pseudo, content: computed.content, css: [...computed].filter(key => key !== 'content').map(key => `${key}:${computed.getPropertyValue(key)};`).join('') })
      }
    }
    const suppression = document.createElement('style')
    suppression.textContent = '*::before,*::after{content:none!important}'
    document.head.append(suppression)
    for (const { element, pseudo, content, css } of definitions) {
      const span = document.createElement('span')
      span.style.cssText = css
      span.dataset.name = `${element.className || element.tagName} ${pseudo}`
      span.setAttribute('aria-hidden', 'true')
      span.textContent = /^['"].*['"]$/.test(content) ? content.slice(1, -1) : ''
      if (pseudo === '::before') element.prepend(span)
      else element.append(span)
    }
  }, selector)
  const name = `${device}-${state}`
  const snapshot = await takeSnapshot(selector, name)
  const svg = serialize(snapshot)
  if (/<foreignObject|<image\b/i.test(svg)) throw new Error(`${name}: raster images or foreignObject are not allowed`)
  await fs.writeFile(path.join(svgDirectory, `${name}.svg`), svg, 'utf8')
  await page.locator(selector).screenshot({ path: path.join(pngDirectory, `${name}.png`), animations: 'disabled' })
  snapshots.push(snapshot)
  manifest.push({ name, state, device, width: snapshot.width, height: snapshot.height, svg: `figma-import/${name}.svg`, preview: `previews/${name}.png`, editableText: true, rasterImages: 0 })
  // Render the SVG independently to make visual checks easy against the DOM preview.
  {
    const verification = await browser.newPage({ viewport: { width: Math.ceil(snapshot.width), height: Math.ceil(snapshot.height) }, deviceScaleFactor: 1 })
    await verification.setContent(`<html><body style="margin:0;width:${snapshot.width}px;height:${snapshot.height}px">${svg.replace(/^<\?xml[^>]+>\s*/, '')}</body></html>`)
    await verification.screenshot({ path: path.join(verificationDirectory, `${name}-svg.png`) })
    await verification.close()
  }
  console.log(`${name}: ${snapshot.width} x ${snapshot.height}; SVG + PNG exported`)
}

async function exportOverview() {
  const columns = 4, columnWidth = 540, gap = 32, margin = 48
  const width = margin * 2 + columns * columnWidth + (columns - 1) * gap
  let top = 132
  const frames = []
  for (let i = 0; i < snapshots.length; i += columns) {
    const row = snapshots.slice(i, i + columns)
    let rowHeight = 0
    for (let column = 0; column < row.length; column++) {
      const snapshot = row[column]
      const scale = Math.min(0.5, columnWidth / snapshot.width)
      const left = margin + column * (columnWidth + gap)
      const svg = serialize(snapshot).replace(/^<\?xml[^>]+>\s*/, '').replace(/<svg\b[^>]*>/, `<svg x="${left}" y="${top + 36}" width="${number(snapshot.width * scale)}" height="${number(snapshot.height * scale)}" viewBox="0 0 ${snapshot.width} ${snapshot.height}">`)
      frames.push(`<g id="overview-${snapshot.name}"><text x="${left}" y="${top + 20}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#173c42">${xml(snapshot.name)}</text>${svg}</g>`)
      rowHeight = Math.max(rowHeight, snapshot.height * scale + 36)
    }
    top += rowHeight + 44
  }
  const height = Math.ceil(top + margin)
  const overview = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Vuga design screens</title><rect width="${width}" height="${height}" fill="#eef5f1"/><text x="48" y="66" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#173c42">Vuga · a little more independence, one picture at a time</text><text x="48" y="98" font-family="Arial, sans-serif" font-size="18" fill="#54706d">Tablet and mobile concept screens · Individual SVG files preserve full frame sizes</text>${frames.join('')}</svg>`
  await fs.writeFile(path.join(svgDirectory, 'all-screens.svg'), overview, 'utf8')
  const overviewPage = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await overviewPage.setContent(`<html><body style="margin:0;width:${width}px;height:${height}px">${overview}</body></html>`)
  await overviewPage.screenshot({ path: path.join(pngDirectory, 'all-screens.png'), fullPage: true })
  await overviewPage.close()
}

try {
  for (const state of tabletStates) if (!selected || selected.includes(state)) await exportScreen(state, 'tablet')
  for (const state of mobileStates) if (!selected || selected.includes(state)) await exportScreen(state, 'mobile')
  try { await fs.access(path.join(directory, 'foundations.html')); await exportScreen('system', 'foundations', 'foundations.html', '#foundations') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (sourceErrors.length) throw new Error(`Preview script errors: ${sourceErrors.join('; ')}`)
  await exportOverview()
  await fs.writeFile(path.join(directory, 'design-snapshot.json'), JSON.stringify({ format: 'vuga-dom-design-snapshot-v1', generatedAt: new Date().toISOString(), units: 'CSS pixels', screens: snapshots }, null, 2))
  await fs.writeFile(path.join(directory, 'export-manifest.json'), JSON.stringify({ format: 'vuga-figma-svg-pack-v1', screens: manifest, note: 'SVG imports retain editable vector paths and live text. Auto layout, components, and prototype connections must be configured after import.' }, null, 2))
  console.log(`Done: ${manifest.length} screens. SVG imports contain vector geometry and editable text.`)
} finally { await browser.close() }
