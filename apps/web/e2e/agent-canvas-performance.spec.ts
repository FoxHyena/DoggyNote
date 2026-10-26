import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'

// Structural/per-token performance is deterministic; frame-time budgets remain in perf.spec.ts.
test('a 1,000-chat board retains culling and LOD without fetching transcripts @perf', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Heap metrics use Chromium CDP')
  await freshBoard(page, 'Chat-heavy board')
  const boardId = decodeURIComponent(page.url().split('#/b/')[1])
  const transcriptReads: string[] = []
  page.on('request', (request) => { if (/\/api\/chats\//.test(request.url())) transcriptReads.push(request.url()) })
  for (let offset = 0; offset < 1000; offset += 200) {
    const changes = Array.from({ length: 200 }, (_, index) => {
      const n = offset + index, id = crypto.randomUUID()
      return { id, patch: { id, kind: 'card', type: 'chat', boardId, x: n % 40 * 420, y: Math.floor(n / 40) * 560, w: 380, h: 520, z: n, color: 'none', createdAt: Date.now(), content: { title: `Conversation ${n}`, provider: 'claude' } } }
    })
    const write = () => page.request.post('/api/sync', { data: { changes } })
    let response = await write()
    for (let attempt = 0; response.status() === 409 && attempt < 10; attempt++) response = await write()
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await waitForSync(page)
  await page.keyboard.press('ControlOrMeta+1')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  expect(await page.getByTestId('card').count()).toBe(0)
  await page.keyboard.press('ControlOrMeta+0')
  await expect(page.getByTestId('lod-layer')).toHaveCount(0)
  const mounted = await page.getByTestId('card').count()
  expect(mounted).toBeGreaterThan(0)
  expect(mounted).toBeLessThan(120)
  expect(transcriptReads).toEqual([])
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  const heapMB = metrics.find((metric: { name: string }) => metric.name === 'JSHeapUsedSize')!.value / 1024 / 1024
  expect(heapMB).toBeLessThan(150)
  const report = { chats: 1000, mountedAt100: mounted, transcriptReads: transcriptReads.length, heapMB: Math.round(heapMB) }
  console.log('CHAT_PERF', JSON.stringify(report))
  test.info().annotations.push({ type: 'chat-performance', description: JSON.stringify(report) })
})
