import { expect, test, type Page } from '@playwright/test'
import { MOD, waitForSync } from './helpers.ts'
import { boards, person } from './people.ts'

async function openMenu(page: Page) {
  await page.getByTestId('board-navigation').click()
  return page.getByTestId('board-navigation-menu')
}

test('Find a board searches every board by title, shows where it lives, and opens it from the keyboard', async ({ page, browser }) => {
  const me = await person(page, browser, 'finder')
  try {
    const [garage] = await boards(me, [{ title: 'Garage projects' }])
    await boards(me, [{ title: 'Jeep wiring harness' }, { title: 'Bike wheel truing' }])
    const [, wiring] = await boards(me, [{ title: 'Spare parts', parentId: garage }, { title: 'Van wiring', parentId: garage }])
    const p = await me.context.newPage()
    await p.goto('/')
    await waitForSync(p)

    const menu = await openMenu(p)
    const field = menu.getByTestId('board-search')
    await expect(field).toBeFocused()
    await field.fill('wiring')
    const results = menu.getByTestId('board-search-result')
    await expect(results.locator('.nav-menu-label')).toHaveText(['Jeep wiring harness', 'Van wiring'])
    await expect(results.nth(1).locator('.nav-menu-meta')).toHaveText('in Garage projects')
    await expect(menu.getByText('Shared with me')).toHaveCount(0)

    // Arrow down into the results, Enter opens the board.
    await p.keyboard.press('ArrowDown')
    await expect(results.first()).toBeFocused()
    await p.keyboard.press('ArrowDown')
    await expect(results.nth(1)).toBeFocused()
    await p.keyboard.press('Enter')
    await expect(p.getByTestId('board-name')).toHaveText('Van wiring')
    expect(p.url()).toContain(wiring)

    // Enter in the field opens the best match; the field is empty again next time.
    await openMenu(p)
    await expect(field).toHaveValue('')
    await field.fill('garage')
    await p.keyboard.press('Enter')
    await expect(p.getByTestId('board-name')).toHaveText('Garage projects')

    await openMenu(p)
    await field.fill('zzz no such board')
    await expect(menu).toContainText('No board by that name.')
    await p.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(p.getByTestId('board-navigation')).toBeFocused()
  } finally { await me.context.close() }
})

test('Fetch opens on your Favourites and Recent boards, so ⌘K then Enter jumps to the first favourite', async ({ page, browser }) => {
  const me = await person(page, browser, 'fetcher')
  try {
    const [starred, visited] = await boards(me, [{ title: 'Starred kennel plans' }, { title: 'Visited walk log' }])
    const p = await me.context.newPage()
    await p.goto(`/#/b/${starred}`)
    await waitForSync(p)
    await p.getByTestId('favourite-board').click()
    await p.goto(`/#/b/${visited}`)
    await waitForSync(p)
    await p.goto('/#/b/' + me.home)
    await waitForSync(p)

    await p.keyboard.press(`${MOD}+k`)
    const hits = p.getByTestId('fetch-hit')
    await expect(hits.locator('.fetch-title')).toHaveText(['Starred kennel plans', 'Visited walk log'])
    await expect(hits.locator('.fetch-snippet')).toHaveText(['Favourite', 'Recent'])
    await expect(hits.first()).toHaveAttribute('aria-selected', 'true')
    await p.keyboard.press('Enter')
    await expect(p.getByTestId('fetch')).toHaveCount(0)
    await expect(p.getByTestId('board-name')).toHaveText('Starred kennel plans')
  } finally { await me.context.close() }
})
