import { expect, type Page, type TestInfo } from '@playwright/test'
import { camera, freshBoard, postSync } from './helpers.ts'
import { setCamera, touchDrag } from './touch.ts'

/** Exercise the same attached-header contract with mouse, phone and tablet input. */
export async function areaHeaderFlow(page: Page, info: TestInfo) {
  await freshBoard(page, 'Attached area headers')
  const boardId = decodeURIComponent(page.url().split('/b/')[1]!)
  const prefix = crypto.randomUUID()
  const base = { kind: 'card', type: 'area', boardId, y: 40, w: 320, h: 160, z: 1, color: 'none', createdAt: Date.now(), columnId: null, areaId: null }
  const title = 'Projects and tasks with a deliberately long area title'
  const areas = [
    { ...base, id: `${prefix}-small`, x: 40, content: { title } },
    { ...base, id: `${prefix}-neighbor`, x: 424, collapsed: true, content: { title } },
    { ...base, id: `${prefix}-wide`, x: 40, y: 300, w: 1400, content: { title } },
  ]
  const response = await postSync(page.request, { data: { changes: areas.map(area => ({ id: area.id, patch: area })) } })
  expect(response.ok(), await response.text()).toBe(true)

  const headersFit = async () => {
    await expect.poll(() => page.locator('.card-area').evaluateAll(elements => {
      if (!elements.length) return 'no areas mounted'
      for (const element of elements) {
        const frame = element.getBoundingClientRect()
        const head = element.querySelector<HTMLElement>('[data-area-header]')!
        const header = head.getBoundingClientRect()
        const scale = frame.width / (element as HTMLElement).offsetWidth
        const id = element.getAttribute('data-card-id')
        if (Math.abs(header.left - frame.left - scale) > 1) return `${id}: header detached from left edge`
        if (Math.abs(header.right - frame.right + scale) > 1) return `${id}: header width differs from frame`
        if (head.scrollWidth > head.clientWidth + 1) return `${id}: header contents overflow`
        for (const control of head.querySelectorAll<HTMLElement>('button, .area-title')) {
          if (!control.getClientRects().length) continue
          const box = control.getBoundingClientRect()
          if (box.left < header.left - 1 || box.right > header.right + 1) return `${id}: title or control escapes header`
        }
      }
      return 'ok'
    })).toBe('ok')
  }

  for (const zoom of [1, .56]) {
    await setCamera(page, { x: 0, y: 0, zoom })
    await headersFit()
    const smallTitle = page.locator(`[data-card-id="${areas[0]!.id}"]`).getByTestId('area-title')
    expect(await smallTitle.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    if (zoom === .56 && info.project.use.isMobile) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => localStorage.setItem('doggynote.theme', theme), theme)
        await page.reload()
        await headersFit()
        await page.screenshot({ path: info.outputPath(`area-headers-${theme}.png`) })
      }
    }
    const canvas = (await page.getByTestId('canvas').boundingBox())!
    // This strip is between the two rows of areas, so a finger pans the board.
    const from = { x: canvas.x + canvas.width * .65, y: canvas.y + 240 * zoom }
    for (const direction of [1, -1]) {
      for (let step = 0; step < 6; step++) {
        const before = await camera(page)
        const distance = 120 * zoom * direction
        if (info.project.use.hasTouch) {
          await touchDrag(page, from, { x: from.x - distance, y: from.y })
        } else {
          await page.mouse.move(from.x, from.y)
          await page.mouse.wheel(distance, 0)
        }
        await expect.poll(async () => (before.tx - (await camera(page)).tx) * direction).toBeGreaterThan(50 * zoom)
        await headersFit()
      }
    }
  }
}
