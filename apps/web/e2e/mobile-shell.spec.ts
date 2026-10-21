import { expect, test, type Locator, type Page } from '@playwright/test'
import { cardByText, freshBoard, postSync, waitForSync } from './helpers.ts'
import { Fingers, center, longPress, note, seedCards, tapOn } from './touch.ts'

// The phone shell: a thumb dock instead of the rail, an Add sheet, menus and
// panels as bottom sheets that never spill off the screen.
test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' })

async function sheetGeometry(sheet: Locator) {
  return sheet.evaluate(el => {
    const r = el.getBoundingClientRect(), css = getComputedStyle(el)
    return { testId: el.getAttribute('data-testid'), className: el.className,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
      position: css.position, inset: css.inset, width: css.width, height: css.height, maxHeight: css.maxHeight,
      padding: css.padding, overflow: css.overflow, zIndex: css.zIndex,
      viewport: { width: innerWidth, height: innerHeight },
      stylesheets: [...document.styleSheets].map(s => s.href) }
  })
}

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

/** Resting sheet geometry: full width, on the bottom edge, nothing hanging off the sides. */
async function isSheet(page: Page, sheet: Locator) {
  await expect(sheet).toBeVisible()
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))))
  await test.info().attach('phone-sheet-computed-geometry', { body: JSON.stringify(await sheetGeometry(sheet), null, 2), contentType: 'application/json' })
  const box = (await sheet.boundingBox())!
  const vp = page.viewportSize()!
  expect(Math.abs(box.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.x + box.width - vp.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y + box.height - vp.height)).toBeLessThanOrEqual(1)
  expect(box.y).toBeGreaterThan(40)
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
}

test('the dock replaces the tool rail and everything fits across the screen', async ({ page }) => {
  await expect(page.getByTestId('mobile-dock')).toBeVisible()
  await expect(page.locator('aside.toolbar')).toHaveCount(0)
  const vp = page.viewportSize()!
  for (const id of ['board-navigation', 'open-fetch', 'dock-add', 'toybox-button', 'tool-trash', 'board-name', 'share', 'board-more', 'account']) {
    const b = (await page.getByTestId(id).boundingBox())!
    expect(b.x, id).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width, id).toBeLessThanOrEqual(vp.width + 1)
    expect(b.height, `${id} is a thumb-sized target`).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('the Add sheet makes each kind of card', async ({ page }) => {
  for (const [kind, ready] of [
    ['add-note', page.getByTestId('note-editor')],
    ['add-todo', page.locator('.todo-title-input')],
    ['add-column', page.getByTestId('column-title-input')],
    ['add-link', page.getByTestId('link-input')],
  ] as const) {
    await page.getByTestId('dock-add').tap()
    await isSheet(page, page.getByTestId('add-sheet'))
    await page.getByTestId(kind).tap()
    await expect(page.getByTestId('add-sheet')).toHaveCount(0)
    await expect(ready).toBeVisible()
    await expect(ready).toBeFocused()
    if (kind === 'add-note') await page.keyboard.type('From the sheet')
    if (kind === 'add-column') await page.keyboard.type('Ideas')
    if (await page.getByTestId('edit-done').isVisible()) await page.getByTestId('edit-done').tap()
    else await page.keyboard.press('Escape')
  }
  await expect(cardByText(page, 'From the sheet')).toBeVisible()
  await expect(cardByText(page, 'Ideas')).toBeVisible()
  await page.getByTestId('dock-add').tap()
  await page.getByTestId('add-board').tap()
  await expect(page.locator('.card-board')).toHaveCount(1)
})

test('photos come from the Add sheet', async ({ page }) => {
  await page.getByTestId('dock-add').tap()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-photo').tap()
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 48)
    c.getContext('2d')!.fillRect(0, 0, 64, 48)
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  })
  await (await chooser).setFiles({ name: 'pup.png', mimeType: 'image/png', buffer: Buffer.from(png) })
  await expect(page.getByTestId('card-image')).toBeVisible()
})

test('menus and panels open as sheets that stay on screen', async ({ page }) => {
  await seedCards(page, [note('Sheet check', 0, 0)])
  const sheets: [string, string][] = [
    ['board-navigation', 'board-navigation-menu'],
    ['account', '.account-popover'],
    ['board-more', 'board-actions-menu'],
    ['share', 'share-panel'],
    ['toybox-button', 'toybox-panel'],
    ['tool-trash', 'trash-panel'],
    ['zoom', '.canvas-zoom .menu'],
    ['sync-status', 'sync-details'],
  ]
  for (const [trigger, sheet] of sheets) {
    await page.getByTestId(trigger).tap()
    const loc = sheet.startsWith('.') ? page.locator(sheet) : page.getByTestId(sheet)
    await isSheet(page, loc)
    await page.keyboard.press('Escape')
    await expect(loc).toHaveCount(0)
  }
})

