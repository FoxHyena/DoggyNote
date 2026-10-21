import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { freshBoard, waitForSync } from './helpers.ts'

test.use({ storageState: { cookies: [], origins: [] } })

async function captureFlow(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo, state: string) {
  if (!process.env.DOCS_SHOTS) return
  const folder = `../../docs/qa/docs-foundation/${process.env.DOCS_SHOT_ROUND ?? 'round-1'}`
  mkdirSync(folder, { recursive: true })
  const observeMenu = state === 'mobile-menu-while-reading' || state === 'mobile-reading-before-menu'
  if (observeMenu) await page.evaluate(() => {
    const events: unknown[] = []
    const button = document.querySelector('.docs-menu-toggle')!
    const desktop = matchMedia('(min-width: 801px)')
    const record = (type: string, target?: EventTarget | null) => events.push({
      type, at: performance.now(), width: innerWidth, height: innerHeight,
      visualWidth: visualViewport?.width, visualHeight: visualViewport?.height,
      desktop: desktop.matches, scrollY, expanded: button.getAttribute('aria-expanded'),
      documentHasFocus: document.hasFocus(),
      activeElement: document.activeElement?.outerHTML.slice(0, 500),
      eventTarget: target instanceof Element ? target.outerHTML.slice(0, 500) : null,
    })
    const cleanups: (() => void)[] = []
    const listen = (target: EventTarget, type: string) => {
      const handler = (event: Event) => { record(type, event.target) }
      target.addEventListener(type, handler, true)
      cleanups.push(() => target.removeEventListener(type, handler, true))
    }
    for (const type of ['focusin', 'focusout', 'pointerdown', 'visibilitychange']) listen(document, type)
    for (const type of ['resize', 'focus', 'blur', 'hashchange']) listen(window, type)
    if (visualViewport) listen(visualViewport, 'resize')
    listen(desktop, 'change')
    const observer = new MutationObserver(() => { record('aria-expanded mutation') })
    observer.observe(button, { attributes: true, attributeFilter: ['aria-expanded'] })
    const headObserver = new MutationObserver(changes => {
      for (const change of changes) {
        for (const node of Array.from(change.addedNodes)) if (node instanceof HTMLStyleElement) record(`style added: ${node.textContent?.slice(0, 100)}`, node)
        for (const node of Array.from(change.removedNodes)) if (node instanceof HTMLStyleElement) record(`style removed: ${node.textContent?.slice(0, 100)}`, node)
      }
    })
    headObserver.observe(document.head, { childList: true })
    record('before screenshot')
    ;(window as typeof window & { __docsCaptureTrace?: () => unknown[] }).__docsCaptureTrace = () => {
      record('after screenshot')
      observer.disconnect()
      headObserver.disconnect()
      cleanups.forEach(cleanup => cleanup())
      return events
    }
  })
  try {
    await page.screenshot({ path: `${folder}/${testInfo.project.name}-flow-${state}.png`, fullPage: false })
  } finally {
    if (observeMenu) {
      const events = await page.evaluate(() => {
        const diagnosticWindow = window as typeof window & { __docsCaptureTrace?: () => unknown[] }
        const result = diagnosticWindow.__docsCaptureTrace?.()
        delete diagnosticWindow.__docsCaptureTrace
        return result
      }).catch(error => ({ diagnosticError: String(error) }))
      console.log('DOCS_MENU_CAPTURE_EVENTS', state, JSON.stringify(events))
      await testInfo.attach(`docs-${state}-capture-events`, { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
    }
  }
  writeFileSync(`${folder}/revision.txt`, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }))
}

async function expectFocusWithDiagnostics(locator: import('@playwright/test').Locator, step: string) {
  try { await expect(locator).toBeFocused() }
  catch (error) {
    const state = await locator.evaluate(element => ({
      expectedIsActive: element.getRootNode() instanceof Document && (element.getRootNode() as Document).activeElement === element,
      documentHasFocus: element.ownerDocument.hasFocus(),
      visibility: element.ownerDocument.visibilityState,
      expectedConnected: element.isConnected,
      activeElement: element.ownerDocument.activeElement?.outerHTML.slice(0, 1000),
    })).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }))
    console.log('DOCS_FOCUS_FAILURE', step, JSON.stringify(state))
    await test.info().attach(step, { body: JSON.stringify(state, null, 2), contentType: 'application/json' })
    throw error
  }
}

