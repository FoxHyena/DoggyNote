// Mobile QA captures: every flow on phone and tablet emulation, both engines, both themes.
// Usage (repo root): node docs/qa/mobile/scripts/capture.mjs <phase> <baseURL> [device-filter] [state-filter]
// Writes docs/qa/mobile/<phase>/<engine>-<theme>-<device>-<state>.png and inventory.json.
import { chromium, webkit, devices } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { seed } from './fixture.mjs'

const [phase = 'before', base = 'http://localhost:5197', deviceFilter = '', stateFilter = ''] = process.argv.slice(2)
const out = `docs/qa/mobile/${phase}`
await mkdir(out, { recursive: true })

const DEVICES = [
  { key: 'se', engine: 'webkit', d: devices['iPhone SE (3rd gen)'] },
  { key: 'iphone15', engine: 'webkit', d: devices['iPhone 15 Pro'] },
  { key: 'landscape', engine: 'webkit', d: devices['iPhone 15 Pro landscape'] },
  { key: 'pixel7', engine: 'chromium', d: devices['Pixel 7'] },
  { key: 'ipadmini', engine: 'webkit', d: devices['iPad Mini'] },
].filter((x) => !deviceFilter || deviceFilter.split(',').includes(x.key))

const settle = async (page) => {
  await page.waitForTimeout(350)
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))) })
}
const tapId = async (page, id) => page.getByTestId(id).first().tap()
const cardWith = (page, text) => page.locator('[data-testid="card"]', { hasText: text }).last()
const exists = async (page, sel) => (await page.locator(sel).count()) > 0

/** Each state starts from a freshly loaded board. Returns false to skip (surface absent). */
const STATES = {
  board: async () => {},
  'tap-note': async (page) => { await cardWith(page, 'Hike plan').tap() },
  'edit-note': async (page) => {
    await cardWith(page, 'Hike plan').tap()
    await page.waitForTimeout(250)
    if (!(await page.getByTestId('note-editor').isVisible().catch(() => false))) await cardWith(page, 'Hike plan').tap()
    await page.getByTestId('note-editor').waitFor({ timeout: 5000 })
  },
  'tap-todo': async (page) => { await cardWith(page, 'Packing list').tap() },
  connect: async (page) => {
    await cardWith(page, 'Hike plan').tap()
    if (!(await exists(page, '[data-testid=connect-card]'))) return false
    await tapId(page, 'connect-card')
  },
  add: async (page) => { if (await exists(page, '[data-testid=dock-add]')) await tapId(page, 'dock-add') },
  boards: async (page) => tapId(page, 'board-navigation'),
  account: async (page) => tapId(page, 'account'),
  more: async (page) => tapId(page, 'board-more'),
  share: async (page) => {
    if (await page.getByTestId('share').first().isVisible()) return tapId(page, 'share')
    await tapId(page, 'board-more')
    await page.getByRole('menuitem', { name: /share/i }).first().tap()
  },
  inbox: async (page) => tapId(page, 'toybox-button'),
  trash: async (page) => tapId(page, 'tool-trash'),
  comments: async (page) => { await cardWith(page, 'Who is driving').getByTestId('comment-badge').tap({ force: true }) },
  fetch: async (page) => tapId(page, 'open-fetch'),
  zoom: async (page) => tapId(page, 'zoom'),
  overview: async () => {},
}

const inventory = []
const engines = { chromium, webkit }
let fixture
for (const { key, engine, d } of DEVICES) {
  const browser = await engines[engine].launch()
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ ...d, baseURL: base, extraHTTPHeaders: { 'x-doggynote-protocol': '2' } })
    await context.addInitScript((t) => localStorage.setItem('doggynote.theme', t), theme)
    const login = await context.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })
    if (!login.ok()) throw new Error(`login ${login.status()}`)
    fixture ??= await seed(context.request)
    const page = await context.newPage()
    const shoot = async (state, extra = {}) => {
      const file = `${engine}-${theme}-${key}-${state}.png`
      await page.screenshot({ path: `${out}/${file}` })
      inventory.push({ engine, theme, device: key, viewport: d.viewport, state, file: `${phase}/${file}`, ...extra })
      console.log(file)
    }
    for (const [state, run] of Object.entries(STATES)) {
      if (stateFilter && !stateFilter.split(',').includes(state)) continue
      await page.goto(`/#/b/${fixture.board}`)
      // 'board' shows the default fit; 'overview' the zoomed-out canvas; everything else starts at 100% on the first note.
      const cam = state === 'board' ? null : state === 'overview' ? { x: -300, y: -400, zoom: 0.25 } : { x: -16, y: -40, zoom: 1 }
      await page.evaluate(({ board, cam }) => {
        localStorage.removeItem(`doggynote.cam.${board}`)
        if (cam) localStorage.setItem(`doggynote.cam.${board}`, JSON.stringify(cam))
      }, { board: fixture.board, cam })
      for (let attempt = 0; ; attempt++) {
        try {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.getByTestId('canvas').waitFor({ timeout: 15000 })
          break
        } catch (e) {
          if (attempt > 2) throw e
          await page.waitForTimeout(500)
        }
      }
      await page.waitForTimeout(600)
      try {
        if ((await run(page)) === false) continue
        await settle(page)
        await shoot(state)
      } catch (e) {
        console.warn(`skip ${key} ${theme} ${state}: ${String(e).split('\n')[0]}`)
        inventory.push({ engine, theme, device: key, state, skipped: String(e).split('\n')[0] })
      }
    }
    // Signed-out and share-link views.
    if (!stateFilter || stateFilter.includes('login') || stateFilter.includes('viewer')) {
      const anon = await browser.newContext({ ...d, baseURL: base, extraHTTPHeaders: { 'x-doggynote-protocol': '2' } })
      await anon.addInitScript((t) => localStorage.setItem('doggynote.theme', t), theme)
      const p = await anon.newPage()
      for (const [state, url] of [['login', '/'], ['viewer', `/s/${fixture.share}`]]) {
        await p.goto(url)
        await p.waitForTimeout(1200)
        const file = `${engine}-${theme}-${key}-${state}.png`
        await p.screenshot({ path: `${out}/${file}` })
        inventory.push({ engine, theme, device: key, viewport: d.viewport, state, file: `${phase}/${file}` })
        console.log(file)
      }
      await anon.close()
    }
    await context.close()
  }
  await browser.close()
}
await writeFile(`${out}/inventory.json`, JSON.stringify(inventory, null, 2))
