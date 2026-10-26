import { expect, test } from '@playwright/test'
import { cardByText } from './helpers.ts'
import { commentVia, openWithReadMarks, person, sharedBoard } from './unread-fixture.ts'

// On a phone, New for you is a bell in the header that opens a bottom sheet.

test('New for you opens as a sheet; Go to opens the thread and clears the dots', async ({ page, browser }) => {
  const rex = await person(page, browser, 'rex'), fido = await person(page, browser, 'fido')
  try {
    const board = await sharedBoard(rex, fido)
    await openWithReadMarks(rex, board.id)
    await commentVia(fido, board.id, board.noteIds[0], 'Treats by the gate')

    const card = cardByText(rex.page, board.notes[0])
    await expect(card.getByTestId('comment-unread')).toBeVisible()
    const bell = rex.page.getByTestId('unread-button')
    await expect(bell).toHaveAccessibleName('New for you: 1 unread comment')
    const box = (await bell.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(40)
    expect(box.height).toBeGreaterThanOrEqual(40)
    // The header still fits the phone.
    expect(await rex.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    await bell.tap()
    const sheet = rex.page.getByTestId('unread-panel')
    await expect(sheet).toBeVisible()
    // A bottom sheet: full width, resting on the bottom edge once it has risen.
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))))
    const s = (await sheet.boundingBox())!, v = rex.page.viewportSize()!
    expect(s.width).toBeGreaterThanOrEqual(v.width - 1)
    expect(Math.abs(s.y + s.height - v.height)).toBeLessThanOrEqual(2)
    const row = sheet.getByTestId('unread-row')
    await expect(row).toBeVisible()
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(row).toContainText('Treats by the gate')
    await row.tap()

    await expect(rex.page.getByTestId('comments-panel')).toContainText('Treats by the gate')
    await expect(card.getByTestId('comment-unread')).toHaveCount(0)
    await expect(bell).toHaveCount(0)
  } finally {
    await rex.context.close()
    await fido.context.close()
  }
})
