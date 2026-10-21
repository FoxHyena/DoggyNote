import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MOD, addNote, clickEmpty, freshBoard, waitForSync } from './helpers.ts'

// Labels open from the selection bar in a small popover: type to filter, click
// to toggle, Enter or Create to make one. Rows rename in place.

const contexts = new Set<BrowserContext>()
test.afterEach(async () => {
  await Promise.all([...contexts].map((c) => c.close()))
  contexts.clear()
})

const popover = (page: Page) => page.getByTestId('labels-popover')
const row = (page: Page, name: string) => popover(page).locator(`[data-testid="label-row"][data-label="${name}"]`)
const chips = (card: ReturnType<Page['locator']>) => card.getByTestId('card-labels').locator('.label-chip')

const textColor = (el: ReturnType<Page['locator']>) => el.evaluate((e) => getComputedStyle(e).color)
const background = (el: ReturnType<Page['locator']>) => el.evaluate((e) => getComputedStyle(e).backgroundColor)
/** A theme colour as the browser computes it. */
const token = (page: Page, name: string) => page.evaluate((n) => {
  const probe = document.body.appendChild(document.createElement('div'))
  probe.style.background = `var(${n})`
  const value = getComputedStyle(probe).backgroundColor
  probe.remove()
  return value
}, name)

async function openLabels(page: Page, card: ReturnType<Page['locator']>) {
  // A click on a card that's already selected would edit it; start from nothing selected.
  await clickEmpty(page)
  await expect(card).not.toHaveClass(/selected/)
  await card.click()
  await expect(card).toHaveClass(/selected/)
  await page.getByTestId('labels-button').click()
  await expect(popover(page)).toBeVisible()
  await expect(page.getByTestId('labels-input')).toBeFocused()
}

async function friend(browser: Browser, owner: Page) {
  const id = owner.url().split('/b/')[1]!
  const grant = await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(owner.url())
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}

