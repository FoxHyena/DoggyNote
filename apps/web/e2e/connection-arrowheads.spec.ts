import { expect, test } from '@playwright/test'
import { cardByText, dragBy, freshBoard, postSync } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

for (const theme of ['dark', 'light']) {
  test(`arrowheads to column members paint above the container in ${theme} theme`, async ({ page }, info) => {
    await page.addInitScript((theme) => localStorage.setItem('doggynote.theme', theme), theme)
    await freshBoard(page)
    const col = crypto.randomUUID(), target = crypto.randomUUID(), connection = crypto.randomUUID()
    const [source] = await seedCards(page, [
      note('Source', 0, 150),
      { id: col, type: 'column', x: 400, y: 80, w: 280, content: { title: 'Arrow destination' } },
      note('Inside the column', 0, 0, { id: target, columnId: col, order: 1 }),
      note('Second member', 0, 0, { columnId: col, order: 2 }),
    ])
    const change = (patch: object) => postSync(page.request, { data: { changes: [{ id: connection, patch }] } })
    expect((await change({ id: connection, kind: 'connection', boardId: boardOf(page), from: source, to: target, fromSide: 'right', toSide: 'left', arrow: 'end', createdAt: Date.now() })).ok()).toBe(true)
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      expect((await change({ toSide: side })).ok()).toBe(true)
      await page.reload()
      const body = page.locator(`[data-connection-id="${connection}"] .conn-line`)
      await expect(body).toHaveCount(1)
      const point = await body.evaluate((el) => {
        const path = el as SVGPathElement, end = path.getPointAtLength(path.getTotalLength())
        const screen = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM()!)
        return { x: screen.x, y: screen.y }
      })
      const clip = { x: Math.floor(point.x) - 16, y: Math.floor(point.y) - 16, width: 32, height: 32 }
      const visible = await page.screenshot({ clip, path: info.outputPath(`${side}.png`) })
      const hidden = await page.screenshot({ clip, style: '.connection-ends { visibility: hidden !important; }' })
      expect(visible.equals(hidden), `${side} arrowhead must paint over its column`).toBe(false)
      const end = page.locator(`[data-connection-end-id="${connection}"]`)
      await expect(end.locator('.conn-line')).toHaveCSS('pointer-events', 'none')
    }
    const end = page.locator(`[data-connection-end-id="${connection}"]`), old = await end.locator('.conn-line').getAttribute('d')
    await dragBy(page, cardByText(page, 'Arrow destination').getByTestId('column-title'), 30, 20)
    await expect(end.locator('.conn-line')).not.toHaveAttribute('d', old!)
    await cardByText(page, 'Arrow destination').getByTestId('column-toggle').click()
    await expect(end).toHaveAttribute('data-collapsed-endpoint', 'true')
    await cardByText(page, 'Arrow destination').getByTestId('column-toggle').click()
    await expect(end).not.toHaveAttribute('data-collapsed-endpoint', 'true')
    await expect(cardByText(page, 'Arrow destination').getByTestId('column-body')).not.toHaveClass(/sliding/)
    await page.getByTestId('canvas').screenshot({ path: info.outputPath('column-arrows.png') })
    expect((await change({ arrow: 'none' })).ok()).toBe(true)
    await page.reload()
    await expect(page.locator(`[data-connection-end-id="${connection}"]`)).toHaveCount(0)
    await expect(page.locator(`[data-connection-id="${connection}"]`)).toHaveCount(1)
  })
}