test('anonymous docs deep links never load the editor or request private APIs', async ({ page }) => {
  const api: string[] = [], editor: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url())
    if (/\/assets\/App-[^/]+\.js|\/src\/App\.tsx/.test(request.url())) editor.push(request.url())
  })
  await page.goto('/docs/explore-the-docs?join=synthetic&inbox=1#jump-to-a-section')
  await expect(page.getByRole('heading', { name: 'Find your way around', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('#jump-to-a-section')).toBeInViewport()
  await expect(page.locator('.stage, .canvas, .login-form')).toHaveCount(0)
  expect(api).toEqual([]); expect(editor).toEqual([])
})

test('app share requests retain the illustrated loader outside the public docs boundary', async ({ page }, testInfo) => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/share/docs-loader-regression', async route => {
    await held
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic missing share' }) })
  })
  try {
    await page.goto('/s/docs-loader-regression', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('loader')).toBeVisible()
    await expect(page.getByTestId('loader').locator('svg')).toBeVisible()
    await captureFlow(page, testInfo, 'existing-share-loader')
    release()
    await expect(page.getByTestId('share-gone')).toBeVisible()
    await expect(page.locator('.docs-shell')).toHaveCount(0)
  } finally { release() }
})

test('a pending local app resource keeps the mounted board and its dialog visible', async ({ page }, testInfo) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })).ok()).toBe(true)
  await freshBoard(page, 'Docs bootstrap local resource regression')
  await waitForSync(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let requested!: () => void
  const reached = new Promise<void>(resolve => { requested = resolve })
  await page.route('**/api/shares?**', async route => { requested(); await held; await route.continue() })
  try {
    await page.getByTestId('share').click()
    await reached
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('share-panel')).toBeVisible()
    await expect(page.getByTestId('share-panel').getByRole('status')).toBeVisible()
    await expect(page.getByTestId('loader')).toHaveCount(0)
    await captureFlow(page, testInfo, 'local-sharing-resource')
    release()
    await expect(page.getByTestId('share-panel').getByRole('status')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close sharing' }).click()
    await expect(page.getByTestId('share-panel')).toHaveCount(0)
    await expect(page.getByTestId('canvas')).toBeVisible()
  } finally { release() }
})

