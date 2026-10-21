import { expect, type Page } from '@playwright/test'
import { freshBoard, postSync, pullAllObjects } from './helpers.ts'

export async function columnFixture(page: Page, count = 20) {
  const prefix = crypto.randomUUID()
  await freshBoard(page, `Collapse QA ${prefix.slice(0, 8)}`)
  const boardId = decodeURIComponent(page.url().split('/b/')[1]!)
  const col = `${prefix}-col`, outside = `${prefix}-out`
  const base = { kind: 'card', boardId, x: 0, y: 0, w: 280, h: 70, z: 1, color: 'none', createdAt: Date.now(), columnId: null }
  const kids = Array.from({ length: count }, (_, i) => ({ ...base, id: `${prefix}-${i}`, type: 'note', columnId: col, order: i + 1, content: { md: `Reference ${i + 1}: isolated collapse workflow · ${prefix.slice(0, 8)}` } }))
  const objects = [
    { ...base, id: col, type: 'column', x: 60, y: 60, h: 1800, content: { title: 'Twenty references with a very long title to inspect clipping and count visibility' } },
    ...kids,
    { ...base, id: outside, type: 'note', x: 420, y: 100, content: { md: 'Nearby material stays here' } },
    ...(count ? [{ id: `${prefix}-external`, kind: 'connection', boardId, from: kids[0]!.id, to: outside, arrow: 'end', createdAt: Date.now() }] : []),
    ...(count > 1 ? [{ id: `${prefix}-internal`, kind: 'connection', boardId, from: kids[0]!.id, to: kids[1]!.id, arrow: 'end', createdAt: Date.now() }] : []),
  ]
  const response = await postSync(page.request, { data: { changes: objects.map((o) => ({ id: o.id, patch: o })) } })
  expect(response.ok(), await response.text()).toBe(true)
  await page.evaluate((id) => localStorage.setItem(`doggynote.cam.${id}`, JSON.stringify({ x: 0, y: 0, zoom: 1 })), boardId)
  await page.reload()
  const column = page.locator(`[data-card-id="${col}"]`)
  await expect(column).toBeVisible()
  return { boardId, col, outside, kids, column, toggle: column.getByTestId('column-toggle'), objects, prefix }
}

export async function boardSnapshot(page: Page, boardId: string) {
  return (await pullAllObjects(page.request)).objects.filter((o: { boardId?: string }) => o.boardId === boardId)
}

