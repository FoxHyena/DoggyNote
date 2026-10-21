import { expect, test, type Browser, type Page, type Route } from '@playwright/test'
import { MOD, addNote, cardByText, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

const surface = (page: Page) => page.getByTestId('focus-surface')
const editor = (page: Page) => surface(page).getByTestId('note-editor')
const noteId = async (page: Page) => page.getByTestId('card').first().getAttribute('data-card-id')
async function stored(page: Page, id: string) {
  await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  return objects.find((o: { id: string }) => o.id === id)?.content.md
}
async function focus(page: Page) {
  await page.getByTestId('focus-note').click()
  await expect(surface(page)).toBeVisible()
  await expect(editor(page)).toBeFocused()
  await expect(page.getByTestId('note-editor')).toHaveCount(1)
}

/**
 * The current board in a new context whose editor chunk goes through `handler`.
 * Boot warms the editor chunk, and WebKit serves a reload from its memory cache
 * without consulting routes, so the route has to exist before the first load.
 */
async function pageWithEditorRoute(page: Page, browser: Browser, handler: (route: Route) => Promise<void> | void) {
  const context = await browser.newContext({ storageState: await page.context().storageState(), extraHTTPHeaders: { 'x-doggynote-protocol': '2' } })
  await context.route('**/codemirror-*.js', handler)
  const fresh = await context.newPage()
  await fresh.goto(page.url())
  await expect(fresh.getByTestId('canvas')).toBeVisible()
  return fresh
}

test.beforeEach(async ({ page }) => { await freshBoard(page, `Focused writing ${crypto.randomUUID().slice(0, 6)}`) })

test('expand existing note, continue Markdown, return to same item, undo and reopen', async ({ page }) => {
  await addNote(page, 'Project brief')
  const id = (await noteId(page))!
  await focus(page)
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Research')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- first finding')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second finding')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[Source](https://example.com) and `code`')
  await page.keyboard.press('Escape')
  await expect(surface(page)).toHaveCount(0)
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeFocused()
  await expect(page.getByTestId('card')).toHaveCount(1)
  const md = await stored(page, id)
  expect(md).toContain('## Research\n- first finding\n- second finding')
  const card = page.locator(`[data-card-id="${id}"]`)
  await expect(card.locator('h2')).toHaveText('Research')
  await expect(card.locator('a')).toHaveAttribute('href', 'https://example.com/')
  await expect(card.locator('code')).toHaveText('code')
  await page.keyboard.press(`${MOD}+z`)
  await expect(card).toContainText('Project brief')
  await expect(card.locator('h2')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(card.locator('h2')).toHaveText('Research')
  await focus(page)
  await expect(editor(page)).toContainText('second finding')
  await surface(page).getByTestId('focus-return').click()
  await waitForSync(page)
  await page.reload()
  await card.click()
  await focus(page)
  await expect(editor(page)).toContainText('Research')
})

