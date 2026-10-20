import { expect, test, type Page } from '@playwright/test'
import { MOD, clickEmpty, freshBoard, waitForSync } from './helpers.ts'
import { seedCards } from './touch.ts'

// To-do lists tidy themselves: a ticked task sinks below the open ones a beat
// later, says when it was done, and done tasks can be folded away or cleared.

const DAY = 86_400_000
type Item = { id: string; text: string; done: boolean; doneAt?: number | null }
const item = (text: string, done = false, doneAt?: number): Item => ({ id: text.toLowerCase().replace(/\W+/g, '-'), text, done, ...(doneAt ? { doneAt } : {}) })

async function seedList(page: Page, items: Item[], extra: Record<string, unknown> = {}) {
  await seedCards(page, [{ type: 'todo', x: 0, y: 0, w: 280, content: { title: 'Chores', items, ...extra } }])
  return page.locator('[data-type=todo]').first()
}
const order = (page: Page) => page.locator('[data-type=todo] .todo-item .todo-text')
const texts = async (page: Page) => (await order(page).evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? '')))

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test('a ticked task sinks below the open ones a beat later; one undo restores both', async ({ page }) => {
  const list = await seedList(page, [item('Vacuum'), item('Dishes'), item('Laundry'), item('Kibble', true, Date.now() - DAY)])
  await list.getByRole('checkbox', { name: 'Vacuum' }).check()
  // Not straight away: a misclick can be unticked where it is.
  expect(await texts(page)).toEqual(['Vacuum', 'Dishes', 'Laundry', 'Kibble'])
  await expect.poll(() => texts(page)).toEqual(['Dishes', 'Laundry', 'Vacuum', 'Kibble'])
  await expect(list.locator('.todo-item', { hasText: 'Vacuum' }).getByTestId('todo-done-at')).toHaveText('done today')
  await expect(list.locator('.todo-item', { hasText: 'Kibble' }).getByTestId('todo-done-at')).toHaveText('done yesterday')
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(() => texts(page)).toEqual(['Vacuum', 'Dishes', 'Laundry', 'Kibble'])
  await expect(list.getByRole('checkbox', { name: 'Vacuum' })).not.toBeChecked()
  await waitForSync(page)
  await page.reload()
  await expect.poll(() => texts(page)).toEqual(['Vacuum', 'Dishes', 'Laundry', 'Kibble'])
})

test('a quick untick stays put; an untick from the done tasks rises to the end of the open ones', async ({ page }) => {
  const list = await seedList(page, [item('Vacuum'), item('Dishes'), item('Kibble', true, Date.now()), item('Bowl', true, Date.now())])
  const vacuum = list.getByRole('checkbox', { name: 'Vacuum' })
  await vacuum.check()
  await vacuum.uncheck()
  await page.waitForTimeout(1200)
  expect(await texts(page)).toEqual(['Vacuum', 'Dishes', 'Kibble', 'Bowl'])
  await list.getByRole('checkbox', { name: 'Bowl' }).uncheck()
  await expect.poll(() => texts(page)).toEqual(['Vacuum', 'Dishes', 'Bowl', 'Kibble'])
  await expect(list.locator('.todo-item', { hasText: 'Bowl' }).getByTestId('todo-done-at')).toHaveCount(0)
})

test('tasks ticked while editing settle when editing ends', async ({ page }) => {
  const list = await seedList(page, [item('Vacuum'), item('Dishes')])
  await list.locator('.todo-text', { hasText: 'Dishes' }).click()
  await expect(page.getByTestId('todo-item-input').first()).toBeVisible()
  await list.getByRole('checkbox', { name: 'Vacuum' }).check()
  await page.waitForTimeout(1000)
  expect(await page.getByTestId('todo-item-input').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))).toEqual(['Vacuum', 'Dishes'])
  await page.keyboard.press('Escape')
  await expect.poll(() => texts(page)).toEqual(['Dishes', 'Vacuum'])
  // Editing and the settle are one undo step.
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(() => texts(page)).toEqual(['Vacuum', 'Dishes'])
})

