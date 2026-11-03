import { expect, test, type Page } from '@playwright/test'
import { waitForSync } from './helpers.ts'
import { boards, grant, person } from './people.ts'

async function openMenu(page: Page) {
  await page.getByTestId('board-navigation').click()
  return page.getByTestId('board-navigation-menu')
}

test('Shared with me lists the top of each shared tree, newest first, with who shared it', async ({ page, browser }) => {
  const alice = await person(page, browser, 'sharer')
  const bob = await person(page, browser, 'friend')
  try {
    const [older, viewOnly, newer] = await boards(alice, [{ title: 'Older walk plans' }, { title: 'Look but no chew' }, { title: 'Newer treat ideas' }])
    await boards(alice, [{ title: 'Inner walk route', parentId: older }])
    await grant(alice, older, bob)
    await grant(alice, viewOnly, bob, 'view')
    await grant(alice, newer, bob)
    // Alice makes a board inside one of Bob's: Bob can already reach it from his own board.
    const [bobs] = await boards(bob, [{ title: 'Bob’s workshop' }])
    await grant(bob, bobs, alice)
    await boards(alice, [{ title: 'Alice’s bench in Bob’s workshop', parentId: bobs }])

    const bobPage = await bob.context.newPage()
    await bobPage.goto('/')
    await waitForSync(bobPage)
    const menu = await openMenu(bobPage)
    const rows = menu.getByTestId('shared-board-link')
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('.nav-menu-label')).toHaveText(['Newer treat ideas', 'Look but no chew', 'Older walk plans'])
    // Who shared it is an avatar in their colour; the row's name spells it out.
    await expect(rows.nth(0).getByTestId('shared-by')).toHaveText(alice.username.slice(0, 2).toUpperCase())
    await expect(rows.nth(0).getByTestId('shared-by')).toHaveAttribute('title', `Shared by ${alice.username}`)
    await expect(rows.nth(0)).toHaveAccessibleName(`Newer treat ideas, Shared by ${alice.username}`)
    await expect(rows.nth(1).locator('.nav-menu-meta')).toContainText('View only')
    await expect(rows.nth(1)).toHaveAccessibleName(`Look but no chew, Shared by ${alice.username}, View only`)
    // Places come first, then the lists under their headings.
    await expect(menu.locator('.nav-menu-row, .nav-menu-section-label').first()).toHaveAttribute('data-testid', 'personal-home')
    await expect(menu).not.toContainText('Inner walk route')
    await expect(menu).not.toContainText('Alice’s bench')
    await expect(menu).not.toContainText('Can edit')
  } finally { await alice.context.close(); await bob.context.close() }
})

test('Shared with me shows five boards until Show all, and Recent lists boards you were just on', async ({ page, browser }) => {
  const alice = await person(page, browser, 'manyshares')
  const bob = await person(page, browser, 'manyfriend')
  try {
    const titles = Array.from({ length: 7 }, (_, i) => `Shared pile ${i + 1}`)
    for (const id of await boards(alice, titles.map((title) => ({ title })))) await grant(alice, id, bob)

    const bobPage = await bob.context.newPage()
    await bobPage.goto('/')
    await waitForSync(bobPage)
    let menu = await openMenu(bobPage)
    const rows = menu.getByTestId('shared-board-link')
    await expect(rows).toHaveCount(5)
    await expect(rows.first()).toContainText('Shared pile 7')
    const more = menu.getByTestId('shared-show-all')
    await expect(more).toHaveText('Show all (7)')
    await more.click()
    await expect(rows).toHaveCount(7)
    await expect(more).toHaveCount(0)
    await expect(rows.nth(5)).toBeFocused()

    await rows.nth(6).click()
    await expect(bobPage.getByTestId('board-name')).toHaveText('Shared pile 1')
    menu = await openMenu(bobPage)
    // The list folds back to five each time the menu opens.
    await expect(menu.getByTestId('shared-board-link')).toHaveCount(5)
    await menu.getByTestId('shared-board-link').first().click()
    await expect(bobPage.getByTestId('board-name')).toHaveText('Shared pile 7')
    menu = await openMenu(bobPage)
    await expect(menu.getByTestId('recent-board').first()).toHaveText('Shared pile 1')
    await expect(menu.getByTestId('recent-board').filter({ hasText: 'Shared pile 7' })).toHaveCount(0)
  } finally { await alice.context.close(); await bob.context.close() }
})
