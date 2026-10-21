import { expect, type CDPSession, type Locator, type Page } from '@playwright/test'
import { at, camera, cardByText, waitForSync } from './helpers.ts'

// Touch input for phone and tablet specs. Taps are real touches on both engines
// (page.touchscreen). Drags, long-presses and pinches are real CDP touch input
// on Chromium; Playwright has no multi-touch for WebKit, so there they're
// pointer events with pointerType "touch", sent where a finger would land.

type Pt = { x: number; y: number }

const sessions = new WeakMap<Page, CDPSession>()
const isChromium = (page: Page) => page.context().browser()?.browserType().name() === 'chromium'

async function cdp(page: Page) {
  let s = sessions.get(page)
  if (!s) {
    s = await page.context().newCDPSession(page)
    sessions.set(page, s)
  }
  return s
}

/** Chromium's double-tap timeout (gesture_configuration: 300 ms), plus a frame. */
const CHROMIUM_GESTURE_WINDOW_MS = 320

/** A multi-finger gesture. Fingers are numbered from 0. */
export class Fingers {
  private down = new Map<number, Pt>()
  private most = 0
  constructor(private page: Page) {}

  async press(id: number, p: Pt) {
    this.down.set(id, p)
    this.most = Math.max(this.most, this.down.size)
    await this.send('touchStart', id, 'pointerdown', p)
  }
  async move(id: number, p: Pt) {
    this.down.set(id, p)
    await this.send('touchMove', id, 'pointermove', p)
  }
  async release(id: number) {
    const p = this.down.get(id)!
    this.down.delete(id)
    await this.send('touchEnd', id, 'pointerup', p)
    if (this.down.size || this.most < 2) return
    this.most = 0
    // Chromium keeps a two-finger gesture open for its double-tap window after the
    // last finger lifts, and a tap inside it gets no click. A hand can't come back
    // that fast; synthetic input can (seen on CI's x64 Chromium), so let it close.
    if (isChromium(this.page)) await this.page.waitForTimeout(CHROMIUM_GESTURE_WINDOW_MS)
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd', id: number, pointer: string, p: Pt) {
    if (isChromium(this.page)) {
      // CDP diffs each event against the previous one: a finger missing from a
      // touchMove is released, so lifting one of several fingers is a touchMove.
      const touchPoints = [...this.down].map(([i, q]) => ({ x: q.x, y: q.y, id: i, radiusX: 4, radiusY: 4, force: 1 }))
      const t = type === 'touchEnd' && touchPoints.length ? 'touchMove' : type
      await (await cdp(this.page)).send('Input.dispatchTouchEvent', { type: t, touchPoints: t === 'touchEnd' ? [] : touchPoints })
      return
    }
    await this.page.evaluate(({ id, pointer, p }) => {
      const w = window as unknown as { __touchTargets?: Map<number, Element> }
      const targets = (w.__touchTargets ??= new Map())
      if (pointer === 'pointerdown') targets.set(id, document.elementFromPoint(p.x, p.y) ?? document.body)
      // The canvas captures real pointers. A synthetic one can't be captured, so when a
      // re-render replaces the touched element, deliver to the canvas as capture would.
      const touched = targets.get(id)
      const target = touched?.isConnected ? touched : document.querySelector('[data-testid="canvas"]') ?? document.body
      target.dispatchEvent(new PointerEvent(pointer, { pointerId: 100 + id, pointerType: 'touch', isPrimary: id === 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, composed: true, button: pointer === 'pointermove' ? -1 : 0, buttons: pointer === 'pointerup' ? 0 : 1 }))
      if (pointer === 'pointerup') {
        targets.delete(id)
        // A finger that didn't move far is a tap: browsers follow it with a click.
      }
    }, { id, pointer, p })
  }
}

async function steps(f: Fingers, id: number, from: Pt, to: Pt, n: number) {
  for (let i = 1; i <= n; i++) await f.move(id, { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n })
}

export async function tap(page: Page, p: Pt) {
  await page.touchscreen.tap(p.x, p.y)
}

/** Tap a locator at a point inside it (default: near its top-left, clear of handles). */
export async function tapOn(page: Page, target: Locator, offset: Pt = { x: 30, y: 16 }) {
  // A re-render can swap the element out just as it's measured (no box): measure again.
  type Box = Awaited<ReturnType<Locator['boundingBox']>>
  let found: Box = null
  await expect.poll(async () => !!(found = await target.boundingBox()) && found.width > 0 && found.height > 0, { message: 'nothing to tap' }).toBe(true)
  const b = found as Box
  if (!b) throw new Error('nothing to tap')
  await tap(page, { x: b.x + Math.min(offset.x, b.width / 2), y: b.y + Math.min(offset.y, b.height / 2) })
}

