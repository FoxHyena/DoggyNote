import { expect, type Page } from '@playwright/test'
import { postSync, waitForSync } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

export async function moveFixture(page: Page, compact = false) {
  const source = boardOf(page), target = crypto.randomUUID(), nested = crypto.randomUUID(), tile = crypto.randomUUID()
  const response = await postSync(page.request, { data: { changes: [
    { id: target, patch: { id: target, kind: 'board', parentId: source, title: 'Move destination', icon: 'paw', color: 'gold', createdAt: Date.now() } },
    { id: nested, patch: { id: nested, kind: 'board', parentId: target, title: 'Inside destination', icon: 'bone', color: 'sky', createdAt: Date.now() } },
  ] } })
  expect(response.ok(), await response.text()).toBe(true)
  const [a, b] = await seedCards(page, [note('Move first idea', 100, 160), note('Move second idea', 100, 280), { id: tile, type: 'board', x: compact ? 140 : 600, y: compact ? 380 : 170, w: 120, content: { boardId: target } }])
  await waitForSync(page)
  return { source, target, nested, tile, a, b }
}
