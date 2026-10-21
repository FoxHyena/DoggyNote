import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { MOD, addNote, cardByText, freshBoard, waitForSync } from './helpers.ts'

test('collaboration visual evidence @visual', async ({ page, browser, browserName }) => {
  test.skip(process.env.MULTIPLAYER_SHOTS !== '1', 'Run explicitly for the bounded visual review')
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await freshBoard(page, 'Weekend with the pack')
  await addNote(page, '## Weekend plans\nBring ideas, leave room for each other.\n- [ ] Pick a trail\n- [ ] Pack snacks', .38, .35)
  await addNote(page, '## Good ideas travel together\nA shared corner for the next adventure.', .7, .65)
  await waitForSync(page)
  const board = page.url().split('/b/')[1]!
  await page.request.post(`/api/boards/${board}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: false } })
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' }, viewport: { width: 1440, height: 900 } })
  try {
    await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })
    const friend = await context.newPage()
    await friend.goto(page.url())
    await cardByText(friend, 'Weekend plans').click()
    await friend.keyboard.press(`${MOD}+Home`)
    const canvas = (await friend.getByTestId('canvas').boundingBox())!
    await friend.mouse.move(canvas.x + canvas.width * .55, canvas.y + canvas.height * .45)
    await expect(page.getByTestId('remote-selection')).toBeVisible()
    const directory = `../../docs/qa/multiplayer/${process.env.MULTIPLAYER_ROUND ?? 'round-1'}`
    mkdirSync(directory, { recursive: true })
    for (const theme of ['light', 'dark']) {
      await page.evaluate((mode) => { localStorage.setItem('doggynote.theme', mode); document.documentElement.dataset.theme = mode }, theme)
      await page.getByTestId('collaborators').click()
      await expect(page.getByTestId('participant')).toHaveCount(2)
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
      await page.screenshot({ path: `${directory}/${browserName}-${theme}-people.png` })
      await page.keyboard.press('Escape')
      await page.getByTestId('collaborators').click()
      await page.getByRole('button', { name: 'Follow fido', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Stop following' })).toBeVisible()
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
      await page.screenshot({ path: `${directory}/${browserName}-${theme}-following.png` })
      await page.getByRole('button', { name: 'Stop following' }).click()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate((mode) => { document.documentElement.dataset.theme = mode }, theme)
      await page.getByTestId('collaborators').click()
      await expect(page.getByTestId('participant')).toHaveCount(2)
      const trigger = (await page.getByTestId('collaborators').boundingBox())!, panel = (await page.locator('.people-menu').boundingBox())!
      expect(trigger.width).toBeGreaterThanOrEqual(44); expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(390)
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
      await page.screenshot({ path: `${directory}/${browserName}-${theme}-phone.png` })
      await page.keyboard.press('Escape')
    }
  } finally { await context.close() }
})
