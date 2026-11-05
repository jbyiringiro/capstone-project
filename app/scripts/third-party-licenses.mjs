// Writes public/third-party-licenses.txt: the licence of every open-source package that ships inside
// the built app (the minifier drops their notices, and the MIT and Apache-2.0 licences ask for them
// to travel with the code). Run again after changing these dependencies: npm run licenses
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = new URL('../', import.meta.url)
// The board's runtime code, and the Workbox modules the service worker is built from.
const SHIPPED = ['react', 'react-dom', 'scheduler', 'dexie', 'workbox-core', 'workbox-precaching', 'workbox-routing',
  'workbox-strategies', 'workbox-expiration']

const sections = SHIPPED.map(name => {
  const folder = new URL(`node_modules/${name}/`, app)
  const { version, license, homepage } = JSON.parse(readFileSync(new URL('package.json', folder), 'utf8'))
  const file = readdirSync(folder).find(entry => /^licen[cs]e/i.test(entry))
  const text = file ? readFileSync(new URL(file, folder), 'utf8').trim() : `${license} (no licence file in the package)`
  return `${'='.repeat(78)}\n${name} ${version} · ${license}${homepage ? ` · ${homepage}` : ''}\n${'='.repeat(78)}\n\n${text}\n`
})
const header = `Vuga · third-party licences\n\nVuga's own code is under the MIT licence (LICENSE in the repository). The open-source packages\nbelow are built into the app; each keeps its own licence, reproduced here. Photo, pictogram and\nvoice credits are listed separately (photos/credits.html, symbols/ATTRIBUTION.txt).\n\n`
const target = fileURLToPath(new URL('public/third-party-licenses.txt', app))
writeFileSync(target, header + sections.join('\n'))
console.log(`Wrote ${SHIPPED.length} licences to ${target}`)
