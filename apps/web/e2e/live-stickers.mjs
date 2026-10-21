// Opt-in manual verification against an already running isolated local Worker.
// Never reads/prints the bot token. Bot API traffic stays in the Worker.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const baseURL = process.env.STICKER_LIVE_BASE ?? 'http://localhost:8789'
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('Use an isolated local Worker')
const dir = resolve('../../docs/qa/stickers/live'); mkdirSync(dir, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
const report = { date: new Date().toISOString(), pack: 'hyenafox', baseURL, checks: [] }
const check = (message) => { report.checks.push(message); console.log(message) }
try {
  const login = await context.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })
  if (!login.ok()) throw new Error(`Local fixture login: HTTP ${login.status()}`)
  const page = await context.newPage(), id = crypto.randomUUID()
  const board = { id, kind: 'board', parentId: null, title: 'Live hyenafox QA', icon: 'paw', color: 'gold', createdAt: Date.now() }
  const seed = await context.request.post('/api/sync', { headers: { 'x-doggynote-protocol': '2' }, data: { changes: [{ id, patch: board }] } })
  if (!seed.ok()) throw new Error(`Local board setup: HTTP ${seed.status()}`)
  report.boardId = id
  await page.goto(`/#/b/${id}`)
  await page.getByTestId('tool-stickers').click()
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByLabel('Pack link or short name').fill('https://t.me/addstickers/hyenafox')
  await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  await tray.getByRole('heading', { name: 'Oreo the Fox Hyena', exact: true }).waitFor({ timeout: 60_000 })
  check('Live Bot API resolved the real title in the app preview.')
  await page.screenshot({ path: resolve(dir, 'hyenafox-preview-loading.png') })
  await page.waitForFunction(() => !document.querySelector('.sticker-tray .sticker-status'), null, { timeout: 240_000 })
  if (await tray.getByRole('button', { name: 'Retry', exact: true }).isVisible()) {
    await tray.getByRole('button', { name: 'Retry', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.sticker-tray .sticker-status'), null, { timeout: 240_000 })
  }
  const add = tray.getByRole('button', { name: 'Add pack', exact: true })
  if (await add.count()) await add.click()
  else await tray.getByRole('button', { name: 'Open pack', exact: true }).click()
  await tray.locator('.sticker-pack-title').waitFor()
  const collection = await (await context.request.get('/api/stickers')).json()
  const pack = collection.packs.find((p) => p.name.toLowerCase() === 'hyenafox')
  report.title = pack.title; report.count = pack.stickers.length; report.available = pack.stickers.filter((s) => s.available).length
  report.formats = [...new Set(pack.stickers.map((s) => s.format))]
  report.unavailable = pack.stickers.filter((s) => !s.available).map((s) => ({ stickerId: s.stickerId, error: s.error }))
  check(`Added live pack: ${report.available}/${report.count} usable; formats ${report.formats.join(', ')}.`)
  await page.screenshot({ path: resolve(dir, 'hyenafox-tray.png') })
  await tray.getByTestId('sticker-pick').filter({ has: page.locator('img') }).first().click()
  await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  await page.getByTestId('placed-sticker').waitFor()
  await page.getByLabel('Sticker angle', { exact: true }).fill('24'); await page.getByLabel('Sticker angle', { exact: true }).press('Tab')
  await page.getByLabel('Sticker size', { exact: true }).fill('220'); await page.getByLabel('Sticker size', { exact: true }).press('Tab')
  await page.waitForFunction(() => document.querySelector('[data-testid="sync-status"]')?.getAttribute('data-pending') === '0')
  await page.screenshot({ path: resolve(dir, 'hyenafox-placed.png') })
  await page.reload(); await page.getByTestId('placed-sticker').waitFor()
  const image = page.getByTestId('placed-sticker').locator('img')
  await image.evaluate((img) => img.decode())
  check('Live asset placed, resized, rotated and rendered after reload.')
  report.success = report.available > 0 && !report.unavailable.length
} catch (e) {
  // Request/selector errors only reference local URLs; do not print arbitrary env values.
  report.success = false; report.error = String(e.message).slice(0, 1000)
  console.log('Live check incomplete:', report.error)
} finally {
  writeFileSync(resolve(dir, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
if (!report.success) process.exitCode = 1
