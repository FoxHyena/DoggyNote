import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { addNote, freshBoard, postSync } from './helpers.ts'

const widths = [1440, 1024, 720, 600, 360]
test.setTimeout(90_000)

async function withinViewport(page: Page, element: Locator) {
  await expect.poll(async () => {
    const box = await element.boundingBox()
    const viewport = page.viewportSize()!
    return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1
  }).toBe(true)
  const box = await element.boundingBox()
  expect(box).not.toBeNull()
  const viewport = page.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function setAppearance(page: Page, theme: string) {
  await page.locator('html').evaluate((element, value) => { (element as HTMLElement).dataset.theme = value }, theme)
}

async function captureAppearance(page: Page, info: TestInfo, surface: string) {
  const theme = await page.locator('html').getAttribute('data-theme')
  await page.screenshot({ path: info.outputPath(`${surface}-${theme}-${page.viewportSize()!.width}.png`), animations: 'disabled' })
}

async function captureAppearances(page: Page, info: TestInfo, surface: string) {
  const previous = await page.locator('html').getAttribute('data-theme')
  for (const theme of ['dark', 'light']) {
    await setAppearance(page, theme)
    await captureAppearance(page, info, surface)
  }
  if (previous) await setAppearance(page, previous)
}

async function seedNotes(page: Page, boardId: string, count: number, deletedAt?: number) {
  const changes = Array.from({ length: count }, (_, index) => {
    const id = crypto.randomUUID()
    return { id, patch: { id, kind: 'card', type: 'note', boardId, x: index * 300, y: 120, w: 280, h: 120, z: index, color: 'none', columnId: null, order: index, content: { md: `Layout scan ${index} — a deliberately long descriptive name that keeps its actions visible on a narrow board` }, createdAt: Date.now() } }
  })
  const response = await postSync(page.request, { data: { changes } })
  expect(response.ok(), await response.text()).toBe(true)
  if (deletedAt) {
    const deleted = await postSync(page.request, { data: { changes: changes.map(({ id }) => ({ id, patch: { deletedAt } })) } })
    expect(deleted.ok(), await deleted.text()).toBe(true)
  }
}

test('Fetch aligns supporting text and keeps keyboard results visible in short viewports', async ({ page }, info) => {
  await freshBoard(page, 'Layout scan board with a deliberately long descriptive name')
  await seedNotes(page, page.url().split('/').pop()!, 30)
  await page.reload()
  for (const theme of ['dark', 'light']) for (const width of widths) {
    await page.setViewportSize({ width, height: 480 })
    await setAppearance(page, theme)
    await page.getByTestId('open-fetch').click()
    const input = page.getByTestId('fetch-input')
    await input.fill('Layout scan')
    const fetch = page.getByTestId('fetch')
    await withinViewport(page, fetch)
    await captureAppearance(page, info, 'fetch-populated')
    const first = page.getByTestId('fetch-hit').first()
    const title = await first.locator('.fetch-title').boundingBox()
    const supporting = await first.locator('.fetch-snippet').boundingBox()
    expect(Math.abs(title!.x - supporting!.x)).toBeLessThan(1)
    expect(title!.width).toBeGreaterThan(100)
    expect(await fetch.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (let step = 0; step < 24; step++) await input.press('ArrowDown')
    await expect.poll(async () => {
      const selected = await page.getByRole('option', { selected: true }).boundingBox()
      const results = await page.getByRole('listbox').boundingBox()
      return selected!.y >= results!.y && selected!.y + selected!.height <= results!.y + results!.height + 1
    }).toBe(true)
    await input.press('Escape')
    await expect(page.getByTestId('open-fetch')).toBeFocused()
  }
})

test('populated Inbox and Buried bones keep fixed headers and action space while lists scroll', async ({ page }, info) => {
  await freshBoard(page)
  const boardId = page.url().split('/').pop()!
  const { user } = await (await page.request.get('/api/me')).json()
  await seedNotes(page, boardId, 20, Date.now())
  const inbox = await postSync(page.request, { data: { changes: [{ id: `toybox:${user.id}`, patch: { id: `toybox:${user.id}`, kind: 'board', parentId: null, title: 'Inbox', icon: 'ball', color: 'gold', createdAt: Date.now() } }] } })
  expect(inbox.ok(), await inbox.text()).toBe(true)
  await seedNotes(page, `toybox:${user.id}`, 20)
  await page.reload()
  for (const theme of ['dark', 'light']) for (const width of widths) {
    await page.setViewportSize({ width, height: 480 })
    await setAppearance(page, theme)
    for (const surface of ['toybox', 'trash'] as const) {
      // The creation rail scrolls at 480px high; Playwright scrolls its trigger into view.
      await page.getByTestId(surface === 'toybox' ? 'toybox-button' : 'tool-trash').click()
      const panel = page.getByTestId(`${surface}-panel`)
      await withinViewport(page, panel)
      const row = panel.locator('.trash-item').first()
      await expect(row).toBeVisible()
      expect(await row.locator('.trash-text').evaluate((element) => element.clientWidth)).toBeGreaterThan(60)
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await captureAppearance(page, info, `${surface}-populated`)
      const header = await panel.locator('.trash-head').boundingBox()
      await panel.locator('.trash-list').evaluate((element) => { element.scrollTop = element.scrollHeight })
      expect((await panel.locator('.trash-head').boundingBox())!.y).toBe(header!.y)
      await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
    }
  }
})

test('selection controls retain their dimensions and stay clear of floating canvas controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 480 })
  await freshBoard(page)
  await addNote(page, 'Selection layout review', 0.5, 0.7)
  const bar = page.getByTestId('selection-bar')
  await withinViewport(page, bar)
  await captureAppearances(page, info, 'selection')
  const canvas = await page.getByTestId('canvas').boundingBox()
  const box = await bar.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(canvas!.x)
  expect(box!.x + box!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width)
  expect((await bar.locator('.swatch').first().boundingBox())!.width).toBe(22)
  if (await bar.evaluate((el) => el.classList.contains('docked'))) {
    // Phone width: the bar docks along the bottom and the canvas controls step aside.
    await expect(page.getByTestId('canvas-controls')).toBeHidden()
  } else {
    const controls = await page.getByTestId('canvas-controls').boundingBox()
    expect(box!.x + box!.width <= controls!.x || controls!.x + controls!.width <= box!.x || box!.y + box!.height <= controls!.y || controls!.y + controls!.height <= box!.y).toBe(true)
  }
  await page.getByTestId('bury').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('bury')).toBeInViewport()
})

