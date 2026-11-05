import { expect, test } from '@playwright/test'
import { waitForSync } from './helpers.ts'
import { boards, person } from './people.ts'

test('the Your spaces sheet stars the current board and lists it under Favourites', async ({ page, browser }) => {
  const me = await person(page, browser, 'phonestar')
  try {
    const [board] = await boards(me, [{ title: 'Pocket plans' }])
    const phone = await me.context.newPage()
    await phone.goto(`/#/b/${board}`)
    await waitForSync(phone)
    await phone.getByTestId('board-name').tap()
    const sheet = phone.getByTestId('board-navigation-menu')
    const add = sheet.getByTestId('favourite-current-board')
    await expect(add).toHaveText('Add to Favourites')
    await add.tap()
    await expect(add).toHaveText('Remove from Favourites')
    const row = sheet.locator('.nav-menu-starred').filter({ hasText: 'Pocket plans' })
    await expect(row).toBeVisible()
    // On touch the star is always showing, with a full-size target.
    const star = row.getByTestId('favourite-board')
    await expect(star).toBeVisible()
    expect((await star.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await star.tap()
    await expect(row).toHaveCount(0)
    await expect(add).toHaveText('Add to Favourites')
  } finally { await me.context.close() }
})
