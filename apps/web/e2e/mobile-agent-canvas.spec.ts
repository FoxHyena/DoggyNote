import { expect, test } from '@playwright/test'
import { camera, freshBoard } from './helpers.ts'
import { Fingers, fakeKeyboard, seedCards, tapOn } from './touch.ts'

async function noteFits(page: import('@playwright/test').Page) {
  await expect.poll(() => page.getByTestId('chat-conversation').evaluate((note) => {
    const bounds = note.getBoundingClientRect()
    const controls = [...document.querySelectorAll('.canvas-controls, .mobile-sticker-launcher, .mobile-dock')].map((node) => node.getBoundingClientRect()).filter((r) => r.height && r.top > 100)
    return { leftOverflow: Math.ceil(Math.max(0, -bounds.left)), rightOverflow: Math.ceil(Math.max(0, bounds.right - innerWidth)), bottomOverlap: Math.ceil(Math.max(0, ...controls.map((r) => bounds.bottom - r.top + 8))) }
  }), { message: 'Conversation stays clear of phone tools after focus and context changes' }).toEqual({ leftOverflow: 0, rightOverflow: 0, bottomOverlap: 0 })
}

test('phone context picker, exact inspection and desktop-required state work with taps in both themes', async ({ page }, testInfo) => {
  await freshBoard(page, 'Phone connected context')
  await seedCards(page, [
    { type: 'note', x: 0, y: 0, w: 260, content: { md: '# Phone brief\nA calm, playful launch.' } },
    { type: 'todo', x: 300, y: 0, w: 260, content: { title: 'Phone tasks', items: [{ id: 'park', text: 'Book the park', done: false }] } },
  ])
  await page.getByTestId('dock-add').tap()
  await page.getByTestId('add-chat').tap()
  const dialog = page.getByTestId('chat-conversation')
  await expect(dialog).toBeVisible()
  await noteFits(page)
  await dialog.getByRole('button', { name: 'Inspect context (0)' }).tap()
  const inspector = dialog.getByRole('complementary')
  await inspector.getByRole('button', { name: 'Add context' }).tap()
  await noteFits(page)
  await inspector.getByRole('checkbox', { name: 'Phone brief' }).tap()
  await noteFits(page)
  await inspector.getByRole('checkbox', { name: 'Phone tasks' }).tap()
  await noteFits(page)
  await inspector.getByRole('button', { name: 'Done · inspect changes' }).tap()
  await expect(inspector).toContainText('2 sources')
  await expect(inspector).toContainText('A calm, playful launch.')
  await noteFits(page)
  const beforeScroll = await camera(page)
  await inspector.evaluate((element) => { element.scrollTop = 0 })
  const contextBounds = (await inspector.boundingBox())!
  const finger = new Fingers(page)
  const start = { x: contextBounds.x + contextBounds.width * 0.7, y: contextBounds.y + contextBounds.height - 30 }
  await finger.press(0, start)
  for (let n = 1; n <= 6; n++) await finger.move(0, { x: start.x, y: start.y - n * 25 })
  await finger.release(0)
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await camera(page)).toEqual(beforeScroll)
  await expect(dialog).toContainText('Send messages from the DoggyNote Mac app')
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: `../../docs/qa/agent-canvas/screenshots/context-${testInfo.project.name}-dark.png` })
  await dialog.getByRole('button', { name: 'Close conversation' }).tap()
  await page.evaluate(() => localStorage.setItem('doggynote.theme', 'light'))
  await page.reload()
  await tapOn(page, page.locator('[data-type="chat"]').getByRole('button', { name: 'Open conversation' }))
  await page.getByRole('button', { name: 'Inspect context (2)' }).tap()
  await noteFits(page)
  await expect(page.getByRole('complementary')).toContainText('2 sources')
  await page.screenshot({ path: `../../docs/qa/agent-canvas/screenshots/context-${testInfo.project.name}-light.png` })
  await page.getByRole('button', { name: 'Back to thread' }).tap()
  const sendBounds = await page.getByRole('button', { name: 'Send', exact: true }).boundingBox()
  const noteBounds = await page.getByTestId('chat-conversation').boundingBox()
  expect(sendBounds!.y + sendBounds!.height, 'Send stays inside the conversation note').toBeLessThanOrEqual(noteBounds!.y + noteBounds!.height - 4)
  await page.getByRole('textbox', { name: 'Message', exact: true }).tap()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused()
  expect(await page.getByRole('textbox', { name: 'Message', exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await fakeKeyboard(page, true)
  const visibleHeight = await page.evaluate(() => visualViewport!.height)
  const composerBounds = await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox()
  expect(composerBounds!.y + composerBounds!.height).toBeLessThanOrEqual(visibleHeight)
  await page.screenshot({ path: `../../docs/qa/agent-canvas/screenshots/keyboard-${testInfo.project.name}.png` })
  await fakeKeyboard(page, false)
  await noteFits(page)
})
