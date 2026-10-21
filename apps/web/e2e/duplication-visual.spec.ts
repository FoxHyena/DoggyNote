import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { MOD, freshBoard, waitForSync } from './helpers.ts'

// Real app workflows and synthetic boards only. Durable captures are opt-in;
// ordinary runs retain their images in the test's own output directory.
test.use({ deviceScaleFactor: 1 })
async function appearance(page: Page, theme: 'light' | 'dark') {
  await page.getByTestId('account').click()
  await page.getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}
async function action(page: Page, id: string) {
  await page.getByTestId('board-more').click()
  await page.getByTestId(id).click()
  await expect(page.getByTestId('templates-dialog')).toBeVisible()
}
async function capture(page: Page, info: TestInfo, width: number, theme: string, state: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const dialog = page.getByTestId('templates-dialog')
  if (await dialog.count()) {
    // Visibility begins before the phone sheet's 240ms entrance finishes.
    // Measure the settled layout while retaining the real opening animation.
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})))
    })
    const box = await dialog.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  }
  const file = `${info.project.name}-${width}-${theme}-${state}.png`
  const path = process.env.LOOP6_SHOTS ? `../../docs/qa/loop-06/${process.env.LOOP6_SHOT_ROUND ?? 'browser-round-1'}/${file}` : info.outputPath(file)
  mkdirSync(dirname(path), { recursive: true })
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(state, { path, contentType: 'image/png' })
  if (process.env.LOOP6_SHOTS) writeFileSync(`${path}.json`, JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), browser: info.project.name, viewport: page.viewportSize(), theme, state, capture: 'Isolated actual-input Playwright workflow; no physical input', round: process.env.LOOP6_SHOT_ROUND ?? 'browser-round-1' }, null, 2))
}

for (const [index, width] of [360, 600, 720, 1440].entries()) for (const theme of ['light', 'dark'] as const) {
  test(`copy and template populated states at ${width} ${theme}`, async ({ page, browser }, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const subject = ['North window lighting', 'Spring terrace lighting', 'Evening studio lighting', 'Coastal collection research'][index]
    const project = `${subject} — ${theme === 'light' ? 'warm' : 'cool'} ${info.project.name === 'webkit' ? 'editorial' : 'campaign'} direction`
    await freshBoard(page, project)
    await appearance(page, theme)
    await capture(page, info, width, theme, 'empty-source')
    await action(page, 'open-templates')
    await capture(page, info, width, theme, 'starter-library')
    await page.getByTestId('template-research').click()
    await page.getByTestId('template-name').fill(`${project} — sources, observations and questions for the next collection`)
    await capture(page, info, width, theme, 'named-research-starter')
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
    await expect(page.getByTestId('card').first()).toBeVisible()
    await waitForSync(page)
    const root = decodeURIComponent(page.url().split('#/b/')[1])
    await capture(page, info, width, theme, 'populated-research')
    await page.keyboard.press(`${MOD}+a`)
    await expect(page.getByTestId('duplicate-selection')).toBeVisible()
    await capture(page, info, width, theme, 'multiple-selection')
    await page.getByTestId('duplicate-selection').click()
    await expect(page.locator('[data-testid="card"].selected').first()).toBeVisible()
    await capture(page, info, width, theme, 'independent-selection')
    await page.keyboard.press('Escape')
    await waitForSync(page)
    await action(page, 'save-template')
    // A retry saves its own layout; a name shared with the first attempt's would match twice.
    const layoutName = `${project} — reusable references and open questions for the next collection${info.retry ? ` (retry ${info.retry})` : ''}`
    await page.getByTestId('template-name').fill(layoutName)
    await capture(page, info, width, theme, 'save-personal-layout')
    await page.getByTestId('create-from-template').click()
    // Saving and reusing a layout sync first, then fetch the complete tree from the
    // server: on the suite's shared Worker that round trip can outlast 5 seconds.
    await expect(page.getByTestId('templates-dialog')).toHaveCount(0, { timeout: 15_000 })
    await waitForSync(page)
    await action(page, 'open-templates')
    await page.getByTestId('personal-template').filter({ hasText: layoutName }).click()
    await page.getByTestId('template-name').fill(`${subject} — independent alternative`)
    await capture(page, info, width, theme, 'selected-personal-layout')
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('board-name')).toHaveText(`${subject} — independent alternative`, { timeout: 15_000 })
    await waitForSync(page)
    await capture(page, info, width, theme, 'reused-populated-layout')

    await page.route('**/copy-source', route => route.fulfill({ status: 403, json: { error: 'The complete board tree is not available to copy. No copy was created.' } }))
    await action(page, 'duplicate-board')
    await page.getByTestId('create-from-template').click()
    await expect(page.getByRole('alert')).toContainText('No copy was created')
    await capture(page, info, width, theme, 'complete-tree-denied')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.unroute('**/copy-source')
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/copy-source', async route => { await held; await route.abort().catch(() => {}) })
    try {
      await action(page, 'duplicate-board')
      await page.getByTestId('create-from-template').click()
      await expect(page.getByRole('status').filter({ hasText: 'Checking the complete board tree' })).toBeVisible()
      await capture(page, info, width, theme, 'preparing-copy')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByTestId('board-more')).toBeFocused()
    } finally { release(); await page.unroute('**/copy-source') }

    // Synthetic grant only: actual second account and isolated browser context.
    expect((await page.request.post(`/api/boards/${root}/members`, { data: { username: 'fido', permission: 'view', includeChildren: true } })).status()).toBe(201)
    const viewer = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    try {
      expect((await viewer.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
      const tab = await viewer.newPage()
      await tab.goto(`/#/b/${root}`)
      await expect(tab.getByTestId('board-permission')).toHaveText('View only')
      await appearance(tab, theme)
      await capture(tab, info, width, theme, 'read-only-source')
      await action(tab, 'duplicate-board')
      await capture(tab, info, width, theme, 'read-only-private-copy-entry')
    } finally { await viewer.close() }
  })
}