test('creation tools respond to keyboard activation', async ({ page }, info) => {
  await freshBoard(page)
  await page.getByTestId('tool-note').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.type('Created from the keyboard')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('card')).toContainText('Created from the keyboard')
})

test('signup and editing invitations scroll all controls into view in short windows', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const recipient = await context.newPage()
    await recipient.route('**/api/auth/invite/visual-layout', (route) => route.fulfill({ json: { expiresAt: Date.now() + 86400000 } }))
    await recipient.route('**/api/share/visual-layout', (route) => route.fulfill({ json: { permission: 'edit', boardId: 'visual-layout-board', title: 'An editing invitation with a deliberately long board name that must wrap', allowSignup: true, includeChildren: true, expiresAt: Date.now() + 86400000 } }))
    for (const theme of ['dark', 'light']) for (const width of widths) {
      await recipient.setViewportSize({ width, height: 480 })
      for (const path of ['/signup/visual-layout', '/join/visual-layout']) {
        await recipient.goto(path)
        const form = recipient.getByTestId(path.startsWith('/signup') ? 'signup-form' : 'login-form')
        await expect(form).toBeVisible()
        await setAppearance(recipient, theme)
        const submit = form.getByRole('button', { name: path.startsWith('/signup') ? 'Create account' : 'Sign in', exact: true })
        await submit.scrollIntoViewIfNeeded()
        await expect(submit).toBeInViewport()
        await captureAppearance(recipient, info, path.startsWith('/signup') ? 'signup-submit' : 'invitation-submit')
        expect(await recipient.locator('.login').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        const username = form.getByLabel('Username', { exact: true })
        await username.scrollIntoViewIfNeeded()
        await expect(username).toBeInViewport()
        expect((await username.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await captureAppearance(recipient, info, path.startsWith('/signup') ? 'signup-heading' : 'invitation-heading')
      }
    }
  } finally { await context.close() }
})

test('quick capture leaves room for status in a short window', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 200 })
  await page.goto('/#/capture')
  await expect(page.getByTestId('capture-input')).toBeVisible()
  await page.getByTestId('capture-input').fill('A quick thought')
  await withinViewport(page, page.getByTestId('capture-status'))
  await withinViewport(page, page.getByTestId('capture-input'))
  await captureAppearances(page, info, 'capture')
})

