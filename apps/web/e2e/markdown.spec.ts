import { pullAllObjects } from './helpers.ts'
import { postSync } from './helpers.ts'
import { waitForSync } from './helpers.ts'
import { expect, test, type Page } from '@playwright/test'
import { MOD, at, cardByText, clickEmpty, freshBoard } from './helpers.ts'
import { seedCards } from './touch.ts'

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])

/** The markdown the server holds for the note on this board containing `text`. */
async function serverMarkdown(page: Page, text: string): Promise<string> {
  await waitForSync(page)
  const { objects } = (await pullAllObjects(page.request)) as {
    objects: { boardId?: string; type?: string; content?: { md?: string } }[]
  }
  const note = objects.find((o) => o.boardId === boardOf(page) && o.type === 'note' && o.content?.md?.includes(text))
  return note?.content?.md ?? ''
}

async function typeNote(page: Page, lines: string[]) {
  const p = await at(page, 0.45, 0.45)
  await page.mouse.dblclick(p.x, p.y)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i])
    if (i < lines.length - 1) await page.keyboard.press('Enter')
  }
}

test('notes are stored as the markdown you typed and rendered formatted', async ({ page }) => {
  // Enter after a task continues the list with "- [ ] " by itself.
  await typeNote(page, ['# Walkies', '- [ ] leash', 'ball'])
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // empty item ends the list
  await page.keyboard.type('**good** dog')
  await page.keyboard.press('Escape')

  const note = cardByText(page, 'Walkies')
  await expect(note.locator('h1')).toHaveText('Walkies')
  await expect(note.locator('li.task')).toHaveCount(2)
  await expect(note.locator('strong')).toHaveText('good')

  const md = await serverMarkdown(page, 'Walkies')
  expect(md).toContain('# Walkies')
  expect(md).toContain('- [ ] leash')
  expect(md).toContain('- [ ] ball')
  expect(md).toContain('**good** dog')
})

test('live preview hides markers except on the line being edited', async ({ page }) => {
  await typeNote(page, ['# Heading here', 'some **bold** text'])
  const editor = page.getByTestId('note-editor')
  // Cursor is on line 2: the heading's "# " is hidden, the bold markers show faded.
  await expect(editor.locator('.cm-md-h1')).toHaveText('Heading here')
  await expect(editor.locator('.cm-md-strong')).toContainText('bold')
  await expect(editor.locator('.cm-md-mark').first()).toBeVisible()
  // Move to line 1: now the heading marker shows and the bold markers hide.
  await page.keyboard.press('ArrowUp')
  await expect(editor.locator('.cm-md-h1')).toHaveText('# Heading here')
  await expect(editor.locator('.cm-line').nth(1)).toHaveText('some bold text')
})

test('ticking a task in the rendered note edits its markdown, undoably', async ({ page }) => {
  await typeNote(page, ['Chores', '- [ ] fetch ball', 'brush fur'])
  await page.keyboard.press('Escape')
  const note = cardByText(page, 'Chores')
  await note.getByTestId('task-check').first().check()
  await expect(note.locator('li.task.done')).toHaveText('fetch ball')
  await expect.poll(() => serverMarkdown(page, 'Chores')).toContain('- [x] fetch ball')

  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+z`)
  await expect(note.locator('li.task.done')).toHaveCount(0)

  // And it survives a reload.
  await note.getByTestId('task-check').nth(1).check()
  await waitForSync(page)
  await page.reload()
  await expect(cardByText(page, 'Chores').locator('li.task.done')).toHaveText('brush fur')
})

test('ticked and open task boxes sit on their text line, reading and editing', async ({ page }) => {
  await seedCards(page, [{ type: 'note', x: 0, y: 0, w: 280, content: { md: 'Walkies\n- leash\n- [ ] Text Fido the time\n- [x] Charge the speaker' } }])
  const note = cardByText(page, 'Walkies')
  // How far each box's centre sits from the centre of the text beside it.
  const offsets = (box: string) => note.evaluate((n, box) => [...n.querySelectorAll(box)].map((b) => {
    const r = b.getBoundingClientRect()
    const text = document.createTreeWalker(b.closest('li, .cm-line')!, NodeFilter.SHOW_TEXT).nextNode()!
    const range = document.createRange()
    range.selectNodeContents(text)
    const t = range.getClientRects()[0]
    return r.top + r.height / 2 - (t.top + t.height / 2)
  }), box)
  for (const [box, open] of [['.task-check', () => {}], ['.cm-md-task', () => note.locator('.rich p', { hasText: 'Walkies' }).click()]] as const) {
    await open()
    await expect(note.locator(box)).toHaveCount(2)
    const [unticked, ticked] = await offsets(box)
    expect(Math.abs(unticked)).toBeLessThan(1.5)
    expect(Math.abs(ticked - unticked)).toBeLessThan(0.5)
  }
})

test('format bar inserts markdown', async ({ page }) => {
  await typeNote(page, ['make me a task'])
  await page.locator('.fmt-task').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Escape')
  await expect(cardByText(page, 'make me a task').locator('li.task')).toHaveCount(1)
  expect(await serverMarkdown(page, 'make me a task')).toBe('- [ ] make me a task')
})

test('raw HTML and javascript links in notes stay inert', async ({ page }) => {
  await typeNote(page, ['<img src=x onerror="window.__pwned=1"> [click](javascript:alert(1)) <b>bold?</b>'])
  await page.keyboard.press('Escape')
  const note = cardByText(page, 'click')
  await expect(note).toBeVisible()
  await expect(note.locator('img')).toHaveCount(0)
  await expect(note.locator('b')).toHaveCount(0)
  await expect(note.locator('a[href^="javascript"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
})

test('old-format notes still show, and get converted to markdown', async ({ page }) => {
  const id = crypto.randomUUID()
  const legacy = {
    id,
    kind: 'card',
    type: 'note',
    boardId: boardOf(page),
    x: 0,
    y: 0,
    w: 260,
    h: 80,
    z: 1,
    color: 'none',
    columnId: null,
    order: 0,
    createdAt: Date.now(),
    content: {
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Legacy pup' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'still ' }, { type: 'text', text: 'here', marks: [{ type: 'strong' }] }] },
        ],
      },
    },
  }
  expect((await postSync(page.request, { data: { changes: [{ id, patch: legacy }] } })).ok()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  // The pull can take several pages on a busy server; re-fit until the card has arrived.
  const note = cardByText(page, 'Legacy pup')
  await expect(async () => {
    await page.keyboard.press(`${MOD}+1`)
    await expect(note.locator('h2')).toHaveText('Legacy pup', { timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(note.locator('strong')).toHaveText('here')
  await expect.poll(() => serverMarkdown(page, 'Legacy pup'), { timeout: 15_000 }).toBe('## Legacy pup\n\nstill **here**')
})
