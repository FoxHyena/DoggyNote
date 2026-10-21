import { expect, test, type Page } from '@playwright/test'
import { inkBounds } from '@doggynote/core'
import { MOD, at, camera, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

test.setTimeout(180_000)

async function framesWhilePanning(page: Page, dx: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __inkFrames: number[]; __inkFramesStop: boolean }
    w.__inkFrames = []; w.__inkFramesStop = false
    let last = performance.now()
    const tick = (now: number) => {
      w.__inkFrames.push(now - last); last = now
      if (!w.__inkFramesStop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  for (let i = 0; i < 90; i++) await page.mouse.wheel(dx, i < 45 ? 4 : -4)
  const values = await page.evaluate(() => {
    const w = window as unknown as { __inkFrames: number[]; __inkFramesStop: boolean }
    w.__inkFramesStop = true
    return w.__inkFrames.slice(2).sort((a, b) => a - b)
  })
  expect(values.length).toBeGreaterThan(30)
  return { count: values.length, p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)] }
}

test('1,000 independent ink marks retain culled DOM, overview, input and heap budgets @perf', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'CDP heap metrics are Chromium-only')
  await page.setViewportSize({ width: 1440, height: 900 })
  await freshBoard(page, 'Canvas ink performance — synthetic marks')
  const boardId = page.url().split('/b/')[1], now = Date.now()
  const objects = Array.from({ length: 1000 }, (_, i) => {
    const id = crypto.randomUUID()
    const points = Array.from({ length: 16 }, (_, p) => ({ x: 4 + p * 7, y: 35 + Math.sin(p / 2) * 24 }))
    return [
      { id, kind: 'card', type: 'ink', boardId, x: i % 50 * 150, y: Math.floor(i / 50) * 120, w: 120, h: 80, z: i + 1, color: 'none', columnId: null, content: { width: 120, height: 80 }, createdAt: now },
      { id: crypto.randomUUID(), kind: 'stroke', cardId: id, boardId, tool: i % 4 === 0 ? 'highlighter' : 'pen', color: '#D7263D', width: 3, opacity: i % 4 === 0 ? .3 : 1, points, bounds: inkBounds(points, 3), order: now + i, createdAt: now },
    ]
  }).flat()
  for (let i = 0; i < objects.length; i += 200) {
    const response = await postSync(page.request, { data: { changes: objects.slice(i, i + 200).map((o) => ({ id: o.id, patch: o })) } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await waitForSync(page)
  // This board was opened while empty, so reload correctly restores its saved
  // camera. Explicitly fit the newly seeded marks before measuring overview.
  await page.keyboard.press(`${MOD}+1`)
  await expect(page.getByTestId('canvas')).toHaveClass(/\blod\b/)
  let previous = '', stable = 0
  await expect.poll(async () => {
    const value = JSON.stringify(await camera(page))
    stable = value === previous ? stable + 1 : 0
    previous = value
    return stable
  }, { intervals: [100, 100, 100] }).toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect(page.getByTestId('card')).toHaveCount(0)
  await expect(page.getByTestId('stroke-editor')).toHaveCount(0)
  const p = await at(page, .5, .5)
  await page.mouse.move(p.x, p.y)
  const overview = await framesWhilePanning(page, 8)
  await page.keyboard.press(`${MOD}+0`)
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1, 3)
  await expect(page.getByTestId('canvas')).not.toHaveClass(/\blod\b/)
  const mounted = await page.getByTestId('card').count()
  expect(mounted).toBeLessThan(120)
  const detail = await framesWhilePanning(page, -8)
  await page.getByTestId('tool-draw').click()
  await page.mouse.move(p.x - 80, p.y + 80)
  await page.mouse.down()
  await page.mouse.move(p.x + 80, p.y + 120, { steps: 80 })
  await page.mouse.up()
  await page.getByTestId('canvas-ink-tools').getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page)
  expect((await pullAllObjects(page.request)).objects.filter((o) => o.kind === 'stroke' && o.boardId === boardId && !o.deletedAt)).toHaveLength(1001)
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  await session.send('HeapProfiler.collectGarbage')
  const { metrics } = await session.send('Performance.getMetrics')
  const values = Object.fromEntries(metrics.map((m: { name: string; value: number }) => [m.name, m.value]))
  const heapMB = values.JSHeapUsedSize / 1024 / 1024
  const report = { marks: 1000, pointsPerMark: 16, mounted, overview, detail, heapMB: Math.round(heapMB), measurement: 'isolated headless Chromium' }
  console.log('INK_PERF', JSON.stringify(report))
  info.annotations.push({ type: 'perf', description: JSON.stringify(report) })
  expect(overview.p95, 'overview pan p95').toBeLessThan(overview.p50 * 1.25)
  expect(detail.p95, 'detail pan p95').toBeLessThan(detail.p50 * 1.25)
  expect(heapMB, 'JS heap').toBeLessThan(150)
})
