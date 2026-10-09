import { expect, test, type Page } from '@playwright/test'
import { MOD, addNote, at, camera, cardByText, clickEmpty, dragBy, freshBoard } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

/** A tiny PNG made in the page, as a file the image input accepts. */
async function pngBytes(page: Page, w = 64, h = 48, color = '#e8a849'): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ w, h, color }) => {
      const c = new OffscreenCanvas(w, h)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = color
      ctx.fillRect(0, 0, w, h)
      const blob = await c.convertToBlob({ type: 'image/png' })
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return btoa(s)
    },
    { w, h, color },
  )
  return Buffer.from(b64, 'base64')
}

test.describe('boards', () => {
  test('nest a board, open it, add a card, come back via breadcrumbs', async ({ page }) => {
    const parent = await page.getByTestId('board-name').textContent()
    await page.getByTestId('tool-board').click()
    await page.keyboard.type('Inner kennel')
    await page.keyboard.press('Enter')
    const card = cardByText(page, 'Inner kennel')
    await expect(card.locator('.board-tile svg *').first()).toBeAttached() // the icon actually rendered
    await expect(card).toContainText('0 cards')

    await card.locator('.board-tile').click()
    await expect(page.getByTestId('board-name')).toHaveText('Inner kennel')
    await expect(page.getByTestId('crumb').last()).toHaveText(parent!)
    await addNote(page, 'deep thought')

    await page.getByTestId('crumb').last().click()
    await expect(page.getByTestId('board-name')).toHaveText(parent!)
    await expect(cardByText(page, 'Inner kennel')).toContainText('1 card')
  })

  test('change a board icon and colour from the selection bar', async ({ page }) => {
    await page.getByTestId('tool-board').click()
    await page.keyboard.type('Styled')
    await page.keyboard.press('Enter')
    const card = cardByText(page, 'Styled')
    await dragBy(page, card, 12, 0) // select (a click would open it)
    await page.getByTestId('icon-bone').click()
    await page.getByTestId('swatch-sky').click()
    const tile = card.locator('.board-tile')
    await expect(tile).toHaveCSS('background-color', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dn-card-sky-bg').trim()).then(hexToRgb))
    await expect(page.locator('[data-testid="icon-bone"].on')).toBeVisible()
  })

  test('rename the current board from the top bar', async ({ page }) => {
    await page.getByTestId('board-name').click()
    await page.getByTestId('board-name-input').fill('Renamed pup')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('board-name')).toHaveText('Renamed pup')
  })
})

test.describe('to-do lists', () => {
  test('title, tasks, checking, reordering and the good-dog cheer', async ({ page }) => {
    await page.getByTestId('tool-todo').click()
    await page.keyboard.type('Chores')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Walkies')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Brush fur')
    await page.keyboard.press('Alt+ArrowUp') // move "Brush fur" above "Walkies"
    await page.keyboard.press('Escape')

    const todo = cardByText(page, 'Chores')
    await expect(todo.locator('.todo-text')).toHaveText(['Brush fur', 'Walkies'])
    await todo.getByRole('checkbox', { name: 'Brush fur' }).check()
    await expect(todo).toContainText('1/2 done')
    await todo.getByRole('checkbox', { name: 'Walkies' }).check()
    await expect(page.getByTestId('cheer')).toContainText('Good dog!')

    // Checking is an undo step of its own.
    await clickEmpty(page)
    await page.keyboard.press(`${MOD}+z`)
    await expect(todo).toContainText('1/2 done')
  })

  test('backspace on an empty task removes it', async ({ page }) => {
    await page.getByTestId('tool-todo').click()
    await page.keyboard.press('Enter')
    await page.keyboard.type('keep')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Escape')
    await expect(cardByText(page, 'keep').locator('.todo-item')).toHaveCount(1)
  })
})