test('touch comments preserve the canvas origin and show long author metadata after toolbar scrolling', async ({ page, browser }, info) => {
  const username = `visual_author_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
  const password = 'visual-comment-password'
  const created = await page.request.post('/api/users', { data: { username, password } })
  expect(created.status(), await created.text()).toBe(201)
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 360, height: 640 }, hasTouch: true })
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).ok()).toBe(true)
    const accessResponse = await context.request.get('/api/access')
    expect(accessResponse.ok(), await accessResponse.text()).toBe(true)
    const { homeBoardId } = await accessResponse.json()
    const boardId = crypto.randomUUID()
    const board = await postSync(context.request, { data: { changes: [{ id: boardId, patch: { id: boardId, kind: 'board', parentId: homeBoardId, title: 'Long author comment layout review', icon: 'paw', color: 'gold', createdAt: Date.now() } }] } })
    expect(board.ok(), await board.text()).toBe(true)
    const touch = await context.newPage()
    await touch.goto(`/#/b/${boardId}`)
    await expect(touch.getByTestId('canvas')).toBeVisible()
    await expect(touch.getByTestId('board-name')).toHaveText('Long author comment layout review')
    await addNote(touch, 'Weekend plans and a deliberately long contextual card title', 0.5, 0.5)
    const commentAction = touch.getByTestId('comment-button')
    // Reproduce the review path: reveal a trailing action in the touch selection bar.
    await commentAction.scrollIntoViewIfNeeded()
    await commentAction.click()
    const panel = touch.getByTestId('comments-panel')
    await expect(panel).toBeVisible()
    const input = touch.getByTestId('comment-input')
    await input.fill('The trail looks good. Meet by the entrance at 10:30, and bring the map. A long unbroken marker: ' + 'trail'.repeat(24))
    await touch.getByTestId('comment-send').click()
    await expect(panel.getByTestId('comment')).toHaveCount(1)
    for (const theme of ['dark', 'light']) {
      await setAppearance(touch, theme)
      await withinViewport(touch, panel)
      const canvas = await touch.getByTestId('canvas').boundingBox()
      const bounds = await panel.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(canvas!.x)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1)
      expect(await touch.locator('.stage').evaluate((element) => element.scrollLeft)).toBe(0)
      for (const content of [panel.getByRole('heading', { name: 'Comments', exact: true }), panel.locator('.comment-author'), panel.locator('.comment-time'), panel.locator('.comment-text'), panel.getByTestId('comments-close')]) {
        const box = await content.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(bounds!.x)
        expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
      }
      await expect(panel.locator('.comment-author')).toHaveText(username)
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect((await touch.getByTestId('comment-edit').boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await captureAppearance(touch, info, 'comments-touch-long-author')
    }
  } finally { await context.close() }
})