export async function center(target: Locator): Promise<Pt> {
  const b = await target.boundingBox()
  if (!b) throw new Error('no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * One finger down, slide, up. `hold` waits before moving (a long-press drag).
 * The finger rests before lifting, so a pan doesn't turn into a flick.
 */
export async function touchDrag(page: Page, from: Pt, to: Pt, opts: { steps?: number; hold?: number } = {}) {
  const f = new Fingers(page)
  await f.press(0, from)
  if (opts.hold) await page.waitForTimeout(opts.hold)
  await steps(f, 0, from, to, opts.steps ?? 8)
  await page.waitForTimeout(150)
  await f.release(0)
}

export async function longPress(page: Page, p: Pt, ms = 600) {
  const f = new Fingers(page)
  await f.press(0, p)
  await page.waitForTimeout(ms)
  await f.release(0)
}

/** Double-tap, keep the second tap down, and slide `dy` px (up is negative). */
export async function tapHoldSlide(page: Page, p: Pt, dy: number) {
  await tap(page, p)
  await page.waitForTimeout(80)
  const f = new Fingers(page)
  await f.press(0, p)
  await steps(f, 0, p, { x: p.x, y: p.y + dy }, 8)
  await page.waitForTimeout(150)
  await f.release(0)
}

/** Two fingers spread (scale > 1) or pinched (scale < 1) around a centre. */
export async function pinch(page: Page, c: Pt, scale: number, opts: { spread?: number; pan?: Pt } = {}) {
  const r0 = opts.spread ?? 60
  const r1 = r0 * scale
  const pan = opts.pan ?? { x: 0, y: 0 }
  const f = new Fingers(page)
  await f.press(0, { x: c.x - r0, y: c.y })
  await f.press(1, { x: c.x + r0, y: c.y })
  const n = 8
  for (let i = 1; i <= n; i++) {
    const r = r0 + ((r1 - r0) * i) / n
    const d = { x: (pan.x * i) / n, y: (pan.y * i) / n }
    await f.move(0, { x: c.x - r + d.x, y: c.y + d.y })
    await f.move(1, { x: c.x + r + d.x, y: c.y + d.y })
  }
  await f.release(0)
  await f.release(1)
}

/** Double-tap empty canvas to make a note, type, then tap away. */
export async function touchAddNote(page: Page, text: string, fx = 0.5, fy = 0.5) {
  const p = await at(page, fx, fy)
  await tap(page, p)
  await page.waitForTimeout(60)
  await tap(page, p)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.type(text)
  await page.getByTestId('edit-done').tap()
  const card = cardByText(page, text)
  await expect(card).toBeVisible()
  return card
}

export const boardOf = (page: Page) => decodeURIComponent(page.url().match(/#\/b\/([^/?#]+)/)![1])

type Seed = { type: string; x?: number; y?: number; w?: number; content: unknown; color?: string; columnId?: string; order?: number; id?: string }

/**
 * Put cards on the current board through the API, then reload with the camera at
 * 100% and world (0,0) at the canvas's top-left plus `origin` px.
 */
export async function seedCards(page: Page, list: Seed[], origin = { x: 24, y: 24 }) {
  const boardId = boardOf(page)
  const changes = list.map((c, i) => {
    const id = c.id ?? crypto.randomUUID()
    return { id, patch: { id, kind: 'card', boardId, x: c.x ?? 0, y: c.y ?? 0, w: c.w ?? 240, h: 80, z: i + 1, color: c.color ?? 'none', type: c.type, content: c.content, columnId: c.columnId ?? null, order: c.order, createdAt: Date.now() } }
  })
  let res = await page.request.post('/api/sync', { data: { changes } })
  for (let i = 0; res.status() === 409 && i < 10; i++) res = await page.request.post('/api/sync', { data: { changes } })
  expect(res.ok(), await res.text()).toBe(true)
  await setCamera(page, { x: -origin.x, y: -origin.y, zoom: 1 })
  return changes.map((c) => c.id)
}

/** Reload the board with a given camera. */
export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  const boardId = boardOf(page)
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value)
    // The app saves its own camera 250 ms after it last moved. If that save is still
    // pending, it lands before the reload and the board reopens where it was: stop
    // this page (and only this page; the reload starts afresh) from writing the key.
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k !== key) set.call(this, k, v)
    }
  }, { key: `doggynote.cam.${boardId}`, value: JSON.stringify(cam) })
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect.poll(async () => (await camera(page)).zoom, { message: 'camera not restored' }).toBeCloseTo(cam.zoom, 3)
  // The first pull after a reload can still replace what's drawn (the server prepares a
  // seeded note for shared editing on first read). Taps during that re-render are lost.
  await waitForSync(page)
}

export const note = (md: string, x = 0, y = 0, extra: Partial<Seed> = {}): Seed => ({ type: 'note', x, y, content: { md }, ...extra })

/**
 * The docked selection bar stays within the screen in a few short rows (position,
 * colours, actions). The action row may scroll sideways; every button in it can be
 * scrolled fully into view with its label intact, and Done is always on screen.
 */
export async function selectionBarFits(page: Page) {
  const bar = page.getByTestId('selection-bar')
  await expect.poll(() => bar.evaluate((bar) => {
    const box = bar.getBoundingClientRect()
    const inside = (r: DOMRect) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5
      && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
    if (box.left < 0 || box.right > innerWidth || box.bottom > innerHeight || bar.scrollWidth > bar.clientWidth + 1) return 'bar overflows'
    const done = bar.querySelector('[data-testid="selection-done"]')
    if (done && !inside(done.getBoundingClientRect())) return 'done hidden'
    const buttons = [...bar.querySelectorAll('button')].filter((b) => b.getClientRects().length)
    if (!buttons.length) return 'no buttons'
    const groups = [...bar.querySelectorAll<HTMLElement>('.bar-group')]
    try {
      for (const b of buttons) {
        b.scrollIntoView({ inline: 'center', block: 'nearest' })
        if (!inside(b.getBoundingClientRect())) return `unreachable: ${b.getAttribute('aria-label') ?? b.textContent}`
        if (b.scrollWidth > b.clientWidth + 1) return `clipped: ${b.getAttribute('aria-label') ?? b.textContent}`
      }
    } finally { for (const g of groups) g.scrollLeft = 0 }
    return 'ok'
  })).toBe('ok')
}