test('list options: keep manual order, fold done tasks away, clear them with undo', async ({ page }) => {
  // A hand-ordered list with sorting off keeps its order.
  const list = await seedList(page, [item('Vacuum'), item('Kibble', true, Date.now()), item('Dishes'), item('Bowl', true, Date.now())], { sortDone: false })
  await list.locator('.todo-title').click()
  await page.getByTestId('todo-options').click()
  await expect(page.getByTestId('todo-sort-done')).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await list.getByRole('checkbox', { name: 'Vacuum' }).check()
  await page.waitForTimeout(1200)
  expect(await texts(page)).toEqual(['Vacuum', 'Kibble', 'Dishes', 'Bowl'])

  // Turning sorting back on tidies the list.
  await list.locator('.todo-title').click()
  await page.getByTestId('todo-options').click()
  await page.getByTestId('todo-sort-done').click()
  await page.getByTestId('todo-hide-done').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect.poll(() => texts(page)).toEqual(['Dishes'])
  await expect(page.getByTestId('todo-done-toggle')).toHaveText('3 done')
  await page.getByTestId('todo-done-toggle').click()
  // Sorting came back on, so the list tidied: Vacuum now sits with the done tasks.
  await expect.poll(() => texts(page)).toEqual(['Dishes', 'Vacuum', 'Kibble', 'Bowl'])
  await page.getByTestId('todo-done-toggle').click()

  await list.locator('.todo-title').click()
  await page.getByTestId('todo-options').click()
  await page.getByTestId('todo-clear-done').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('todo-done-toggle')).toHaveCount(0)
  expect(await texts(page)).toEqual(['Dishes'])
  await page.getByTestId('toast-action').click()
  await expect(page.getByTestId('todo-done-toggle')).toHaveText('3 done')
})

test('with done tasks folded away, a tick stays in view until it settles', async ({ page }) => {
  const list = await seedList(page, [item('Vacuum'), item('Dishes'), item('Kibble', true, Date.now())], { hideDone: true })
  await list.getByRole('checkbox', { name: 'Vacuum' }).check()
  expect(await texts(page)).toEqual(['Vacuum', 'Dishes'])
  await expect.poll(() => texts(page)).toEqual(['Dishes'])
  await expect(page.getByTestId('todo-done-toggle')).toHaveText('2 done')
})

test('a list that arrives out of order is tidied when shown, if sorting is on', async ({ page }) => {
  await seedCards(page, [{ type: 'todo', w: 260, content: { title: 'Arrived mixed', items: [
    { id: 'a', text: 'Done first', done: true, doneAt: Date.now() },
    { id: 'b', text: 'Still to do', done: false },
    { id: 'c', text: 'Done too', done: true, doneAt: Date.now() },
    { id: 'd', text: 'Also to do', done: false },
  ] } }])
  await expect(page.locator('[data-type=todo] .todo-item')).toHaveText([/Still to do/, /Also to do/, /Done first/, /Done too/])
})

test('Clear done from the List menu while typing in the list: shows at once, and ⌘Z brings them back', async ({ page }) => {
  await seedCards(page, [{ type: 'todo', w: 260, content: { title: 'Chores', items: [{ id: 'a', text: 'Vacuum', done: false }, { id: 'b', text: 'Dishes', done: true, doneAt: Date.now() }] } }])
  await page.locator('[data-type=todo] .todo-item', { hasText: 'Vacuum' }).click()
  await expect(page.getByTestId('todo-item-input').first()).toBeVisible()
  await page.getByTestId('todo-options').click()
  await page.getByTestId('todo-clear-done').click()
  await expect(page.getByTestId('todo-item-input')).toHaveCount(0)
  await expect(page.locator('[data-type=todo] .todo-item')).toHaveText([/Vacuum/])
  await page.keyboard.press(`${MOD}+Z`)
  await expect(page.locator('[data-type=todo] .todo-item')).toHaveText([/Vacuum/, /Dishes/])
})
