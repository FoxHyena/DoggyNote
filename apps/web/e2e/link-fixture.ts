import { expect, type Locator, type Page } from '@playwright/test'
import { freshBoard, postSync } from './helpers.ts'

const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])

export type Seed = { url: string; title?: string; image?: string; status?: string; column?: boolean; x?: number; y?: number }

/** Link cards straight into a fresh board, camera at the origin. Returns their ids. */
export async function seedLinks(page: Page, links: Seed[], zoom = 1) {
  await freshBoard(page)
  const boardId = boardOf(page)
  const base = { kind: 'card', boardId, w: 260, h: 80, z: 1, color: 'none', createdAt: Date.now(), columnId: null }
  const col = crypto.randomUUID()
  const ids = links.map(() => crypto.randomUUID())
  const objects: Record<string, unknown>[] = links.some((l) => l.column)
    ? [{ ...base, id: col, type: 'column', x: 700, y: 0, w: 280, h: 400, content: { title: 'Picks' } }]
    : []
  links.forEach((l, i) =>
    objects.push({
      ...base,
      id: ids[i],
      type: 'link',
      x: l.x ?? i * 300,
      y: l.y ?? 0,
      ...(l.column ? { columnId: col, order: i + 1 } : {}),
      content: { url: l.url, status: l.status ?? 'ok', ...(l.title ? { title: l.title } : {}), ...(l.image ? { image: l.image } : {}) },
    }),
  )
  const res = await postSync(page.request, { data: { changes: objects.map((o) => ({ id: o.id, patch: o })) } })
  expect(res.ok(), await res.text()).toBe(true)
  await page.evaluate(({ id, z }) => localStorage.setItem(`doggynote.cam.${id}`, JSON.stringify({ x: -20, y: -20, zoom: z })), { id: boardId, z: zoom })
  await page.reload()
  return { boardId, ids, card: (i: number) => page.locator(`[data-card-id="${ids[i]}"]`) }
}

/** The <img> has decoded a real picture (not a broken one). */
export const loaded = (img: Locator) => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)