test.describe('columns', () => {
  test('drag cards into a column, reorder inside it, and drag one back out', async ({ page }) => {
    await page.getByTestId('tool-column').click()
    await page.keyboard.type('Funnel')
    await page.keyboard.press('Enter')
    const column = cardByText(page, 'Funnel')
    const a = await addNote(page, 'first idea', 0.15, 0.2)
    const b = await addNote(page, 'second idea', 0.15, 0.75)

    const body = column.getByTestId('column-body')
    const target = async () => {
      const bb = (await body.boundingBox())!
      return { x: bb.x + bb.width / 2, y: bb.y + bb.height - 6 }
    }
    for (const card of [a, b]) {
      const cb = (await card.boundingBox())!
      const t = await target()
      await page.mouse.move(cb.x + 20, cb.y + 10)
      await page.mouse.down()
      await page.mouse.move(t.x, t.y, { steps: 10 })
      await expect(page.getByTestId('drop-line')).toBeVisible()
      await page.mouse.up()
    }
    await expect(body.getByTestId('card')).toHaveCount(2)
    await expect(body.getByTestId('card')).toHaveText(['first idea', 'second idea'])
    await expect(column).toContainText('2 cards')

    // Reorder: drag the second above the first.
    const second = body.getByTestId('card').nth(1)
    const first = (await body.getByTestId('card').nth(0).boundingBox())!
    const sb = (await second.boundingBox())!
    await page.mouse.move(sb.x + 20, sb.y + 10)
    await page.mouse.down()
    await page.mouse.move(first.x + 20, first.y + 4, { steps: 10 })
    await page.mouse.up()
    await expect(body.getByTestId('card')).toHaveText(['second idea', 'first idea'])

    // Drag one out onto open canvas.
    const out = await at(page, 0.85, 0.8)
    const fb = (await body.getByTestId('card').nth(1).boundingBox())!
    await page.mouse.move(fb.x + 20, fb.y + 10)
    await page.mouse.down()
    await page.mouse.move(out.x, out.y, { steps: 10 })
    await page.mouse.up()
    await expect(body.getByTestId('card')).toHaveCount(1)
    await expect(cardByText(page, 'first idea')).toHaveClass(/free/)
  })

  test('drag a tool straight into a column', async ({ page }) => {
    await page.getByTestId('tool-column').click()
    await page.keyboard.type('Inbox')
    await page.keyboard.press('Enter')
    const body = cardByText(page, 'Inbox').getByTestId('column-body')
    const tb = (await page.getByTestId('tool-note').boundingBox())!
    const bb = (await body.boundingBox())!
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.keyboard.type('dropped in')
    await page.keyboard.press('Escape')
    await expect(body.getByTestId('card')).toHaveText(['dropped in'])
  })
})