test('inline caret/history transfer and repeated focus cycles retain active text', async ({ page }) => {
  await addNote(page, 'alpha omega')
  const id = (await noteId(page))!
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+Home`)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('Z')
  await focus(page)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('Y')
  await expect(editor(page)).toContainText('aZYlpha omega')
  await page.keyboard.press(`${MOD}+z`)
  await expect(editor(page)).toContainText('aZlpha omega')
  await page.keyboard.press('Escape')
  for (let i = 0; i < 4; i++) {
    await focus(page)
    await page.keyboard.type(String(i))
    await surface(page).getByTestId('focus-return').click()
  }
  expect(await stored(page, id)).toBe('aZ0123lpha omega')
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible()
  await expect(page.getByTestId('card')).toHaveCount(1)
})

test('save details dismiss before writing; keyboard navigation stays inside and returns', async ({ page }) => {
  await addNote(page, 'Menu escape')
  await focus(page)
  await surface(page).getByTestId('sync-status').click()
  await expect(surface(page).getByTestId('sync-details')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(surface(page).getByTestId('sync-details')).toHaveCount(0)
  await expect(surface(page)).toBeVisible()
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    expect(await surface(page).evaluate((el) => ({ contained: el.contains(document.activeElement), active: document.activeElement?.outerHTML.slice(0, 200) }))).toMatchObject({ contained: true })
  }
  await page.keyboard.press('Escape')
  await expect(surface(page)).toHaveCount(0)
  await expect(page.getByTestId('card')).toBeFocused()
})

test('long text preserves focus scroll/caret and saves offline through reload/reconnect', async ({ page, context }) => {
  const id = crypto.randomUUID()
  const md = '# A long brief\n\n' + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: Readable research with **emphasis** and a useful [source](https://example.com).`).join('\n\n')
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { id, kind: 'card', type: 'note', boardId: decodeURIComponent(page.url().split('#/b/')[1]), x: 0, y: 0, w: 280, h: 100, z: 1, color: 'none', createdAt: Date.now(), content: { md } } }] } })).ok()).toBe(true)
  await page.reload()
  // Fit a long card can use overview mode; zoom to 100% for actual input.
  await page.keyboard.press(`${MOD}+0`)
  await page.getByTestId('card').first().click({ position: { x: 40, y: 20 } })
  await focus(page)
  await page.keyboard.press(`${MOD}+Home`)
  for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.type('CARET')
  const scroll = await surface(page).locator('.cm-scroller').evaluate((el) => el.scrollTop)
  expect(scroll).toBeGreaterThan(100)
  await page.keyboard.press('Escape')
  await focus(page)
  await expect.poll(() => surface(page).locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBeGreaterThan(scroll - 80)
  await page.keyboard.type('RESUMED')
  await context.setOffline(true)
  await page.keyboard.type('OFFLINE')
  await surface(page).getByTestId('focus-return').click()
  // IndexedDB checkpoint, not the server, must carry the active text.
  await expect.poll(() => page.evaluate(async (id) => {
    const req = indexedDB.open('doggynote')
    return await new Promise<string>((resolve) => { req.onsuccess = () => { const db = req.result; const read = db.transaction('objects').objectStore('objects').get(id); read.onsuccess = () => { db.close(); resolve(read.result?.content?.md ?? '') }; read.onerror = () => resolve('') }; req.onerror = () => resolve('') })
  }, id)).toContain('CARETRESUMEDOFFLINE')
  await context.setOffline(false)
  await page.reload()
  await page.keyboard.press(`${MOD}+0`)
  expect(await stored(page, id)).toContain('CARETRESUMEDOFFLINE')
})

test('read-only shared notes open safely in large reading view', async ({ page, browser }) => {
  await addNote(page, 'Readable brief')
  const id = (await noteId(page))!
  await focus(page)
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.insertText('Readable **brief**')
  await page.keyboard.press('Escape')
  expect(await stored(page, id)).toBe('Readable **brief**')
  const boardId = decodeURIComponent(page.url().split('#/b/')[1])
  const { share } = await (await page.request.post('/api/shares', { data: { boardId, permission: 'view' } })).json()
  const reader = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const view = await reader.newPage()
    await view.goto(`/s/${share.token}`)
    await view.getByTestId('focus-note').click()
    await expect(surface(view)).toContainText('Focused reading')
    await expect(surface(view).locator('strong')).toHaveText('brief')
    await expect(view.getByTestId('note-editor')).toHaveCount(0)
    await expect(surface(view).getByTestId('task-check')).toHaveCount(0)
    await view.keyboard.type('cannot write')
    await view.keyboard.press('Escape')
    await expect(surface(view)).toHaveCount(0)
  } finally { await reader.close() }
})

test('an empty new note can enter focus and rapid dismissal keeps the last character', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('note-editor')).toBeFocused()
  const id = (await noteId(page))!
  await focus(page)
  await page.keyboard.type('A')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('card')).toContainText('A')
  expect(await stored(page, id)).toBe('A')
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('card')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.getByTestId('card')).toContainText('A')
  await focus(page)
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  // Existing notes remain intentional empty notes; only brand-new empty notes disappear.
  await expect(page.getByTestId('card')).toHaveCount(1)
  expect(await stored(page, id)).toBe('')
})

