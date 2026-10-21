import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { columnFixture } from './column-fixture.ts'
import { MOD, waitForSync } from './helpers.ts'

// Headless evidence capture only. Screenshots require separate visual review;
// this does not replace the real browser/native user tasks or their QA notes.
test('capture populated collapse states for visual review', async ({ page }, info) => {
  test.skip(!process.env.LOOP2_VISUAL_ROUND, 'Run explicitly for the required visual rounds')
  test.setTimeout(120_000)
  const round = process.env.LOOP2_VISUAL_ROUND!
  if (!['1', '2'].includes(round)) throw new Error('Visual round must be1 or2')
  const root = resolve('../../docs/qa/loop-02', `visual-round-${round}`, info.project.name)
  await mkdir(root, { recursive: true })
  const f = await columnFixture(page, 20)
  await f.toggle.click()
  await waitForSync(page)
  const captures: string[] = []
  const shot = async (name: string, target: Page = page) => {
    await target.screenshot({ path: `${root}/${name}.png` })
    captures.push(name)
  }
  for (const width of [360, 600, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      // Preferences are fixture setup. All feature actions use actual input.
      await page.evaluate((mode) => localStorage.setItem('doggynote.theme', mode), theme)
      await page.reload()
      await expect(f.toggle).toHaveAttribute('aria-expanded', 'false')
      await f.toggle.focus()
      await shot(`${width}-${theme}-collapsed-focus`)
      await f.toggle.press('Enter')
      await expect(f.column.locator('.in-column')).toHaveCount(20)
      await shot(`${width}-${theme}-expanded`)
      if (width === 720 || width === 1440) {
        await f.column.getByTestId('column-title').click()
        await page.keyboard.press('Enter')
        await expect(page.getByTestId('column-title-input')).toBeFocused()
        await shot(`${width}-${theme}-editing-title`)
        await page.keyboard.press('Escape')
      }
      await f.toggle.click()
      await expect(f.toggle).toHaveAttribute('aria-expanded', 'false')
      await waitForSync(page)
    }
  }
  await page.keyboard.press(`${MOD}+a`)
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await shot('1440-dark-multiselect')
  await page.keyboard.press('Escape')

  // Controlled failure affects only this isolated browser context's API path.
  await page.route('**/api/sync**', (route) => route.abort('failed'))
  try {
    await f.toggle.click()
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'offline', { timeout: 15_000 })
    await page.getByTestId('sync-status').click()
    await expect(page.getByTestId('sync-details')).toContainText('Retry')
    await shot('1440-dark-offline-save-details')
  } finally { await page.unroute('**/api/sync**') }
  await page.getByTestId('sync-now').click()
  await waitForSync(page)
  await page.keyboard.press('Escape')
  await f.toggle.click()
  await waitForSync(page)

  const shareResponse = await page.request.post('/api/shares', { data: { boardId: f.boardId, permission: 'view' } })
  expect(shareResponse.ok()).toBe(true)
  const { share } = await shareResponse.json()
  const context = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 720, height: 900 } })
  const reader = await context.newPage()
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  await reader.route('**/api/share/**', async (route) => { await ready; await route.continue() })
  try {
    await reader.goto(new URL(`/s/${share.token}`, page.url()).href, { waitUntil: 'domcontentloaded' })
    await expect(reader.getByTestId('loader')).toBeVisible()
    await shot('720-read-only-loading', reader)
    release()
    await expect(reader.getByTestId('column-toggle')).toHaveAttribute('aria-expanded', 'false')
    await shot('720-read-only-collapsed', reader)
    await reader.getByTestId('column-toggle').click()
    await expect(reader.locator('.in-column')).toHaveCount(20)
    await shot('720-read-only-expanded', reader)
  } finally { release(); await context.close() }

  const empty = await columnFixture(page, 0)
  await expect(empty.column.locator('.column-meta')).toHaveText('0 cards')
  await shot('1440-dark-empty-expanded')
  await empty.toggle.click()
  await shot('1440-dark-empty-collapsed')
  await writeFile(`${root}/capture-manifest.json`, JSON.stringify({
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceChanges: execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'apps', 'packages'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    round, project: info.project.name, syntheticBoardId: f.boardId, captures,
    status: 'captured; visual and manual workflow review still required',
  }, null, 2) + '\n')
})
