import { API_PORT } from './ports.ts'
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { noteDocument, noteState, replaceText } from '@doggynote/core'

export const MOD = 'ControlOrMeta'

/**
 * Select all text in the focused editor. ControlOrMeta follows the machine running
 * the tests, but CodeMirror follows the emulated device: an iPhone or iPad means
 * ⌘A, and there Ctrl+A only moves to the start of the line (the macOS binding).
 */
export async function selectAllText(page: Page) {
  const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) || /iPhone|iPad/.test(navigator.userAgent))
  await page.keyboard.press(apple ? 'Meta+a' : 'Control+a')
}

/** Camera from the world transform: translate(tx, ty) scale(z). */
export async function camera(page: Page) {
  return page.getByTestId('world').evaluate((el) => {
    const transform = getComputedStyle(el).transform
    // WebKit may serialize a zero Y translation as translate(0px). Read the
    // browser's actual matrix instead of requiring a particular CSS spelling.
    const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
    return { tx: matrix.e, ty: matrix.f, zoom: matrix.a }
  })
}

export async function canvasBox(page: Page) {
  const box = await page.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  return box
}

/** Screen point at fractions of the canvas. */
export async function at(page: Page, fx: number, fy: number) {
  const b = await canvasBox(page)
  return { x: b.x + b.width * fx, y: b.y + b.height * fy }
}

export const cards = (page: Page) => page.getByTestId('card')
export const cardByText = (page: Page, text: string) => page.locator('[data-testid="card"]', { hasText: text }).last()

/** Open the real right-click menu on a selected card without changing the selection. */
export async function openCardMenu(page: Page, card = page.locator('[data-testid="card"].selected').first()) {
  await card.click({ button: 'right', position: { x: 30, y: 20 } })
  await expect(page.getByTestId('canvas-context-menu')).toBeVisible()
}

export async function runCardAction(page: Page, name: string, card?: Locator) {
  await openCardMenu(page, card)
  await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name, exact: true }).click()
}

/** Double-click empty canvas, type, and leave edit mode. */
export async function addNote(page: Page, text: string, fx = 0.5, fy = 0.5) {
  const p = await at(page, fx, fy)
  await page.mouse.dblclick(p.x, p.y)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  const id = await page.getByTestId('note-editor').evaluate((el) => el.closest('[data-card-id]')!.getAttribute('data-card-id'))
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  // Markdown markers and paragraph boundaries aren't literal rendered text.
  const card = page.locator(`[data-testid="card"][data-card-id="${id}"]`)
  await expect(card).toBeVisible()
  return card
}

export async function dragBy(page: Page, target: Locator, dx: number, dy: number, opts: { steps?: number } = {}) {
  const b = await target.boundingBox()
  if (!b) throw new Error('no box')
  const x = b.x + Math.min(30, b.width / 2)
  const y = b.y + Math.min(14, b.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: opts.steps ?? 8 })
  await page.mouse.up()
}

export async function clickEmpty(page: Page, fx = 0.95, fy = 0.95) {
  const p = await at(page, fx, fy)
  await page.mouse.click(p.x, p.y)
}

/** Fresh board so tests don't see each other's cards (they share a server once sync lands). */
export async function freshBoard(page: Page, name = `Test ${Math.random().toString(36).slice(2, 7)}`) {
  const firstNavigation = page.url() === 'about:blank'
  if (!firstNavigation) await expect(page.getByTestId('canvas')).toBeVisible()
  // Seed a unique board directly: a shared root with hundreds of test tiles
  // otherwise fits below the DOM-detail threshold during the full suite.
  const id = crypto.randomUUID()
  const desktopToken = await page.evaluate(() => sessionStorage.getItem('fake-keychain')).catch(() => null)
  const response = await postSync(page.request, { ...(desktopToken ? { headers: { authorization: `Bearer ${desktopToken}`, 'x-doggynote-protocol': '3' } } : {}), data: { changes: [{ id, patch: { id, kind: 'board', parentId: 'home', title: name, icon: 'paw', color: 'gold', createdAt: Date.now() } }] } }, desktopToken ? `http://localhost:${API_PORT}/api/sync` : '/api/sync')
  expect(response.ok(), await response.text()).toBe(true)
  await page.goto(`/#/b/${id}`)
  // Hash-only navigation reuses the app; reload establishes the seeded snapshot.
  if (!firstNavigation) await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-name')).toHaveText(name)

  return name
}

/** Await the queue and network state, independently of quiet presentation. */
export async function waitForSync(page: Page) {
  await expect.poll(async () => page.getByTestId('sync-status').evaluate((el) => `${el.getAttribute('data-sync-state')}:${el.getAttribute('data-pending')}:${el.getAttribute('data-uploads')}`), { timeout: 15000 }).toBe('idle:0:0')
}

/** Access changes racing a fixture write are retried against fresh authorization. */
export async function postSync(api: APIRequestContext, options: Parameters<APIRequestContext['post']>[1], url = '/api/sync') {
  // Fixture text replacements use the same shared baseline as real editors.
  const data = options?.data as { changes?: { id: string; patch: { kind?: string; content?: { md?: string }; noteUpdate?: string; noteState?: string } }[] } | undefined
  const replacements = data?.changes?.filter((c) => !c.patch.kind && typeof c.patch.content?.md === 'string') ?? []
  if (replacements.length) {
    const { objects } = await pullAllObjects(api)
    for (const change of replacements) {
      const object = objects.find((o) => o.id === change.id)
      if (object?.type !== 'note' || !object.noteState) continue
      const document = noteDocument(object.noteState)
      replaceText(document.getText('markdown'), change.patch.content!.md!)
      change.patch.noteUpdate = noteState(document)
      delete change.patch.content
      document.destroy()
    }
  }
  // A copied card's sidecar is read-only server metadata.
  for (const change of data?.changes ?? []) delete change.patch.noteState
  let response = await api.post(url, options)
  for (let attempt = 0; response.status() === 409 && attempt < 10; attempt++) response = await api.post(url, options)
  return response
}

/** Complete authorized snapshot; a workspace may exceed one sync page. */
export async function pullAllObjects(api: APIRequestContext) {
  const objects = []
  let cursor = 0
  for (;;) {
    const response = await api.get(`/api/sync?since=${cursor}`)
    expect(response.ok(), await response.text()).toBe(true)
    const body = await response.json()
    objects.push(...body.objects)
    if (!body.more) return { objects }
    cursor = body.cursor
  }
}

/** Parent navigation is condensed into a menu when the title needs room. */
export async function openParentBoard(page: Page, which: 'first' | 'last' = 'last') {
  const condensed = page.getByTestId('parent-boards')
  if (await condensed.isVisible()) {
    await condensed.click()
    const choices = page.getByLabel('Parent boards', { exact: true }).locator('button.menu-item')
    await choices[which]().click()
  } else await page.getByTestId('crumb')[which]().click()
}

/** The selected card's resize and right connect handles answer a hit test at their centres (nothing clips them). */
export async function expectHandlesHittable(card: Locator) {
  for (const id of ['resize-handle', 'connect-handle-right']) {
    const handle = card.getByTestId(id)
    await expect(handle).toHaveCount(1)
    await expect.poll(() => handle.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el
    }), id).toBe(true)
  }
}