test.describe('connectors', () => {
  test('drag from a connect handle to another card; the arrow follows moves; delete it', async ({ page }) => {
    const a = await addNote(page, 'from here', 0.25, 0.3)
    const b = await addNote(page, 'to there', 0.7, 0.6)
    await a.hover()
    const h = (await a.getByTestId('connect-handle-right').boundingBox())!
    const bb = (await b.boundingBox())!
    await page.mouse.move(h.x + 7, h.y + 7)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 })
    await page.mouse.up()

    const line = page.getByTestId('connection').locator('.conn-line')
    await expect(line).toHaveCount(1)
    const d0 = await line.getAttribute('d')
    await dragBy(page, b, 0, 120)
    await expect.poll(() => line.getAttribute('d')).not.toBe(d0)

    await clickEmpty(page)
    // Click the curve's actual midpoint (a bounding-box centre isn't on a curve).
    const mid = await line.evaluate((el: SVGPathElement) => {
      const p = el.getPointAtLength(el.getTotalLength() / 2)
      const m = el.getScreenCTM()!
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }
    })
    await page.mouse.click(mid.x, mid.y)
    await expect(page.locator('.conn.selected')).toHaveCount(1)
    await page.keyboard.press('Delete')
    await expect(page.getByTestId('connection')).toHaveCount(0)
  })

  /** World rect of a card from its on-screen box and the camera. */
  async function worldRect(page: Page, card: import('@playwright/test').Locator) {
    const b = (await card.boundingBox())!
    const c = (await page.getByTestId('canvas').boundingBox())!
    const cam = await camera(page)
    return { x: (b.x - c.x - cam.tx) / cam.zoom, y: (b.y - c.y - cam.ty) / cam.zoom, w: b.width / cam.zoom, h: b.height / cam.zoom }
  }
  /** Last point of a path's `d` (where the arrow ends), in world coordinates. */
  async function pathEnd(line: import('@playwright/test').Locator) {
    const nums = ((await line.getAttribute('d')) ?? '').match(/-?[\d.]+/g)!.map(Number)
    return { x: nums[nums.length - 2], y: nums[nums.length - 1] }
  }
  async function dragConnector(page: Page, from: import('@playwright/test').Locator, side: string, to: { x: number; y: number }) {
    await from.hover()
    const h = (await from.getByTestId(`connect-handle-${side}`).boundingBox())!
    await page.mouse.move(h.x + 7, h.y + 7)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
  }

  test('dropping on a card snaps to the middle of its nearest side', async ({ page }) => {
    const a = await addNote(page, 'source pup', 0.2, 0.3)
    const b = await addNote(page, 'target pup', 0.65, 0.6)
    const bb = (await b.boundingBox())!

    // Over B's left edge region: the left anchor lights up and the drop pins to it.
    await dragConnector(page, a, 'right', { x: bb.x + 10, y: bb.y + bb.height / 2 })
    await expect(page.getByTestId('anchor')).toHaveCount(4)
    await expect(page.locator('[data-testid="anchor"].hot')).toHaveAttribute('data-side', 'left')
    await page.mouse.up()
    const line = page.getByTestId('connection').locator('.conn-line')
    const r = await worldRect(page, b)
    const end = await pathEnd(line)
    expect(end.x).toBeCloseTo(r.x - 8, 0) // arrow tip stops just outside the edge
    expect(end.y).toBeCloseTo(r.y + r.h / 2, 0)

    // Re-drag onto B's top edge: same connection, now pinned to the top.
    await dragConnector(page, a, 'bottom', { x: bb.x + bb.width / 2, y: bb.y + 4 })
    await expect(page.locator('[data-testid="anchor"].hot')).toHaveAttribute('data-side', 'top')
    await page.mouse.up()
    await expect(page.getByTestId('connection')).toHaveCount(1)
    const top = await pathEnd(line)
    const r2 = await worldRect(page, b)
    expect(top.x).toBeCloseTo(r2.x + r2.w / 2, 0)
    expect(top.y).toBeCloseTo(r2.y - 8, 0)

    // Moving B keeps the pinned side (auto-facing would switch it to the left).
    await dragBy(page, b, 160, -40)
    await clickEmpty(page)
    const r3 = await worldRect(page, b)
    const moved = await pathEnd(line)
    expect(moved.x).toBeCloseTo(r3.x + r3.w / 2, 0)
    expect(moved.y).toBeCloseTo(r3.y - 8, 0)
  })

  test('the Line tool connects facing sides, which follow the cards', async ({ page }) => {
    const a = await addNote(page, 'west pup', 0.2, 0.4)
    const b = await addNote(page, 'east pup', 0.75, 0.4)
    await page.getByTestId('tool-line').click()
    await a.click()
    await b.click()
    const line = page.getByTestId('connection').locator('.conn-line')
    const rb = await worldRect(page, b)
    const end = await pathEnd(line)
    expect(end.x).toBeCloseTo(rb.x - 8, 0)
    expect(end.y).toBeCloseTo(rb.y + rb.h / 2, 0)
    // Move B well below A: the ends swap to bottom/top.
    await dragBy(page, b, -300, 260)
    await clickEmpty(page)
    const rb2 = await worldRect(page, b)
    const end2 = await pathEnd(line)
    expect(end2.x).toBeCloseTo(rb2.x + rb2.w / 2, 0)
    expect(end2.y).toBeCloseTo(rb2.y - 8, 0)
  })

  test('Line tool: click two cards to connect them', async ({ page }) => {
    const a = await addNote(page, 'pup A', 0.3, 0.3)
    const b = await addNote(page, 'pup B', 0.7, 0.3)
    await page.getByTestId('tool-line').click()
    await expect(page.getByTestId('canvas')).toHaveClass(/connect-mode/)
    await a.click()
    await b.click()
    await expect(page.getByTestId('connection')).toHaveCount(1)
    await expect(page.getByTestId('canvas')).not.toHaveClass(/connect-mode/)
  })
})

