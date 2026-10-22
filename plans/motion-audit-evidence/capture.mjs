import { chromium, webkit, devices } from '../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const root = (await import('node:url')).fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const out = process.env.MOTION_CAPTURE_OUT ?? `${root}/apps/web/test-results/motion-audit-baseline`
const phase = process.env.MOTION_CAPTURE_PHASE ?? 'baseline'
const username = process.env.MOTION_FIXTURE_USER
const password = process.env.MOTION_FIXTURE_PASSWORD
if (!username || !password) throw new Error('Set MOTION_FIXTURE_USER and MOTION_FIXTURE_PASSWORD for the isolated local test account.')
const origin = 'http://localhost:5295'
for (let attempt = 0; attempt < 60; attempt++) {
  if (await fetch(`${origin}/api/health`).then(r => r.ok).catch(() => false)) break
  if (attempt === 59) throw new Error('Isolated fixture server did not become healthy')
  await new Promise(r => setTimeout(r, 500))
}
await mkdir(out, { recursive: true })
const results = []
for (const [engine, browserType, phoneDevice] of [['chromium', chromium, devices['Pixel 7']], ['webkit', webkit, devices['iPhone 15 Pro']]]) {
  const browser = await browserType.launch()
  for (const mobile of [false, true]) {
    const label = `${engine}-${mobile ? 'phone' : 'desktop'}`
    const context = await browser.newContext({ ...(mobile ? phoneDevice : { viewport: { width: 1280, height: 800 } }), baseURL: origin, extraHTTPHeaders: { 'x-doggynote-protocol': '3' }, recordVideo: { dir: out, size: mobile ? { width: 480, height: 900 } : { width: 1280, height: 800 } } })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    const login = await context.request.post('/api/auth/login', { data: { username, password } })
    if (!login.ok()) throw new Error(`Local fixture login failed: ${login.status()}`)
    const id = crypto.randomUUID()
    const res = await context.request.post('/api/sync', { data: { changes: [{ id, patch: { id, kind: 'board', parentId: 'home', title: `Motion audit ${label}`, icon: 'paw', color: 'gold', createdAt: Date.now() } }] } })
    if (!res.ok()) throw new Error(`Seed ${res.status()}: ${await res.text()}`)
    await page.goto(`/#/b/${id}`)
    await page.getByTestId('canvas').waitFor()
    await page.waitForTimeout(400)
    const observations = { label }
    if (!mobile) {
      await page.evaluate(() => {
        window.__fetch = null
        new MutationObserver(() => {
          const el = document.querySelector('[data-testid="fetch"]')
          if (el && !window.__fetch) window.__fetch = { animation: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration, transform: getComputedStyle(el).transform, opacity: getComputedStyle(el).opacity }
        }).observe(document.body, { childList: true, subtree: true })
      })
      await page.keyboard.press('Meta+k')
      await page.getByTestId('fetch-input').waitFor()
      observations.fetch = await page.evaluate(() => window.__fetch)
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
      await page.getByTestId('tool-note').click()
      await page.getByTestId('note-editor').waitFor()
      await page.keyboard.type('Motion baseline note')
      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        window.__toastSamples = []
        let started = false
        new MutationObserver(() => {
          const el = document.querySelector('[data-testid="toast"]')
          if (!el || started) return
          started = true
          const start = performance.now()
          const sample = () => {
            const b = el.getBoundingClientRect()
            window.__toastSamples.push({ ms: performance.now() - start, x: b.x, width: b.width, transform: getComputedStyle(el).transform })
            if (performance.now() - start < 220) requestAnimationFrame(sample)
          }
          sample()
        }).observe(document.body, { subtree: true, childList: true })
      })
      await page.keyboard.press('Backspace')
      await page.getByTestId('toast').waitFor()
      await page.waitForTimeout(300)
      observations.toast = await page.evaluate(() => window.__toastSamples)
      await page.screenshot({ path: `${out}/${label}-toast.png` })
      await page.getByTestId('toast').click()
    } else {
      const add = page.getByTestId('dock-add')
      const b = await add.boundingBox()
      await page.evaluate(() => { window.__addClicks = []; document.querySelector('[data-testid="dock-add"]').addEventListener('click', () => window.__addClicks.push(performance.now())) })
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
      await page.waitForTimeout(90)
      await page.touchscreen.tap(20, 120)
      const closedAfterOutside = await page.getByTestId('add-sheet').count() === 0
      await page.waitForTimeout(60)
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
      observations.add = { closedAfterOutside, ...await page.evaluate(() => ({ clickTimes: window.__addClicks, reopened: !!document.querySelector('[data-testid="add-sheet"]') })) }
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${out}/${label}-repeat-add.png` })
      await page.keyboard.press('Escape')
      await page.getByTestId('board-navigation').tap()
      await page.getByTestId('board-navigation-menu').waitFor()
      await page.waitForTimeout(300)
      observations.cancelledSheet = await page.getByTestId('board-navigation-menu').evaluate(async (el) => {
        const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + 8
        const send = (target, type, yy) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', clientX: x, clientY: yy, button: 0 }))
        send(el, 'pointerdown', y)
        send(window, 'pointermove', y + 100)
        send(window, 'pointercancel', y + 100)
        await new Promise(r => setTimeout(r, 220))
        return { connectedAfterCancellation: el.isConnected, transform: el.style.transform }
      })
      await page.screenshot({ path: `${out}/${label}-cancelled-sheet.png` })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('Escape')
    await page.getByTestId('zoom').click()
    await page.evaluate(() => {
      window.__cameraSamples = []
      const world = document.querySelector('[data-testid="world"]')
      const begin = performance.now()
      const sample = () => {
        window.__cameraSamples.push({ ms: performance.now() - begin, transform: getComputedStyle(world).transform })
        if (performance.now() - begin < 600) requestAnimationFrame(sample)
      }
      sample()
    })
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.waitForTimeout(650)
    observations.reducedCamera = await page.evaluate(() => ({ matches: matchMedia('(prefers-reduced-motion: reduce)').matches, samples: window.__cameraSamples }))
    await page.screenshot({ path: `${out}/${label}-reduced-zoom.png` })
    const video = page.video()
    await context.close()
    await video.saveAs(`${out}/${label}.webm`)
    results.push(observations)
    await writeFile(`${out}/observations.json`, JSON.stringify({ baselineCommit: 'c076eee2', phase, observations: results }, null, 2))
    console.log(JSON.stringify({ label, fetch: observations.fetch, add: observations.add, cancelledSheet: observations.cancelledSheet, toastTravel: observations.toast?.length ? observations.toast[0].x - observations.toast.at(-1).x : null, distinctReducedCameraTransforms: new Set(observations.reducedCamera.samples.map(s => s.transform)).size }))
  }
  await browser.close()
}