test('typing and closing during editor loading checkpoints active Markdown', async ({ page: board, browser }) => {
  // Delay only the isolated page's editor chunk; the application remains usable.
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const page = await pageWithEditorRoute(board, browser, async (route) => { await held; await route.continue() })
  try {
    const box = (await page.getByTestId('canvas').boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByLabel('Note loading')).toBeFocused()
    await page.keyboard.type('Text before loading')
    await page.getByTestId('focus-note').click()
    await expect(surface(page).getByLabel('Note loading')).toBeFocused()
    await page.keyboard.type(' plus final text')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('card')).toContainText('Text before loading plus final text')
    const id = (await noteId(page))!
    expect(await stored(page, id)).toBe('Text before loading plus final text')
    release()
  } finally {
    release()
    // Wait for the held handler to finish before Playwright removes routes.
    await page.context().unrouteAll({ behavior: 'wait' })
    await page.context().close()
  }
})

test('failed formatting load offers editable Markdown with the same durable save path', async ({ page: board, browser }) => {
  const page = await pageWithEditorRoute(board, browser, (route) => route.abort('failed'))
  try {
    const box = (await page.getByTestId('canvas').boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('status').filter({ hasText: 'Formatting is unavailable' })).toBeVisible()
    await page.getByLabel('Note Markdown').fill('Fallback Markdown')
    await page.getByTestId('focus-note').click()
    await expect(surface(page).getByLabel('Note Markdown')).toBeVisible()
    await surface(page).getByLabel('Note Markdown').fill('# Fallback brief\n\nStill saved.')
    await surface(page).getByTestId('focus-return').click()
    const id = (await noteId(page))!
    expect(await stored(page, id)).toBe('# Fallback brief\n\nStill saved.')
    await expect(page.getByTestId('card').locator('h1')).toHaveText('Fallback brief')
  } finally {
    await page.context().close()
  }
})

test('focused document stays readable inside the viewport at 360, 600, 720 and 1440 in both themes', async ({ page }, info) => {
  await page.getByTestId('account').click()
  await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('radio', { name: 'System', exact: true }).click()
  await page.keyboard.press('Escape')
  await addNote(page, 'Responsive project brief')
  await focus(page)
  await page.keyboard.press(`${MOD}+a`)
  const md = '# Project brief\n\nResearch notes with a [source](https://example.com/research/project-brief) and `code`.\n\n- A useful finding\n  - Nested evidence\n\nA comfortable writing surface keeps the board context nearby.'
  // Paste literal Markdown; typed Enter has separate list-continuation coverage.
  await page.keyboard.insertText(md)
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    for (const width of [360, 600, 720, 1440]) {
      await page.setViewportSize({ width, height: width === 720 ? 480 : 900 })
      const box = (await surface(page).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      await expect(surface(page).getByTestId('focus-return')).toBeInViewport()
      const metrics = await surface(page).locator('.cm-scroller').evaluate((el) => ({ width: el.clientWidth, overflow: el.scrollWidth - el.clientWidth, height: el.clientHeight }))
      expect(metrics.width).toBeGreaterThan(width === 360 ? 240 : 400)
      expect(metrics.overflow).toBeLessThanOrEqual(1)
      expect(metrics.height).toBeGreaterThan(200)
      if (process.env.FOCUS_SHOTS) await page.screenshot({ path: info.outputPath(`focus-${theme}-${width}.png`), scale: 'css' })
    }
  }
  await surface(page).getByTestId('focus-return').click()
  await expect(page.getByTestId('card')).toHaveCount(1)
  expect(await stored(page, (await noteId(page))!)).toBe(md)
  await expect(page.getByTestId('card').locator('a')).toHaveAttribute('href', 'https://example.com/research/project-brief')
})
