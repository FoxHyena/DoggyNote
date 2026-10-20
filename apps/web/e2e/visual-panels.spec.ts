import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { freshBoard } from './helpers.ts'

const widths = [1440, 1024, 720, 600, 360]
const now = Date.now()
const longName = 'A-board-with-a-very-long-unbroken-name-and-a-readable-ending'

async function contained(panel: Locator, page: Page) {
  await expect(panel).toBeVisible()
  const box = (await panel.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(11)
  expect(box.y).toBeGreaterThanOrEqual(11)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 11)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 11)
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}
/** A scrolled row must never paint in the modal's top padding above its header. */
async function headerCoversTop(panel: Locator, selector: string) {
  expect(await panel.evaluate((element, headingSelector) => {
    const header = element.querySelector<HTMLElement>(headingSelector)!
    const outer = element.getBoundingClientRect(), heading = header.getBoundingClientRect()
    const top = outer.top + element.clientTop
    if (heading.top > top + 1) return false
    // Test the painted top strip at multiple columns, rather than only header visibility.
    return [0.15, 0.5, 0.85].every((fraction) => {
      const hit = document.elementFromPoint(outer.left + outer.width * fraction, top + 2)
      return !!hit && (hit === header || header.contains(hit))
    })
  }, selector)).toBe(true)
}
async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name), fullPage: true })
}
async function appearance(page: Page, theme: 'light' | 'dark') {
  await page.getByTestId('account').click()
  await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click()
  await page.keyboard.press('Escape')
}
async function openAccountPanel(page: Page, testId: string) {
  await page.getByTestId('account').click()
  await page.getByTestId(testId).click()
}

for (const theme of ['light', 'dark'] as const) {
  test(`populated sharing and export keep controls aligned and scroll safely in ${theme}`, async ({ page }, info) => {
    test.setTimeout(90_000)
    await freshBoard(page, 'Sharing layout review')
    await appearance(page, theme)
    await page.route('**/api/shares?*', (route) => route.fulfill({ json: {
      ownerId: 'review-owner', legacy: false,
      members: Array.from({ length: 12 }, (_, i) => ({ id: `member-${i}`, userId: `user-${i}`, username: `long_username_for_layout_${i}`, permission: i % 2 ? 'edit' : 'view', viaLink: true })),
      shares: Array.from({ length: 6 }, (_, i) => ({ token: `layout-token-${i}`, permission: i % 2 ? 'edit' : 'view', includeChildren: true, createdAt: now, expiresAt: now + 86400000, allowSignup: true, scopeVersion: 1 })),
    } }))
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 480 })
      await page.getByTestId('share').click()
      const panel = page.getByTestId('share-panel')
      await expect(panel.getByTestId('share-member')).toHaveCount(12)
      await contained(panel, page)
      await shot(page, info, `sharing-${theme}-${width}.png`)
      await panel.evaluate((element) => { element.scrollTop = element.scrollHeight })
      await expect(panel.getByRole('button', { name: 'Close sharing' })).toBeInViewport()
      await headerCoversTop(panel, '.share-head')
      const actions = panel.locator('.share-actions').last()
      await actions.scrollIntoViewIfNeeded()
      await expect(actions.getByRole('button', { name: 'Turn off' })).toBeInViewport()
      expect(await actions.evaluate((element) => [...element.children].every((child) => child.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1))).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('share')).toBeFocused()
      await page.getByTestId('board-more').click()
      await page.getByTestId('export').click()
      const png = page.getByTestId('export-panel')
      await contained(png, page)
      await expect(png.getByTestId('export-scope-selection')).toBeDisabled()
      await shot(page, info, `export-${theme}-${width}.png`)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('board-more')).toBeFocused()
    }
  })

  test(`populated admin and agent dialogs preserve headings and long content in ${theme}`, async ({ page }, info) => {
    test.setTimeout(90_000)
    await freshBoard(page, 'Dialog layout review')
    await appearance(page, theme)
    await page.route('**/api/users', (route) => route.fulfill({ json: { users: Array.from({ length: 16 }, (_, i) => ({ id: `review-${i}`, username: `long_username_for_layout_${i}`, isAdmin: i === 0, createdAt: now })) } }))
    await page.route('**/api/agent-connections', (route) => route.fulfill({ json: { connections: Array.from({ length: 12 }, (_, i) => ({ id: `connection-${i}`, name: `${longName}-${i}`, mode: 'propose', boardIds: ['review-board'], expiresAt: now + 86400000, revokedAt: null, lastUsedAt: null })) } }))
    await page.route('**/api/agent-connection-boards', (route) => route.fulfill({ json: { boards: Array.from({ length: 16 }, (_, i) => ({ id: `board-${i}`, label: `${longName}-${i}`, canEdit: true })) } }))
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 480 })
      await openAccountPanel(page, 'manage-people')
      const admin = page.getByTestId('people-dialog')
      await expect(admin.locator('.admin-list > li')).toHaveCount(16)
      await contained(admin, page)
      await shot(page, info, `admin-${theme}-${width}.png`)
      await admin.evaluate((element) => { element.scrollTop = element.scrollHeight })
      await expect(admin.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
      await headerCoversTop(admin, '.dialog-head')
      await page.keyboard.press('Escape')
      await openAccountPanel(page, 'manage-agents')
      const agents = page.getByTestId('agent-connections')
      await expect(agents.locator('.agents-connection')).toHaveCount(12)
      await contained(agents, page)
      await shot(page, info, `agents-form-${theme}-${width}.png`)
      await agents.locator('.agents-connection').last().scrollIntoViewIfNeeded()
      await expect(agents.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
      await headerCoversTop(agents, '.agents-heading')
      const connection = agents.locator('.agents-connection').last()
      const name = (await connection.locator('strong').boundingBox())!
      const revoke = (await connection.getByRole('button', { name: 'Revoke' }).boundingBox())!
      expect(name.x + name.width).toBeLessThanOrEqual(revoke.x)
      await shot(page, info, `agents-list-${theme}-${width}.png`)
      await page.keyboard.press('Escape')
    }
  })
}
