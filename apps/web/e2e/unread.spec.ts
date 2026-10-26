import { expect, test, type Page } from '@playwright/test'
import { MOD, cardByText, dragBy, postSync, runCardAction, waitForSync } from './helpers.ts'
import { commentVia, openWithReadMarks, person, sharedBoard } from './unread-fixture.ts'

// Unread comments: a friend's comment puts a dot on the card's badge, on the
// board (its tile and the Boards list) and in "New for you". Opening the
// thread, or Mark all as read, clears them, and that's kept on the server.

async function send(page: Page, text: string) {
  const input = page.getByTestId('comment-input')
  await input.fill(text)
  await input.press(`${MOD}+Enter`)
  await expect(page.getByTestId('comment').filter({ hasText: text })).toBeVisible()
}

async function reloadWithReadMarks(page: Page) {
  const loaded = page.waitForResponse((r) => r.url().includes('/api/seen') && r.request().method() === 'GET')
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  expect((await loaded).ok()).toBe(true)
}

test("a friend's comment shows up live on the card, the board and New for you; opening the thread clears it for good", async ({ page, browser }) => {
  const rex = await person(page, browser, 'rex'), fido = await person(page, browser, 'fido')
  try {
    const board = await sharedBoard(rex, fido)
    await openWithReadMarks(rex, board.id)
    await expect(rex.page.getByTestId('unread-button')).toHaveCount(0)

    // fido comments, typing it in.
    await fido.page.goto(`/#/b/${board.id}`)
    await dragBy(fido.page, cardByText(fido.page, board.notes[0]), 12, 0)
    await runCardAction(fido.page, 'Comment')
    await send(fido.page, 'Who hid the ball?')
    await waitForSync(fido.page)

    // rex has the board open: the dot arrives by itself.
    const card = cardByText(rex.page, board.notes[0])
    await expect(card.getByTestId('comment-unread')).toBeVisible()
    await expect(card.getByRole('button', { name: '1 unread comment' })).toBeVisible()
    await expect(cardByText(rex.page, board.notes[1]).getByTestId('comment-badge')).toHaveCount(0)
    const bell = rex.page.getByTestId('unread-button')
    await expect(bell).toHaveAccessibleName('New for you: 1 unread comment')
    await expect(rex.page.getByTestId('unread-count')).toHaveText(' · 1')

    // The board is inside his Doghouse: the Boards list and the board's tile both show it.
    await rex.page.getByTestId('board-navigation').click()
    const home = rex.page.getByTestId('personal-home')
    await expect(home.getByTestId('nav-unread')).toHaveAccessibleName('1 unread comment')
    await home.click()
    await expect(rex.page.getByTestId('board-unread')).toHaveAccessibleName('1 unread comment inside')

    // New for you lists the thread; Go to opens the board and the thread.
    await bell.click()
    const panel = rex.page.getByTestId('unread-panel')
    await expect(panel).toBeVisible()
    const row = panel.getByTestId('unread-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(fido.username)
    await expect(row).toContainText('Who hid the ball?')
    await expect(row).toContainText(board.title)
    await row.click()
    await expect(rex.page.getByTestId('board-name')).toHaveText(board.title)
    await expect(rex.page.getByTestId('comments-panel')).toContainText('Who hid the ball?')

    // Seen: every dot goes.
    await expect(card.getByTestId('comment-unread')).toHaveCount(0)
    await expect(card.getByTestId('comment-badge')).toHaveText('1')
    await expect(bell).toHaveCount(0)

    // His own reply never counts.
    await send(rex.page, 'Not me, honest')
    await waitForSync(rex.page)
    await expect(card.getByTestId('comment-unread')).toHaveCount(0)

    // A reply from fido while rex has the thread open is seen at once.
    await send(fido.page, 'Then who?')
    await expect(rex.page.getByTestId('comments-panel')).toContainText('Then who?')
    await expect(card.getByTestId('comment-badge')).toHaveText('3')
    await expect(bell).toHaveCount(0)

    // Kept on the server: after a reload it's still read.
    await reloadWithReadMarks(rex.page)
    await expect(cardByText(rex.page, board.notes[0]).getByTestId('comment-badge')).toHaveText('3')
    await expect(rex.page.getByTestId('comment-unread')).toHaveCount(0)
    await expect(rex.page.getByTestId('unread-button')).toHaveCount(0)
  } finally {
    await rex.context.close()
    await fido.context.close()
  }
})

test('Mark all as read clears every thread and stays cleared; a deleted comment stops counting', async ({ page, browser }) => {
  const rex = await person(page, browser, 'rex'), fido = await person(page, browser, 'fido')
  try {
    const board = await sharedBoard(rex, fido)
    await openWithReadMarks(rex, board.id)
    await commentVia(fido, board.id, board.noteIds[0], 'First sniff')
    await commentVia(fido, board.id, board.noteIds[1], 'Second sniff')
    await commentVia(fido, board.id, board.noteIds[1], 'And another')

    const bell = rex.page.getByTestId('unread-button')
    await expect(rex.page.getByTestId('unread-count')).toHaveText(' · 3')
    await expect(cardByText(rex.page, board.notes[1]).getByRole('button', { name: '2 unread comments' })).toBeVisible()
    await reloadWithReadMarks(rex.page)
    await expect(rex.page.getByTestId('unread-count')).toHaveText(' · 3')

    await bell.click()
    const panel = rex.page.getByTestId('unread-panel')
    // Newest first, one row per thread.
    await expect(panel.getByTestId('unread-row')).toHaveCount(2)
    await expect(panel.getByTestId('unread-row').first()).toContainText('And another')
    await expect(panel.getByTestId('unread-row').first()).toContainText('2 new')
    await panel.getByTestId('unread-mark-all').click()
    await expect(panel.getByTestId('unread-empty')).toHaveText('All caught up. Good dog!')
    await expect(panel.getByTestId('unread-mark-all')).toHaveCount(0)
    await rex.page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(bell).toHaveCount(0)
    await expect(rex.page.getByTestId('comment-unread')).toHaveCount(0)

    await reloadWithReadMarks(rex.page)
    await expect(cardByText(rex.page, board.notes[1]).getByTestId('comment-badge')).toHaveText('2')
    await expect(rex.page.getByTestId('unread-button')).toHaveCount(0)

    // fido says something, then takes it back: it's private to him again, so it can't count.
    const id = crypto.randomUUID()
    expect((await postSync(fido.context.request, { data: { changes: [{ id, patch: { id, kind: 'comment', boardId: board.id, cardId: board.noteIds[0], authorId: fido.id, author: fido.username, text: 'Oops, wrong board', createdAt: Date.now() } }] } })).ok()).toBe(true)
    await expect(cardByText(rex.page, board.notes[0]).getByTestId('comment-unread')).toBeVisible()
    expect((await postSync(fido.context.request, { data: { changes: [{ id, patch: { deletedAt: Date.now() } }] } })).ok()).toBe(true)
    await expect(cardByText(rex.page, board.notes[0]).getByTestId('comment-unread')).toHaveCount(0)
    await expect(rex.page.getByTestId('unread-button')).toHaveCount(0)
  } finally {
    await rex.context.close()
    await fido.context.close()
  }
})
