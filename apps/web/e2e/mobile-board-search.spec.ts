import { expect, test } from '@playwright/test'
import { waitForSync } from './helpers.ts'
import { boards, person } from './people.ts'

test('on a phone, Find a board waits for a tap, then a tapped result opens the board', async ({ page, browser }) => {
  const me = await person(page, browser, 'phonefind')
  try {
    const [parent] = await boards(me, [{ title: 'Pocket garden' }])
    await boards(me, [{ title: 'Tomato seedlings', parentId: parent }])
    const phone = await me.context.newPage()
    await phone.goto('/')
    await waitForSync(phone)
    await phone.getByTestId('board-name').tap()
    const sheet = phone.getByTestId('board-navigation-menu')
    const field = sheet.getByTestId('board-search')
    await expect(field).toBeVisible()
    // Opening the sheet doesn't raise the keyboard over the lists.
    await expect(field).not.toBeFocused()
    expect((await field.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await field.tap()
    await field.fill('tomato')
    const result = sheet.getByTestId('board-search-result')
    await expect(result).toHaveCount(1)
    await expect(result.locator('.nav-menu-meta')).toHaveText('in Pocket garden')
    await result.tap()
    await expect(phone.getByTestId('board-name')).toHaveText('Tomato seedlings')
  } finally { await me.context.close() }
})
