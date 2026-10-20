// Home-screen icons from the favicon's paw. Run after changing the favicon:
//   node apps/web/scripts/icons.mjs
// Writes apps/web/public/icons/*.png (committed). Uses Playwright's Chromium.
import { chromium } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'

const dir = new URL('../public/', import.meta.url)
const favicon = await readFile(new URL('favicon.svg', dir), 'utf8')
const paw = favicon.match(/<g [\s\S]*<\/g>/)[0]
const gold = favicon.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)[1]

// Full-bleed square: the system rounds the corners (iOS) or masks it (Android).
// `scale` keeps the paw inside the maskable safe zone (the middle 80%).
const square = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${gold}"/><g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${paw}</g></svg>`

const out = [
  { name: 'icon-192.png', size: 192, svg: favicon },
  { name: 'icon-512.png', size: 512, svg: favicon },
  { name: 'apple-touch-icon.png', size: 180, svg: square(1.05) },
  { name: 'maskable-512.png', size: 512, svg: square(0.8) },
]

await mkdir(new URL('icons/', dir), { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const { name, size, svg } of out) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg.replace(/<svg ([^>]*?)width="\d+" height="\d+" /, '<svg $1')}`)
  await page.screenshot({ path: new URL(`icons/${name}`, dir).pathname, omitBackground: true })
  console.log(name)
}
await browser.close()
