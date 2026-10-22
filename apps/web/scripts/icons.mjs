// Regenerate every app mark from the upstream Phosphor filled PawPrint.
// Run: pnpm --filter web icons (Node 22+, Playwright Chromium, Tauri CLI).
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, mkdtemp, readdir, copyFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { surfaces } from '../../../packages/theme/src/tokens.ts'

const require = createRequire(import.meta.url)
const publicDir = new URL('../public/', import.meta.url)
const desktopDir = new URL('../../desktop/src-tauri/icons/', import.meta.url)
const upstream = await readFile(require.resolve('@phosphor-icons/core/fill/paw-print-fill.svg'), 'utf8')
const paw = upstream.slice(upstream.indexOf('>') + 1, upstream.lastIndexOf('</svg>'))
const gold = surfaces.dark.accent, ink = surfaces.dark.accentText
const mark = `<g transform="translate(4 4) scale(0.09375)" fill="${ink}">${paw}</g>`
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="8" fill="${gold}"/>${mark}</svg>`
const square = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${gold}"/><g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${mark}</g></svg>`
await writeFile(new URL('favicon.svg', publicDir), favicon + '\n')
await writeFile(new URL('../src/assets/paw-cursor.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 256 256" fill="${gold}" stroke="${ink}" stroke-width="12" paint-order="stroke">${paw}</svg>\n`)
await mkdir(new URL('icons/', publicDir), { recursive: true })

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const { name, size, svg } of [
    { name: 'icon-192.png', size: 192, svg: favicon },
    { name: 'icon-512.png', size: 512, svg: favicon },
    { name: 'apple-touch-icon.png', size: 180, svg: square(1.05) },
    { name: 'maskable-512.png', size: 512, svg: square(0.8) },
  ]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
    await page.screenshot({ path: fileURLToPath(new URL(`icons/${name}`, publicDir)), omitBackground: true })
  }
} finally { await browser.close() }

// Generate into a temporary directory; update only the platform files we ship.
const temp = await mkdtemp(join(tmpdir(), 'doggynote-icons-'))
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../desktop/node_modules/@tauri-apps/cli/tauri.js', import.meta.url)), 'icon', fileURLToPath(new URL('icons/icon-512.png', publicDir)), '--output', temp], { stdio: 'inherit' })
  for (const name of await readdir(desktopDir)) {
    if (/\.(png|icns|ico)$/.test(name)) await copyFile(join(temp, name), new URL(name, desktopDir))
  }
} finally { await rm(temp, { recursive: true, force: true }) }
console.log('Updated favicon, paw cursor, PWA icons and desktop icons from Phosphor PawPrint.')
