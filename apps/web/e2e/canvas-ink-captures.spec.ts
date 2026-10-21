import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { MOD, addNote, at, camera, freshBoard, pullAllObjects, waitForSync } from './helpers.ts'

// An opt-in artifact run, separate from manual/native QA. It makes the board
// through actual inputs; screenshots never substitute generated UI or fixtures.
test.skip(!process.env.LOOP11_CAPTURE, 'Run with LOOP11_CAPTURE=1 under the heavy-QA lease')
test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' })
test.setTimeout(120_000)

async function mark(page: Page, points: { x: number; y: number }[]) {
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 })
  await page.mouse.up()
}

async function visibleWithin(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  // Keep the geometry assertions, allowing the sheet's entrance animation to
  // settle. No gesture is retried and no offscreen target is force-clicked.
  await expect(async () => {
    const box = (await target.boundingBox())!, size = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1)
    expect(await target.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  }).toPass({ timeout: 5000 })
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled', scale: 'css' })
  await info.attach(name, { path, contentType: 'image/png' })
}

async function fit(page: Page) {
  await page.keyboard.press(`${MOD}+1`)
  let previous = '', stable = 0
  await expect.poll(async () => {
    const value = JSON.stringify(await camera(page))
    stable = value === previous ? stable + 1 : 0
    previous = value
    return stable
  }, { intervals: [100, 100, 100, 100] }).toBeGreaterThanOrEqual(2)
}

test('populated board ink, controls and selected editing across themes and required browser widths', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await freshBoard(page, 'Trail plan — ideas to try beside our references')
  const a = await addNote(page, 'Reference A — A quiet route with room to pause.', .25, .35)
  const b = await addNote(page, 'Reference B — A brighter route near the water.', .53, .35)
  await addNote(page, 'Try both → choose a route → take a short walk. Keep the first outing simple.', .38, .72)
  const ab = (await a.boundingBox())!, bb = (await b.boundingBox())!
  const left = Math.min(ab.x, bb.x) - 20, right = Math.max(ab.x + ab.width, bb.x + bb.width) + 20
  const top = Math.min(ab.y, bb.y) - 20, bottom = Math.max(ab.y + ab.height, bb.y + bb.height) + 20
  await page.getByTestId('tool-draw').click()
  const tools = page.getByTestId('canvas-ink-tools')
  await tools.getByRole('button', { name: 'Blue', exact: true }).click()
  await mark(page, [{ x: left, y: top + 12 }, { x: left + 12, y: top }, { x: right - 12, y: top }, { x: right, y: top + 12 }, { x: right, y: bottom - 12 }, { x: right - 12, y: bottom }, { x: left + 12, y: bottom }, { x: left, y: bottom - 12 }, { x: left, y: top + 12 }])
  // A handwritten "try" and a process arrow beside the written plan.
  const p = await at(page, .70, .65)
  await mark(page, [{ x: p.x + 9, y: p.y - 30 }, { x: p.x + 8, y: p.y + 5 }, { x: p.x + 20, y: p.y + 5 }])
  await mark(page, [{ x: p.x, y: p.y - 14 }, { x: p.x + 23, y: p.y - 14 }])
  await mark(page, [{ x: p.x + 30, y: p.y + 6 }, { x: p.x + 30, y: p.y - 15 }, { x: p.x + 42, y: p.y - 17 }])
  await mark(page, [{ x: p.x + 48, y: p.y - 16 }, { x: p.x + 57, y: p.y + 1 }, { x: p.x + 67, y: p.y - 16 }, { x: p.x + 57, y: p.y + 23 }])
  await mark(page, [{ x: p.x, y: p.y + 44 }, { x: p.x + 90, y: p.y + 44 }, { x: p.x + 73, y: p.y + 32 }, { x: p.x + 90, y: p.y + 44 }, { x: p.x + 73, y: p.y + 56 }])
  await tools.getByRole('button', { name: 'Highlighter', exact: true }).click()
  await tools.getByRole('button', { name: 'Yellow', exact: true }).click()
  await mark(page, [{ x: ab.x + 10, y: ab.y + ab.height - 16 }, { x: ab.x + ab.width - 10, y: ab.y + ab.height - 16 }])
  await tools.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator('[data-type="ink"]')).toHaveCount(7)
  await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  const boundary = objects.find((o) => o.kind === 'card' && o.type === 'ink' && o.boardId === page.url().split('/b/')[1] && o.content.width > 400)!
  const firstPoint = objects.find((o) => o.kind === 'stroke' && o.cardId === boundary.id)!.points[0]

  for (const theme of ['Light', 'Dark'] as const) {
    await page.getByTestId('account').click()
    await page.getByRole('radio', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
    const empty = await at(page, .95, .15)
    // Return to the board normally so the focused Account tooltip is not part
    // of the finished-state figure. No forced focus or screenshot alteration.
    await page.mouse.click(empty.x, empty.y)
    for (const width of [1440, 720, 600, 360]) {
      await page.setViewportSize({ width, height: width === 720 ? 480 : 900 })
      await page.keyboard.press('Escape')
      await fit(page)
      await capture(page, info, `completed-${theme.toLowerCase()}-${width}`)
      if (width !== 720 && width !== 360) continue
      // Pick the same actual path at both DOM and overview scales.
      const c = await camera(page), v = (await page.getByTestId('canvas').boundingBox())!
      await page.mouse.click(v.x + c.tx + (boundary.x + firstPoint.x) * c.zoom, v.y + c.ty + (boundary.y + firstPoint.y) * c.zoom)
      await visibleWithin(page, page.getByTestId('edit-canvas-ink'))
      await capture(page, info, `selected-${theme.toLowerCase()}-${width}`)
      await page.getByTestId('edit-canvas-ink').click()
      await visibleWithin(page, page.getByTestId('stroke-editor'))
      await capture(page, info, `editing-${theme.toLowerCase()}-${width}`)
      await page.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('selection-bar')).toHaveCount(0)
      if (width < 600) {
        await page.getByTestId('dock-add').click()
        await page.getByTestId('add-draw').click()
      } else await page.getByTestId('tool-draw').click()
      await visibleWithin(page, tools)
      await capture(page, info, `drawing-${theme.toLowerCase()}-${width}`)
      await tools.getByRole('button', { name: 'Done', exact: true }).click()
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
})
