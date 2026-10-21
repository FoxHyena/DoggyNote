import { expect, test, type Page } from '@playwright/test'
import { MOD, freshBoard, postSync, waitForSync } from './helpers.ts'

const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1]!)
async function graph(page: Page, board: string) {
  const response = await page.request.get(`/api/boards/${board}/copy-source`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).objects as Record<string, any>[]
}

for (const mode of ['independent selection', 'linked copied tree'] as const) test(`creation Undo/Redo keeps a two-session peer body in an ${mode}`, async ({ page, browser }) => {
  test.setTimeout(90_000)
  const initialBody = 'Original project brief: warm side lighting'
  const peerBody = 'Collaborator continued this brief: use a cool background and warm side lighting'
  await freshBoard(page, `Concurrent copy source — ${mode}`)
  const originalRoot = boardOf(page)
  const originalIds = [crypto.randomUUID(), crypto.randomUUID()]
  const group = crypto.randomUUID()
  const seeded = await postSync(page.request, { data: { changes: originalIds.map((id, index) => ({ id, patch: {
    id, kind: 'card', type: 'note', boardId: originalRoot, noteGroupId: group,
    x: 80 + index * 320, y: 180, w: 270, h: 100, z: index + 1, color: 'none',
    content: { md: initialBody }, createdAt: Date.now(),
  } })) } })
  expect(seeded.ok(), await seeded.text()).toBe(true)
  await page.reload()
  await expect(page.locator(`[data-card-id="${originalIds[0]}"]`)).toBeVisible()
  if (mode === 'independent selection') {
    await page.locator(`[data-card-id="${originalIds[0]}"]`).click({ modifiers: ['Shift'] })
    await expect(page.locator(`[data-card-id="${originalIds[0]}"]`)).toHaveClass(/selected/)
    await page.getByTestId('duplicate-selection').click()
  } else {
    await page.getByTestId('board-more').click()
    await page.getByTestId('duplicate-board').click()
    await page.getByTestId('template-name').fill('Independent linked brief alternative')
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('board-name')).toHaveText('Independent linked brief alternative')
  }
  await waitForSync(page)
  const targetRoot = boardOf(page)
  const before = await graph(page, targetRoot)
  const notes = before.filter((object) => object.kind === 'card' && object.type === 'note' && !originalIds.includes(object.id))
  expect(notes).toHaveLength(mode === 'independent selection' ? 1 : 2)
  if (mode === 'independent selection') expect(notes[0]!.noteGroupId ?? null).toBeNull()
  else {
    expect(notes[0]!.noteGroupId).toBeTruthy()
    expect(notes[0]!.noteGroupId).toBe(notes[1]!.noteGroupId)
    expect(notes[0]!.noteGroupId).not.toBe(group)
  }
  const peer = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const login = await peer.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })
    expect(login.ok()).toBe(true)
    const tab = await peer.newPage()
    await tab.goto(`/#/b/${targetRoot}`)
    await tab.locator(`[data-card-id="${notes[0]!.id}"] .note-body`).dblclick()
    await expect(tab.getByTestId('note-editor')).toBeFocused()
    await tab.keyboard.press(`${MOD}+a`)
    await tab.keyboard.type(peerBody)
    await tab.keyboard.press('Escape')
    await expect(tab.getByTestId('note-editor')).toHaveCount(0)
    await waitForSync(tab)
    await expect.poll(async () => {
      const stored = await graph(tab, targetRoot)
      return notes.every((note) => stored.find((object) => object.id === note.id)?.content?.md === peerBody)
    }).toBe(true)

    await page.bringToFront()
    const pulled = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/sync')
    await page.getByTestId('sync-status').click()
    await pulled
    await waitForSync(page)
    await page.keyboard.press('Escape')
    for (const note of notes) await expect(page.locator(`[data-card-id="${note.id}"]`)).toContainText(peerBody)
    await page.keyboard.press(`${MOD}+z`)
    await expect(page.getByTestId('toast')).toContainText('Cannot undo')
    expect(boardOf(page)).toBe(targetRoot)
    await waitForSync(page)
    const refused = await graph(page, targetRoot)
    expect(before.every((object) => refused.some((row) => row.id === object.id))).toBe(true)
    for (const note of notes) expect(refused.find((object) => object.id === note.id)?.content?.md).toBe(peerBody)
    // A refused Undo restores the original stack: Redo must not replay an old creation body.
    await page.keyboard.press(`${MOD}+Shift+z`)
    await waitForSync(page)
    const redone = await graph(page, targetRoot)
    expect(before.every((object) => redone.some((row) => row.id === object.id))).toBe(true)
    for (const note of notes) expect(redone.find((object) => object.id === note.id)?.content?.md).toBe(peerBody)
    const original = await graph(page, originalRoot)
    for (const id of originalIds) expect(original.find((object) => object.id === id)?.content?.md).toBe(initialBody)
    await page.reload()
    for (const note of notes) await expect(page.locator(`[data-card-id="${note.id}"]`)).toContainText(peerBody)
    expect(boardOf(page)).toBe(targetRoot)
  } finally { await peer.close() }
})
