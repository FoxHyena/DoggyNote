import { expect, test } from '@playwright/test'
import { MOD, camera, freshBoard, postSync, waitForSync } from './helpers.ts'

test('overview repaints swatch colours and collapsed column geometry without moving the camera', async ({ page }) => {
  await freshBoard(page, 'Overview reference palette')
  const boardId = decodeURIComponent(page.url().split('/b/')[1]!)
  const column = crypto.randomUUID(), swatch = crypto.randomUUID()
  const base = { kind: 'card', boardId, x: 60, y: 60, w: 280, h: 90, z: 1, color: 'none', createdAt: Date.now(), columnId: null }
  const objects = [
    { ...base, id: column, type: 'column', h: 400, content: { title: 'Reference palette and notes' } },
    ...Array.from({ length: 3 }, (_, i) => ({ ...base, id: crypto.randomUUID(), type: 'note', columnId: column, order: i + 1, content: { md: `Reference ${i + 1}\n\nA populated reference with several lines of research context.` } })),
    { ...base, id: swatch, type: 'swatch', x: 480, y: 100, w: 220, h: 200, swatchHex: '#D43A3A', swatchName: 'Signal red', swatchCaption: 'Compare with the updated palette', swatchHexDraft: null, content: {} },
  ]
  const seeded = await postSync(page.request, { data: { changes: objects.map(o => ({ id: o.id, patch: o })) } })
  expect(seeded.ok(), await seeded.text()).toBe(true)
  await page.evaluate(id => localStorage.setItem(`doggynote.cam.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })), boardId)
  await page.reload()
  await expect(page.locator(`[data-card-id="${column}"]`)).toBeVisible()
  await waitForSync(page)
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(`${MOD}+-`)
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8 ** i, 4)
  }
  const layer = page.getByTestId('lod-layer')
  await expect(layer).toBeVisible()
  const fixedCamera = await camera(page)
  const pixelAt = async (x: number, y: number) => layer.evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement
    return [...canvas.getContext('2d')!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data]
  }, { x: fixedCamera.tx + x * fixedCamera.zoom, y: fixedCamera.ty + y * fixedCamera.zoom })
  await expect.poll(() => pixelAt(550, 145)).toEqual([212, 58, 58, 255])
  await expect.poll(async () => (await pixelAt(100, 210))[3]).toBe(255)
  const remote = async (id: string, patch: Record<string, unknown>) => {
    const response = await postSync(page.request, { data: { changes: [{ id, patch }] } })
    expect(response.ok(), await response.text()).toBe(true)
    const pulled = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sync' && r.request().method() === 'GET' && r.ok())
    await page.getByTestId('sync-status').click()
    await pulled; await waitForSync(page)
    await page.keyboard.press('Escape')
    expect(await camera(page)).toEqual(fixedCamera)
  }
  await remote(swatch, { swatchHex: '#21835B' })
  await expect.poll(() => pixelAt(550, 145)).toEqual([33, 131, 91, 255])
  await remote(column, { collapsed: true })
  await expect.poll(async () => (await pixelAt(100, 210))[3]).toBe(0)
  await remote(column, { collapsed: false })
  await expect.poll(async () => (await pixelAt(100, 210))[3]).toBe(255)
})