test('a sheet pulled down by its grip closes', async ({ page }) => {
  await page.getByTestId('board-navigation').tap()
  const sheet = page.getByTestId('board-navigation-menu')
  await isSheet(page, sheet)
  const b = (await sheet.boundingBox())!
  const f = new Fingers(page)
  // Synthetic WebKit touches go to the element under the finger, as a real one would.
  await f.press(0, { x: b.x + b.width / 2, y: b.y + 8 })
  for (let i = 1; i <= 6; i++) await f.move(0, { x: b.x + b.width / 2, y: b.y + 8 + i * 30 })
  await f.release(0)
  await expect(sheet).toHaveCount(0)
})

test('selecting a card docks the actions along the bottom', async ({ page }) => {
  await seedCards(page, [note('Docked', 0, 0)])
  await tapOn(page, cardByText(page, 'Docked'))
  const bar = page.getByTestId('selection-bar')
  await expect(bar).toHaveClass(/docked/)
  await isSheet(page, bar)
  await expect(page.getByTestId('canvas-controls')).toBeHidden()
  await page.getByTestId('swatch-sky').tap()
  await expect(cardByText(page, 'Docked')).toHaveClass(/colored/)
  await page.getByTestId('selection-done').tap()
  await expect(bar).toHaveCount(0)
})

test('Connect in the bar ties two cards together', async ({ page }) => {
  await seedCards(page, [note('Leash', 0, 0, { w: 140 }), note('Walk', 0, 160, { w: 140 })])
  await tapOn(page, cardByText(page, 'Leash'))
  // Phones keep Connect in the More sheet, so the bar fits.
  await page.getByTestId('selection-more').tap()
  await page.getByTestId('connect-card').tap()
  await expect(page.getByTestId('connect-banner')).toBeVisible()
  await tapOn(page, cardByText(page, 'Walk'))
  await expect(page.getByTestId('connection')).toHaveCount(1)
  await expect(page.getByTestId('connect-banner')).toHaveCount(0)
  await waitForSync(page)
})

test('Select more picks several cards for one action', async ({ page }) => {
  await seedCards(page, [note('One', 0, 0, { w: 120 }), note('Two', 160, 0, { w: 120 }), note('Three', 0, 140, { w: 120 })])
  await tapOn(page, cardByText(page, 'One'))
  await page.getByTestId('selection-more').tap()
  await page.getByTestId('select-more').tap()
  await tapOn(page, cardByText(page, 'Two'))
  await tapOn(page, cardByText(page, 'Three'))
  await expect(page.locator('.card.selected')).toHaveCount(3)
  await expect(page.getByTestId('selection-more')).toContainText('3 picked')
  await page.getByTestId('bury').tap()
  await expect(page.getByTestId('card')).toHaveCount(0)
})

