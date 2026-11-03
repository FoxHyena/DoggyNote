import { expect, test, type Page } from '@playwright/test'
import { waitForSync } from './helpers.ts'
import { boards, grant, person, signIn } from './people.ts'

async function openMenu(page: Page) {
  await page.getByTestId('board-navigation').click()
  return page.getByTestId('board-navigation-menu')
}

test('a star in the top bar adds a Favourite that follows you to another device, and the menu star removes it', async ({ page, browser }) => {
  const me = await person(page, browser, 'stars')
  try {
    const [walks, treats] = await boards(me, [{ title: 'Walk routes' }, { title: 'Treat jar' }])
    const mac = await me.context.newPage()
    await mac.goto(`/#/b/${walks}`)
    await waitForSync(mac)
    const star = mac.getByTestId('favourite-board')
    await expect(star).toHaveAttribute('aria-pressed', 'false')
    await star.click()
    await expect(star).toHaveAttribute('aria-pressed', 'true')
    await expect(star).toHaveAccessibleName('Remove from Favourites')
    await mac.goto(`/#/b/${treats}`)
    await waitForSync(mac)

    let menu = await openMenu(mac)
    await expect(menu.getByTestId('favourite-board-link')).toHaveText(['Walk routes'])
    // A favourite isn't repeated under Recent.
    await expect(menu.getByTestId('recent-board').filter({ hasText: 'Walk routes' })).toHaveCount(0)
    await mac.keyboard.press('Escape')

    // A second device signed in to the same account gets the star and the recent board.
    const other = await signIn(browser, me.username)
    try {
      const phone = await other.newPage()
      await phone.goto('/')
      await waitForSync(phone)
      menu = await openMenu(phone)
      await expect(menu.getByTestId('favourite-board-link')).toHaveText(['Walk routes'])
      await expect(menu.getByTestId('recent-board').first()).toHaveText('Treat jar')
      await phone.keyboard.press('Escape')

      // Unstar from the first device's menu: the row goes and focus stays in the menu.
      menu = await openMenu(mac)
      const row = menu.locator('.nav-menu-starred').filter({ hasText: 'Walk routes' })
      await row.hover()
      await row.getByTestId('favourite-board').click()
      await expect(menu.getByTestId('favourite-board-link')).toHaveCount(0)
      await expect(mac.getByTestId('personal-home')).toBeFocused()
      await mac.keyboard.press('Escape')

      await expect.poll(async () => (await (await me.api.get('/api/board-preferences')).json()).preferences.find((p: { boardId: string }) => p.boardId === walks)?.favoriteAt ?? null).toBeNull()
      // Picking the other device back up brings its stars up to date.
      await phone.evaluate(() => window.dispatchEvent(new Event('focus')))
      menu = await openMenu(phone)
      await expect(menu.getByTestId('favourite-board-link')).toHaveCount(0)
    } finally { await other.close() }
  } finally { await me.context.close() }
})

test('board preferences only accept and return boards you can open', async ({ page, browser }) => {
  const owner = await person(page, browser, 'prefowner')
  const friend = await person(page, browser, 'preffriend')
  try {
    const [secret, shared] = await boards(owner, [{ title: 'Private den' }, { title: 'Shared den' }])
    expect((await friend.api.post(`/api/board-preferences/${secret}`, { data: { favorite: true } })).status()).toBe(403)
    expect((await friend.api.post(`/api/board-preferences/toybox:${owner.id}`, { data: { opened: true } })).status()).toBe(403)
    expect((await friend.api.post(`/api/board-preferences/${friend.home}`, { data: { favorite: 'yes' } })).status()).toBe(400)
    expect((await friend.api.post(`/api/board-preferences/${friend.home}`, { data: { colour: 'gold' } })).status()).toBe(400)

    await grant(owner, shared, friend)
    expect((await friend.api.post(`/api/board-preferences/${shared}`, { data: { favorite: true, opened: true } })).ok()).toBe(true)
    const list = async () => (await (await friend.api.get('/api/board-preferences')).json()).preferences.map((p: { boardId: string }) => p.boardId)
    expect(await list()).toContain(shared)

    // Once the share is gone, the star stays hidden, even by ID.
    const members = await (await owner.api.get(`/api/shares?boardId=${shared}`)).json()
    const membership = members.members.find((m: { userId: string }) => m.userId === friend.id)
    expect((await owner.api.delete(`/api/boards/${shared}/members/${membership.id}`)).ok()).toBe(true)
    expect(await list()).not.toContain(shared)
  } finally { await owner.context.close(); await friend.context.close() }
})