test.describe('colours', () => {
  test('colour a note and clear it again', async ({ page }) => {
    const note = await addNote(page, 'paint me')
    await dragBy(page, note, 12, 0)
    await page.getByTestId('swatch-ball').click()
    await expect(note).toHaveClass(/colored/)
    const ball = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dn-card-ball-bg').trim())
    await expect(note).toHaveCSS('background-color', hexToRgb(ball))
    await page.getByTestId('swatch-none').click()
    await expect(note).not.toHaveClass(/colored/)
  })
})

test.describe('images', () => {
  test('add from the file picker; stored in three sizes; thumbnail when zoomed out', async ({ page }) => {
    await page.getByTestId('image-input').setInputFiles({ name: 'pup.png', mimeType: 'image/png', buffer: await pngBytes(page, 1600, 1200) })
    const img = page.getByTestId('card-image')
    await expect(img).toHaveCount(1)
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
    // Aspect ratio comes from the source image.
    const box = (await page.locator('.card-image').boundingBox())!
    expect(box.width / box.height).toBeCloseTo(4 / 3, 1)

    const p = await at(page, 0.5, 0.5)
    await page.mouse.move(p.x, p.y)
    await page.keyboard.down('Control')
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
    await page.keyboard.up('Control')
    await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(0.35)
    // Zoomed out, the overview canvas draws the thumbnail: sample its pixels for the image colour.
    await expect.poll(async () => Number(await page.getByTestId('lod-layer').getAttribute('data-thumbs'))).toBeGreaterThan(0)
    await expect
      .poll(() =>
        page.getByTestId('lod-layer').evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
          let hits = 0
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0xe8) < 14 && Math.abs(d[i + 1] - 0xa8) < 14 && Math.abs(d[i + 2] - 0x49) < 14) hits++
          return hits
        }),
      )
      .toBeGreaterThan(20)
  })

  test('drop an image file onto the canvas', async ({ page }) => {
    const bytes = [...(await pngBytes(page, 300, 300, '#7fa7d1'))]
    const p = await at(page, 0.4, 0.4)
    await page.evaluate(
      ({ bytes, x, y }) => {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array(bytes)], 'drop.png', { type: 'image/png' }))
        const target = document.elementFromPoint(x, y)!
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      },
      { bytes, x: p.x, y: p.y },
    )
    await expect(page.getByTestId('card-image')).toHaveCount(1)
  })
})

test.describe('links', () => {
  test('Link tool: paste a URL, get a preview from the Worker', async ({ page }) => {
    await page.getByTestId('tool-link').click()
    await page.getByTestId('link-input').fill('http://localhost:5180/og.html')
    await page.keyboard.press('Enter')
    const card = page.locator('.card-link')
    await expect(card.getByTestId('link-title')).toHaveText('Good Boy Supplies & Treats')
    await expect(card).toContainText('Everything a very good dog needs.')
    await expect(card).toContainText('Doggo Shop')
    await expect(card.getByTestId('link-title')).toHaveAttribute('href', 'http://localhost:5180/og.html')
  })

  test('pasting a URL on the canvas makes a link card; other text makes a note', async ({ page }) => {
    const paste = (text: string) =>
      page.evaluate((t) => {
        const dt = new DataTransfer()
        dt.setData('text/plain', t)
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }, text)
    await paste('http://localhost:5180/plain.html')
    await expect(page.locator('.card-link').getByTestId('link-title')).toHaveText('Just a title')
    await paste('a pasted thought')
    await expect(cardByText(page, 'a pasted thought')).toHaveAttribute('data-type', 'note')
  })
})

test.describe('trash', () => {
  test('bury several, restore one, empty the rest for good', async ({ page }) => {
    await addNote(page, 'bone one', 0.3, 0.3)
    await addNote(page, 'bone two', 0.6, 0.6)
    await page.keyboard.press(`${MOD}+a`)
    await page.getByTestId('bury').click()
    await page.getByTestId('tool-trash').click()
    await expect(page.getByTestId('trash-item')).toHaveCount(2)
    await page.getByTestId('trash-item').filter({ hasText: 'bone one' }).getByTestId('restore').click()
    await expect(cardByText(page, 'bone one')).toBeVisible()
    await page.getByTestId('empty-trash').click()
    await expect(page.getByTestId('trash-item')).toHaveCount(0)
    await expect(cardByText(page, 'bone two')).toHaveCount(0)
  })
})

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
