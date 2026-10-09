import { expect, test, type Browser, type Page } from '@playwright/test'
import { MOD, addNote, cardByText, dragBy, freshBoard } from './helpers.ts'

// Comment threads on cards: a badge with a count, a side panel, replies,
// resolve/reopen, authorship that the server enforces, and a read-only view
// for share links.

const uniq = (s: string) => `${s} ${Math.random().toString(36).slice(2, 7)}`
const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])

async function asFido(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  expect((await ctx.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  return ctx
}

async function send(page: Page, text: string) {
  const input = page.getByTestId('comment-input')
  await input.fill(text)
  await input.press(`${MOD}+Enter`)
  await expect(page.getByTestId('comment').filter({ hasText: text.replaceAll('**', '') })).toBeVisible()
  await expect(input).toHaveValue('')
}

async function synced(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
}

test('start a thread, reply, resolve and reopen; the badge keeps count', async ({ page }) => {
  await freshBoard(page)
  const note = uniq('ball')
  await addNote(page, note)
  await dragBy(page, cardByText(page, note), 12, 0) // select (a click would open it)
  await page.getByTestId('comment-button').click()
  await expect(page.getByTestId('comments-panel')).toContainText(note)
  await expect(page.getByTestId('comment-input')).toBeFocused()

  await send(page, 'Who threw **this**?')
  const first = page.getByTestId('comment').first()
  await expect(first).toContainText('rex')
  await expect(first.locator('strong', { hasText: 'this' })).toBeVisible() // markdown, formatted
  await send(page, 'Me again')

  const badge = cardByText(page, note).getByTestId('comment-badge')
  await expect(badge).toHaveText('2')
  await page.getByTestId('comment-resolve').click()
  await expect(page.getByTestId('comments-resolved')).toBeVisible()
  await expect(badge).toHaveClass(/resolved/)

  // Close; the badge reopens it. A new reply reopens a resolved thread.
  await page.getByTestId('comments-close').click()
  await expect(page.getByTestId('comments-panel')).toHaveCount(0)
  await badge.click()
  await send(page, 'Third throw')
  await expect(page.getByTestId('comments-resolved')).toHaveCount(0)
  await expect(badge).toHaveText('3')
  await expect(badge).not.toHaveClass(/resolved/)

  // Typing in the panel never triggers canvas shortcuts (Delete would bury the card).
  await page.getByTestId('comment-input').fill('x')
  await page.getByTestId('comment-input').press('Backspace')
  await page.getByTestId('comment-input').press('Backspace')
  await expect(cardByText(page, note)).toBeVisible()

  // Survives a reload (it synced, and came back from the device's storage).
  await synced(page)
  await page.reload()
  await cardByText(page, note).getByTestId('comment-badge').click()
  await expect(page.getByTestId('comment')).toHaveText([/Who threw this\?/, /Me again/, /Third throw/])
})

test('edit and delete your own messages', async ({ page }) => {
  await freshBoard(page)
  const note = uniq('bowl')
  await addNote(page, note)
  await dragBy(page, cardByText(page, note), 12, 0) // select (a click would open it)
  await page.getByTestId('comment-button').click()
  await send(page, 'typo hre')
  await page.getByTestId('comment-edit').click()
  await page.getByTestId('comment-edit-input').fill('typo here')
  await page.getByTestId('comment-edit-input').press(`${MOD}+Enter`)
  await expect(page.getByTestId('comment')).toHaveText([/typo here.*|.*edited.*typo here/s])
  await expect(page.getByTestId('comment')).toContainText('edited')

  await page.getByTestId('comment-delete').click()
  await expect(page.getByTestId('comment')).toHaveCount(0)
  await expect(cardByText(page, note).getByTestId('comment-badge')).toHaveCount(0)
})

test('two people replying at once both land, under their own names', async ({ page, browser }) => {
  await freshBoard(page)
  const note = uniq('stick')
  await addNote(page, note)
  await synced(page)
  const url = page.url()

  const ctx = await asFido(browser)
  const p2 = await ctx.newPage()
  await p2.goto(url)
  await dragBy(p2, cardByText(p2, note), 12, 0)
  await p2.getByTestId('comment-button').click()
  await dragBy(page, cardByText(page, note), 12, 0) // select (a click would open it)
  await page.getByTestId('comment-button').click()

  // Both send before either has pulled the other's message.
  await Promise.all([send(page, 'rex says woof'), send(p2, 'fido says arf')])
  await Promise.all([synced(page), synced(p2)])
  for (const p of [page, p2]) {
    await expect(async () => {
      await p.getByTestId('sync-status').click()
      await expect(p.getByTestId('comment')).toHaveCount(2, { timeout: 1500 })
    }).toPass({ timeout: 15_000 })
  }
  await expect(page.getByTestId('comment').filter({ hasText: 'fido says arf' })).toContainText('fido')
  await expect(page.getByTestId('comment').filter({ hasText: 'rex says woof' })).toContainText('rex')

  // fido can't edit rex's words: no button, and the server refuses.
  const rexMsg = p2.getByTestId('comment').filter({ hasText: 'rex says woof' })
  await expect(rexMsg.getByTestId('comment-edit')).toHaveCount(0)
  await expect(p2.getByTestId('comment').filter({ hasText: 'fido says arf' }).getByTestId('comment-edit')).toBeVisible()
  const { objects } = await (await page.request.get('/api/sync?since=0')).json()
  const rexId = objects.find((o: { kind: string; text?: string }) => o.kind === 'comment' && o.text === 'rex says woof').id
  expect((await ctx.request.post('/api/sync', { data: { changes: [{ id: rexId, patch: { text: 'rex is a cat' } }] } })).status()).toBe(403)
  // ...and can't forge one under rex's name: the server stamps the real author.
  const forged = crypto.randomUUID()
  await ctx.request.post('/api/sync', {
    data: { changes: [{ id: forged, patch: { id: forged, kind: 'comment', boardId: boardOf(page), cardId: rexId, authorId: 'nope', author: 'rex', text: 'forged', createdAt: 1 } }] },
  })
  const all = (await (await page.request.get('/api/sync?since=0')).json()).objects
  expect(all.find((o: { id: string }) => o.id === forged).author).toBe('fido')
  await ctx.close()
})

test('share links show threads read-only', async ({ page, browser }) => {
  await freshBoard(page)
  const note = uniq('frisbee')
  await addNote(page, note)
  await dragBy(page, cardByText(page, note), 12, 0) // select (a click would open it)
  await page.getByTestId('comment-button').click()
  await send(page, 'visible to the link')
  await synced(page)
  const res = await page.request.post('/api/shares', { data: { boardId: boardOf(page) } })
  const { share } = await res.json()

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const v = await ctx.newPage()
  await v.goto(`/s/${share.token}`)
  await cardByText(v, note).getByTestId('comment-badge').click()
  await expect(v.getByTestId('comment')).toContainText('visible to the link')
  await expect(v.getByTestId('comment-input')).toHaveCount(0)
  await expect(v.getByTestId('comment-resolve')).toHaveCount(0)
  await expect(v.getByTestId('comment-edit')).toHaveCount(0)
  await ctx.close()
})