test('the back chevron goes up a level', async ({ page }) => {
  const parent = page.url().split('/').at(-1)!
  const parentName = (await page.getByTestId('board-name').textContent())!
  const child = crypto.randomUUID()
  const created = await postSync(page.request, { data: { changes: [{ id: child, patch: { id: child, kind: 'board', parentId: parent, title: 'Puppy class', icon: 'bone', color: 'none', createdAt: Date.now() } }] } })
  expect(created.ok(), await created.text()).toBe(true)
  await page.goto(`/#/b/${child}`)
  await page.reload()
  await expect(page.getByTestId('board-name')).toHaveText('Puppy class')
  // Long-press lists every parent; a tap goes straight up.
  await longPress(page, await center(page.getByTestId('parent-boards')))
  await expect(page.getByLabel('Parent boards', { exact: true }).locator('button.menu-item').last()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('parent-boards').tap()
  await expect(page.getByTestId('board-name')).toHaveText(parentName)
})

test('burying shows what happened, with Undo', async ({ page }) => {
  await seedCards(page, [note('Old bone', 0, 0)])
  await tapOn(page, cardByText(page, 'Old bone'))
  await page.getByTestId('bury').tap()
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
  await page.getByTestId('toast-action').tap()
  await expect(cardByText(page, 'Old bone')).toBeVisible()
})

test('touching the board with the Inbox open puts the sheet away first', async ({ page }) => {
  await seedCards(page, [note('Behind the sheet', 0, 0)])
  await page.getByTestId('toybox-button').tap()
  await expect(page.getByTestId('toybox-panel')).toBeVisible()
  const behind = cardByText(page, 'Behind the sheet')
  const rect = (await behind.boundingBox())!
  const point = { x: rect.x + Math.min(30, rect.width / 2), y: rect.y + Math.min(16, rect.height / 2) }
  const hit = await page.evaluate(point => {
    const el = document.elementFromPoint(point.x, point.y)
    return { tag: el?.tagName, className: el?.className, closestTestId: el?.closest('[data-testid]')?.getAttribute('data-testid'),
      inCanvas: !!el?.closest('[data-testid="canvas"]'), inSheet: !!el?.closest('.trash') }
  }, point)
  await test.info().attach('phone-inbox-before-board-tap', { body: JSON.stringify({ point, hit, panel: await sheetGeometry(page.getByTestId('toybox-panel')) }, null, 2), contentType: 'application/json' })
  await page.evaluate(() => {
    const events: object[] = []
    const describe = (event: Event, phase: string) => {
      if (events.length >= 20) return
      const target = event.target instanceof Element ? event.target : null
      const p = event as PointerEvent
      events.push({ type: event.type, phase, at: performance.now(), x: p.clientX, y: p.clientY, pointerType: p.pointerType,
        defaultPrevented: event.defaultPrevented, closestTestId: target?.closest('[data-testid]')?.getAttribute('data-testid'),
        inCanvas: !!target?.closest('[data-testid="canvas"]'), inSheet: !!target?.closest('.trash') })
    }
    const capture = (e: Event) => describe(e, 'capture'), bubble = (e: Event) => describe(e, 'bubble')
    const types = ['pointerdown', 'pointerup', 'click']
    for (const type of types) { document.addEventListener(type, capture, true); document.addEventListener(type, bubble) }
    ;(window as unknown as { __loop12PhoneTouch: { events: object[]; stop: () => void } }).__loop12PhoneTouch = {
      events, stop: () => { for (const type of types) { document.removeEventListener(type, capture, true); document.removeEventListener(type, bubble) } },
    }
  })
  try {
    await tapOn(page, cardByText(page, 'Behind the sheet'))
    await expect(page.getByTestId('toybox-panel')).toHaveCount(0)
    await expect(cardByText(page, 'Behind the sheet')).not.toHaveClass(/selected/)
  } finally {
    await page.evaluate(() => {
      const w = window as unknown as { __loop12PhoneTouch?: { events: object[]; stop: () => void } }
      const trace = w.__loop12PhoneTouch
      trace?.stop(); delete w.__loop12PhoneTouch
      return trace?.events
    }).then(events => test.info().attach('phone-inbox-delivered-input', { body: JSON.stringify(events), contentType: 'application/json' }))
      .catch(error => console.warn('Phone touch diagnostic unavailable:', String(error)))
  }
})

test('Inbox stays a full portrait sheet and leaves usable canvas beside it in landscape', async ({ page }, info) => {
  await seedCards(page, [note('Beside the Inbox', 0, 0)])
  await page.getByTestId('toybox-button').tap()
  const panel = page.getByTestId('toybox-panel')
  await isSheet(page, panel)
  await expect(panel.getByTestId('toybox-input')).toBeInViewport()
  await page.screenshot({ path: info.outputPath('inbox-portrait.png') })
  await page.setViewportSize({ width: 844, height: 390 })
  // The existing short-screen policy keeps a side panel and exposed canvas.
  await expect.poll(async () => {
    const b = (await panel.boundingBox())!
    return Math.abs(b.x + b.width - 844) + Math.abs(b.y + b.height - 390)
  }).toBeLessThanOrEqual(2)
  const box = (await panel.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(844 * .6 + 1)
  expect(box.y).toBeGreaterThan(40)
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
  await expect(panel.getByTestId('toybox-input')).toBeInViewport()
  await info.attach('phone-inbox-landscape-geometry', { body: JSON.stringify(await sheetGeometry(panel), null, 2), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('inbox-landscape.png') })
  await tapOn(page, cardByText(page, 'Beside the Inbox'))
  await expect(panel).toHaveCount(0)
  await expect(cardByText(page, 'Beside the Inbox')).not.toHaveClass(/selected/)
})

test('the Boards sheet lists boards you were just on', async ({ page }) => {
  const first = (await page.getByTestId('board-name').textContent())!
  await freshBoard(page)
  await page.getByTestId('board-navigation').tap()
  await page.getByTestId('recent-board').filter({ hasText: first }).tap()
  await expect(page.getByTestId('board-name')).toHaveText(first)
})

test('a comment thread closes when you leave its board', async ({ page }) => {
  const parent = page.url().split('/').at(-1)!
  const child = crypto.randomUUID()
  expect((await page.request.post('/api/sync', { data: { changes: [{ id: child, patch: { id: child, kind: 'board', parentId: parent, title: 'Car pool', icon: 'bone', color: 'none', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await page.goto(`/#/b/${child}`)
  await page.reload()
  await expect(page.getByTestId('board-name')).toHaveText('Car pool')
  await seedCards(page, [note('Who drives?', 0, 0)])
  await tapOn(page, cardByText(page, 'Who drives?'))
  await page.getByTestId('comment-button').tap()
  await expect(page.getByTestId('comments-panel')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('board-name')).not.toHaveText('Car pool')
  await expect(page.getByTestId('comments-panel')).toHaveCount(0)
})