test('landing search, guide, anchor, related and browser history form a complete flow', async ({ page }, testInfo) => {
  await page.goto('/docs')
  const search = page.getByRole('searchbox', { name: 'Find a guide' })
  await search.fill('nothing matches this')
  await expect(page.getByRole('heading', { name: /No guides match/ })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await search.fill('bearings')
  // Search is intentionally titles/summaries, not the marketing intro.
  await expect(page.getByRole('heading', { name: /No guides match/ })).toBeVisible()
  await search.fill('Find your way')
  await page.locator('.docs-guide-card').click()
  await page.locator('.docs-toc:visible').getByRole('link', { name: 'Jump to a section' }).click()
  await expect(page).toHaveURL(/#jump-to-a-section$/)
  await expect(page.locator('#jump-to-a-section')).toBeInViewport()
  await captureFlow(page, testInfo, 'section-anchor')
  await page.getByRole('navigation', { name: 'Related guides' }).getByRole('link', { name: /Read comfortably/ }).click()
  await expect(page.getByRole('heading', { name: 'Read comfortably', exact: true })).toBeVisible()
  await captureFlow(page, testInfo, 'related-guide')
  await page.goBack()
  await expect(page).toHaveURL(/explore-the-docs#jump-to-a-section$/)
  await page.goForward()
  await expect(page).toHaveURL(/reading-and-appearance$/)
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Documentation' }).click()
  await expect(page.getByRole('heading', { name: 'Start exploring' })).toBeVisible()
})

test('mobile menu closes with Escape and restores focus; skip link reaches main', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/docs')
  const button = page.getByRole('button', { name: /^(Browse|Close) guides$/ })
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Find your way around' }).focus()
  await page.keyboard.press('Escape')
  await expectFocusWithDiagnostics(button, 'menu-escape-trigger-focus')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await button.click()
  await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Find your way around' }).click()
  await expect(page.getByRole('button', { name: 'Browse guides' })).toHaveAttribute('aria-expanded', 'false')
  await page.goto('/docs')
  await expect(page.getByRole('heading', { name: 'Start exploring' })).toBeVisible()
  // Safari on macOS uses Option–Tab for links under its default keyboard policy.
  // Do not change global browser/OS preferences or force-focus the skip link.
  const nextItem = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  await page.keyboard.press(nextItem)
  await expectFocusWithDiagnostics(page.getByRole('link', { name: 'Skip to content' }), 'skip-link-first-focus')
  await page.keyboard.press('Enter')
  await expectFocusWithDiagnostics(page.locator('#docs-main'), 'skip-link-main-focus')
})

test('mobile navigation opens in view from the middle of a guide without losing reading position', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/docs/explore-the-docs#keep-your-place')
  await expect(page.locator('#keep-your-place')).toBeInViewport()
  // Capture the reading baseline before interacting. The retained WebKit trace
  // shows screenshot preparation can apply pending native fragment focus; do
  // not let the first capture occur halfway through the menu interaction.
  await captureFlow(page, testInfo, 'mobile-reading-before-menu')
  const position = await page.evaluate(() => scrollY)
  const headerHeight = await page.locator('.docs-header').evaluate(el => el.getBoundingClientRect().height)
  await page.getByRole('button', { name: 'Browse guides' }).click()
  const navigation = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(navigation.getByRole('link', { name: 'Documentation home' })).toBeInViewport()
  await expectFocusWithDiagnostics(navigation.getByRole('link', { name: 'Documentation home' }), 'scrolled-menu-initial-focus')
  expect(await page.locator('.docs-header').evaluate(el => el.getBoundingClientRect().height)).toBe(headerHeight)
  expect(await page.evaluate(() => scrollY)).toBe(position)
  await captureFlow(page, testInfo, 'mobile-menu-while-reading')
  await expect(page.getByRole('button', { name: 'Close guides' })).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expectFocusWithDiagnostics(page.getByRole('button', { name: 'Browse guides' }), 'scrolled-menu-escape-trigger-focus')
  await expect(page.locator('#keep-your-place')).toBeInViewport()
  await page.getByRole('button', { name: 'Browse guides' }).click()
  await page.locator('#docs-main').focus()
  await expect(page.getByRole('button', { name: 'Browse guides' })).toHaveAttribute('aria-expanded', 'false')
})

test('appearance persists, missing docs stay public and the login entry still works', async ({ page }) => {
  await page.goto('/docs/reading-and-appearance')
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/docs/no-such-guide')
  await expect(page.getByRole('heading', { name: 'Let’s find your way back.' })).toBeVisible()
  await expect(page.getByTestId('login-form')).toHaveCount(0)
  await page.goto('/')
  await expect(page.getByTestId('login-form')).toBeVisible()
  await page.getByRole('link', { name: 'Read the documentation' }).click()
  await expect(page).toHaveURL(/\/docs$/)
})

for (const width of [360, 600, 720, 1440]) for (const mode of ['light','dark'] as const) {
  test(`docs responsive reading ${width} ${mode}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/docs')
    await page.getByRole('combobox', { name: 'Appearance' }).selectOption(mode)
    for (const [path, state] of [['/docs','landing'],['/docs/explore-the-docs','guide']] as const) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (process.env.DOCS_SHOTS) {
        const folder = `../../docs/qa/docs-foundation/${process.env.DOCS_SHOT_ROUND ?? 'round-1'}`
        mkdirSync(folder, { recursive: true })
        await page.screenshot({ path: `${folder}/${testInfo.project.name}-${width}-${mode}-${state}.png`, fullPage: true })
        writeFileSync(`${folder}/revision.txt`, execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }))
      }
    }
  })
}