test('create, filter, toggle and rename labels in place; they persist and reach a friend; Fetch finds them', async ({ page, browser }) => {
  await freshBoard(page)
  // Tests share a server: a unique note and label keep Fetch's results to this one.
  const tag = Math.random().toString(36).slice(2, 7)
  const card = await addNote(page, `Warm side light ${tag}`)
  await openLabels(page, card)

  // A small panel anchored to the button, not a full-screen dialog.
  const anchor = (await page.getByTestId('labels-button').boundingBox())!
  const box = (await popover(page).boundingBox())!
  expect(box.width).toBeLessThan(340)
  expect(Math.abs(box.x - anchor.x)).toBeLessThan(anchor.width + 16)

  // Type a new name: Create appears with colour presets; pick one, press Enter.
  await page.keyboard.type('Lighting')
  await expect(page.getByTestId('label-create')).toContainText('Lighting')
  await popover(page).locator('[data-testid="label-color"][data-color="gold"]').click()
  await page.getByTestId('labels-input').press('Enter')
  await expect(chips(card)).toHaveText(['Lighting'])
  await expect(row(page, 'Lighting').getByTestId('label-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('labels-input')).toHaveValue('')
  // Gold chip, from the theme.
  expect(await background(chips(card).first())).toBe(await token(page, '--dn-card-gold-bg'))

  // A second one through the Create button.
  await page.getByTestId('labels-input').fill('Question')
  await page.getByTestId('label-create').click()
  await expect(chips(card)).toHaveText(['Lighting', 'Question'])

  // Typing filters the list.
  await page.getByTestId('labels-input').fill('ligh')
  await expect(popover(page).getByTestId('label-row')).toHaveCount(1)
  await expect(page.getByTestId('label-create')).toContainText('ligh')
  await page.getByTestId('labels-input').fill('')
  await expect(popover(page).getByTestId('label-row')).toHaveCount(2)

  // Toggle off and on.
  await row(page, 'Question').getByTestId('label-toggle').click()
  await expect(chips(card)).toHaveText(['Lighting'])
  await expect(row(page, 'Question').getByTestId('label-toggle')).toHaveAttribute('aria-pressed', 'false')
  await row(page, 'Question').getByTestId('label-toggle').click()
  await expect(chips(card)).toHaveText(['Lighting', 'Question'])
  // Enter on an exact name toggles it rather than making a duplicate.
  await page.getByTestId('labels-input').fill('question')
  await page.getByTestId('labels-input').press('Enter')
  await expect(chips(card)).toHaveText(['Lighting'])
  await expect(popover(page).getByTestId('label-row')).toHaveCount(2)

  // Rename in place: the row becomes a field. Escape cancels and keeps the popover open.
  await row(page, 'Lighting').hover()
  await row(page, 'Lighting').getByTestId('label-rename').click()
  const field = page.getByTestId('label-rename-input')
  await expect(field).toBeFocused()
  await expect(popover(page).getByRole('button', { name: /save|cancel/i })).toHaveCount(0)
  await field.fill('Nope')
  await field.press('Escape')
  await expect(popover(page)).toBeVisible()
  await expect(field).toHaveCount(0)
  await expect(chips(card)).toHaveText(['Lighting'])
  // Double-click the chip to rename. It doesn't toggle the label on the way. Enter saves.
  await row(page, 'Lighting').getByTestId('label-chip').dblclick()
  await expect(field).toBeFocused()
  await expect(chips(card)).toHaveText(['Lighting'])
  await field.fill(`Side lighting ${tag}`)
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  await expect(chips(card)).toHaveText([`Side lighting ${tag}`])
  await expect(popover(page)).toBeVisible()

  // Escape (outside a rename) closes the popover.
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)

  // Reload: it's all still there.
  await waitForSync(page)
  await page.reload()
  const reloaded = page.locator(`[data-card-id="${await card.getAttribute('data-card-id')}"]`)
  await expect(chips(reloaded)).toHaveText([`Side lighting ${tag}`])

  // Someone else on the board sees it.
  const other = await friend(browser, page)
  await expect(chips(other.locator(`[data-card-id="${await card.getAttribute('data-card-id')}"]`))).toHaveText([`Side lighting ${tag}`])

  // Fetch finds the card by its label.
  await page.bringToFront()
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+k`)
  // The note's text doesn't say "lighting": only its label does.
  await page.getByTestId('fetch-input').fill(`lighting ${tag}`)
  const hit = page.getByTestId('fetch-hit')
  await expect(hit).toHaveCount(1)
  await expect(hit).toContainText(`Warm side light ${tag}`)
  await expect(hit).toContainText(`Side lighting ${tag}`)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('fetch')).toHaveCount(0)
  await expect(reloaded).toHaveClass(/selected/)
})

test('labels on two cards edited at once by two people both survive', async ({ page, browser }) => {
  await freshBoard(page)
  const a = await addNote(page, 'Card A', 0.3, 0.4)
  const b = await addNote(page, 'Card B', 0.7, 0.4)
  await openLabels(page, a)
  await page.keyboard.type('Ours')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await waitForSync(page)

  const other = await friend(browser, page)
  const otherB = other.locator(`[data-card-id="${await b.getAttribute('data-card-id')}"]`)
  await expect(otherB).toBeVisible()
  // The friend labels B while we take the label off A and rename it.
  await openLabels(other, otherB)
  await row(other, 'Ours').getByTestId('label-toggle').click()
  await expect(chips(otherB)).toHaveText(['Ours'])

  await page.bringToFront()
  await openLabels(page, a)
  await row(page, 'Ours').getByTestId('label-toggle').click()
  await expect(chips(a)).toHaveCount(0)
  await waitForSync(page)
  await waitForSync(other)

  await page.reload()
  await expect(chips(page.locator(`[data-card-id="${await b.getAttribute('data-card-id')}"]`))).toHaveText(['Ours'])
  await expect(page.locator(`[data-card-id="${await a.getAttribute('data-card-id')}"]`).getByTestId('card-labels')).toHaveCount(0)
})

test('a custom colour from the wheel, and a rename that clashes stays open with a reason', async ({ page }) => {
  await freshBoard(page)
  const card = await addNote(page, 'Palette')
  await openLabels(page, card)
  await page.keyboard.type('Mood')
  await page.getByTestId('label-custom-color').fill('#a1b2c3')
  await page.getByTestId('label-create').click()
  await expect(chips(card)).toHaveText(['Mood'])
  // A light custom colour gets black text; a dark one gets white.
  expect(await background(chips(card).first())).toBe('rgb(161, 178, 195)')
  expect(await textColor(chips(card).first())).toBe('rgb(0, 0, 0)')
  await row(page, 'Mood').hover()
  await row(page, 'Mood').getByTestId('label-recolor').click()
  await row(page, 'Mood').getByTestId('label-custom-color').fill('#1a2b3c')
  await expect.poll(() => background(chips(card).first())).toBe('rgb(26, 43, 60)')
  expect(await textColor(chips(card).first())).toBe('rgb(255, 255, 255)')

  await page.getByTestId('labels-input').fill('Tone')
  await page.keyboard.press('Enter')
  await expect(chips(card)).toHaveText(['Mood', 'Tone'])
  await row(page, 'Tone').getByTestId('label-chip').dblclick()
  await expect(chips(card)).toHaveText(['Mood', 'Tone'])
  await page.getByTestId('label-rename-input').fill('mood')
  await page.getByTestId('label-rename-input').press('Enter')
  // The reason sits in the row, under the field, and the field points at it.
  await expect(row(page, 'Tone').getByTestId('labels-error')).toBeVisible()
  await expect(page.getByTestId('label-rename-input')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByTestId('label-rename-input')).toHaveAttribute('aria-describedby', 'label-rename-error')
  await expect(page.getByTestId('label-rename-input')).toBeFocused()
  await page.getByTestId('label-rename-input').press('Escape')
  await expect(page.getByTestId('labels-error')).toHaveCount(0)
  await expect(popover(page)).toBeVisible()

  // Recolour from the row's colour tool.
  await row(page, 'Tone').hover()
  await row(page, 'Tone').getByTestId('label-recolor').click()
  await row(page, 'Tone').locator('[data-testid="label-color"][data-color="lilac"]').click()
  await expect.poll(() => background(chips(card).filter({ hasText: 'Tone' }))).toBe(await token(page, '--dn-card-lilac-bg'))
})

test('Enter picks the highlighted match, arrows move it, and Create only wins when nothing matches', async ({ page }) => {
  await freshBoard(page)
  const card = await addNote(page, 'Keyboard only')
  await openLabels(page, card)
  for (const name of ['Lighting', 'Lightbox']) {
    await page.keyboard.type(name)
    await page.keyboard.press('Enter')
  }
  await expect(chips(card)).toHaveText(['Lightbox', 'Lighting'])
  const input = page.getByTestId('labels-input')
  await expect(input).toHaveAttribute('role', 'combobox')

  // A partial name highlights the first match; Enter toggles it instead of making "Ligh".
  await page.keyboard.type('Ligh')
  await expect(row(page, 'Lightbox')).toHaveClass(/active/)
  await expect(input).toHaveAttribute('aria-activedescendant', await row(page, 'Lightbox').getAttribute('id') ?? '')
  await page.keyboard.press('Enter')
  await expect(chips(card)).toHaveText(['Lighting'])
  await expect(popover(page).getByTestId('label-row')).toHaveCount(2)

  // Arrows move the highlight down to the next match, then to Create.
  await page.keyboard.type('Ligh')
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'Lighting')).toHaveClass(/active/)
  await page.keyboard.press('ArrowDown')
  await expect(popover(page).locator('.label-create-row')).toHaveClass(/active/)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(card.getByTestId('card-labels')).toHaveCount(0)
  await page.keyboard.type('Ligh')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(chips(card)).toHaveText(['Ligh'])
  await expect(popover(page).getByTestId('label-row')).toHaveCount(3)
})

test('Remove takes a label off the board, and Undo in the toast brings it back on its cards', async ({ page }) => {
  await freshBoard(page)
  const a = await addNote(page, 'Remove me A', 0.3, 0.4)
  const b = await addNote(page, 'Remove me B', 0.7, 0.4)
  await clickEmpty(page)
  await a.click()
  await b.click({ modifiers: ['Shift'] })
  await page.getByTestId('labels-button').click()
  await page.keyboard.type('Mood')
  await page.keyboard.press('Enter')
  await expect(chips(a)).toHaveText(['Mood'])
  await expect(chips(b)).toHaveText(['Mood'])

  const remove = row(page, 'Mood').getByTestId('label-remove')
  await row(page, 'Mood').hover()
  await expect(remove).toHaveAttribute('aria-label', /2 cards/)
  await remove.click()
  await expect(popover(page).getByTestId('label-row')).toHaveCount(0)
  await expect(a.getByTestId('card-labels')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Removed “Mood” from 2 cards')
  await page.getByTestId('toast-action').click()
  await expect(chips(a)).toHaveText(['Mood'])
  await expect(chips(b)).toHaveText(['Mood'])
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('card').filter({ hasText: 'Remove me B' }).getByTestId('card-labels')).toHaveText('Mood')
})

test('new labels get a random preset, a different one each time on a fresh board', async ({ page }) => {
  await freshBoard(page)
  const card = await addNote(page, 'Colourful')
  await openLabels(page, card)
  await page.keyboard.type('First')
  // The pick shows as the selected dot before Enter, and survives more typing.
  const picked = popover(page).locator('[data-testid="label-color"][aria-pressed="true"]')
  await expect(picked).toHaveCount(1)
  const first = await picked.getAttribute('data-color')
  await page.keyboard.type(' one')
  await expect(picked).toHaveAttribute('data-color', first!)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second')
  await page.keyboard.press('Enter')
  const colors = await chips(card).evaluateAll((els) => els.map((el) => el.getAttribute('data-color')))
  expect(colors).toHaveLength(2)
  for (const c of colors) expect(['gold', 'collar', 'ball', 'sky', 'lilac', 'peach']).toContain(c)
  expect(colors[0]).not.toBe(colors[1])
  expect(colors).toContain(first)
  // Preset chips pick black or white text too: dark gold/peach etc. all read with one of them.
  for (const chip of await chips(card).all()) expect(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']).toContain(await textColor(chip))
})
