// QA captures for the everyday-polish round: every touched flow on desktop, tablet
// and phones, both engines, both themes.
// Usage (repo root): node docs/qa/everyday/scripts/capture.mjs <phase> <baseURL> [device-filter] [state-filter]
// Writes docs/qa/everyday/<phase>/<engine>-<theme>-<device>-<state>.png and inventory.json.
// States whose surface doesn't exist in the build return false and are skipped, so
// the same script captures "before" on main and every later round.
import { chromium, webkit, devices } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { seed } from './fixture.mjs'

const [phase = 'before', base = 'http://localhost:5175', deviceFilter = '', stateFilter = ''] = process.argv.slice(2)
const out = `docs/qa/everyday/${phase}`
await mkdir(out, { recursive: true })

const desktop = (w, h) => ({ ...devices['Desktop Chrome'], viewport: { width: w, height: h }, deviceScaleFactor: 1 })
const DEVICES = [
  { key: 'mac1440', engine: 'webkit', d: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { key: 'chrome1440', engine: 'chromium', d: desktop(1440, 900) },
  { key: 'mac1024', engine: 'webkit', d: { ...devices['Desktop Safari'], viewport: { width: 1024, height: 720 }, deviceScaleFactor: 1 } },
  { key: 'ipad', engine: 'webkit', d: devices['iPad Pro 11'] },
  { key: 'se', engine: 'webkit', d: devices['iPhone SE (3rd gen)'] },
  { key: 'iphone15', engine: 'webkit', d: devices['iPhone 15 Pro'] },
  { key: 'landscape', engine: 'webkit', d: devices['iPhone 15 Pro landscape'] },
  { key: 'pixel7', engine: 'chromium', d: devices['Pixel 7'] },
].filter((x) => !deviceFilter || deviceFilter.split(',').includes(x.key))

const settle = async (page) => {
  await page.waitForTimeout(350)
  await page.evaluate(async () => { await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))) })
}
const cardWith = (page, text) => page.locator('[data-testid="card"]', { hasText: text }).last()
const exists = async (page, sel) => (await page.locator(sel).count()) > 0
/** A click with a mouse, a real tap on touch devices. */
const press = (page, locator) => (page.context()._options?.hasTouch ? locator.tap() : locator.click())
const pressId = (page, id) => press(page, page.getByTestId(id).first())
/** Select a card, then (on touch) press it again to edit. */
async function editCard(page, locator, touch) {
  await press(page, locator)
  if (touch) {
    await page.waitForTimeout(250)
    if (!(await page.getByTestId('note-editor').isVisible().catch(() => false))) await press(page, locator)
  }
}
async function openMore(page) {
  await pressId(page, 'board-more')
  await page.waitForTimeout(200)
}

/** Each state starts from a freshly loaded board at 100%. Returns false to skip. */
const STATES = {
  board: async () => {},
  todo: async (page) => { await cardWith(page, 'Chores').scrollIntoViewIfNeeded() },
  'todo-select': async (page) => press(page, cardWith(page, 'Chores').locator('.todo-title, .todo-head, h3').first()),
  'todo-options': async (page) => {
    await press(page, cardWith(page, 'Chores').locator('.todo-title, .todo-head, h3').first())
    if (!(await exists(page, '[data-testid=todo-options]'))) return false
    await pressId(page, 'todo-options')
  },
  'column-click': async (page) => press(page, cardWith(page, 'Watchlist').getByTestId('column-title')),
  sync: async (page) => {
    await pressId(page, 'sync-status')
    await page.getByTestId('sync-now').waitFor({ timeout: 5000 })
  },
  'note-edit': async (page, touch) => {
    await editCard(page, cardWith(page, 'Saturday plan').getByText('popcorn', { exact: true }).first(), touch)
    await page.getByTestId('note-editor').waitFor({ timeout: 5000 })
    await page.keyboard.press('End')
  },
  'note-edit-list': async (page, touch) => {
    await editCard(page, cardWith(page, 'Saturday plan').getByText('Gummy bears').first(), touch)
    await page.getByTestId('note-editor').waitFor({ timeout: 5000 })
    await page.keyboard.press('End')
  },
  proposals: async (page) => {
    if (await exists(page, '[data-testid=review-changes]')) await pressId(page, 'review-changes')
    else {
      await openMore(page)
      if (!(await exists(page, '[data-testid=agent-proposals]'))) return false
      await pressId(page, 'agent-proposals')
    }
    const pick = page.getByTestId('agent-review').getByRole('button', { name: /Tidy movie night/ })
    if (await pick.count()) await press(page, pick.first())
    await page.waitForTimeout(800)
  },
  overview: async () => {},
}

const inventory = []
const engines = { chromium, webkit }
let fixture
for (const { key, engine, d } of DEVICES) {
  const browser = await engines[engine].launch()
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ ...d, baseURL: base, extraHTTPHeaders: { 'x-doggynote-protocol': '2' }, reducedMotion: 'reduce' })
    await context.addInitScript((t) => localStorage.setItem('doggynote.theme', t), theme)
    const login = await context.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })
    if (!login.ok()) throw new Error(`login ${login.status()}`)
    // A fresh board per device and theme, so earlier states (and approvals) can't leak in.
    fixture = await seed(context.request)
    const page = await context.newPage()
    const touch = !!d.hasTouch
    for (const [state, run] of Object.entries(STATES)) {
      if (stateFilter && !stateFilter.split(',').includes(state)) continue
      await page.goto(`/#/b/${fixture.board}`)
      const cam = state === 'board' ? null : state === 'overview' ? { x: -200, y: -300, zoom: 0.3 } : { x: -16, y: -40, zoom: 1 }
      const camFor = state === 'todo' || state === 'todo-select' || state === 'todo-options' ? { x: 300, y: -40, zoom: 1 } : state === 'column-click' ? { x: 600, y: -40, zoom: 1 } : cam
      await page.evaluate(({ board, cam }) => {
        localStorage.removeItem(`doggynote.cam.${board}`)
        if (cam) localStorage.setItem(`doggynote.cam.${board}`, JSON.stringify(cam))
      }, { board: fixture.board, cam: camFor })
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
      await page.waitForTimeout(700)
      try {
        if ((await run(page, touch)) === false) continue
        await settle(page)
        const file = `${engine}-${theme}-${key}-${state}.png`
        await page.screenshot({ path: `${out}/${file}` })
        inventory.push({ engine, theme, device: key, viewport: d.viewport, state, file: `${phase}/${file}` })
        console.log(file)
      } catch (e) {
        console.warn(`skip ${key} ${theme} ${state}: ${String(e).split('\n')[0]}`)
        inventory.push({ engine, theme, device: key, state, skipped: String(e).split('\n')[0] })
      }
    }
    await context.close()
  }
  await browser.close()
}
await writeFile(`${out}/inventory.json`, JSON.stringify(inventory, null, 2))
