import { pullAllObjects } from './helpers.ts'
import { postSync } from './helpers.ts'
import { waitForSync } from './helpers.ts'
import { expect, test, type Page } from '@playwright/test'
import { MOD, at, cardByText, clickEmpty, freshBoard } from './helpers.ts'

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

/** Markdown of this board's note containing `text`, from the device's store (edits are checkpointed while typing). */
async function localMarkdown(page: Page, text: string): Promise<string> {
  const board = boardOf(page)
  return page.evaluate(({ board, text }) => new Promise<string>((resolve) => {
    const request = indexedDB.open('doggynote')
    request.onsuccess = () => {
      const query = request.result.transaction('objects', 'readonly').objectStore('objects').getAll()
      query.onsuccess = () => resolve(query.result.find((o) => o.boardId === board && o.type === 'note' && !o.purged && o.content?.md?.includes(text))?.content.md ?? '')
    }
  }), { board, text })
}

async function typeNote(page: Page, lines: string[], fx = 0.45, fy = 0.45) {
  const p = await at(page, fx, fy)
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

test('live preview shows markers only for the syntax under the caret', async ({ page }) => {
  await typeNote(page, ['# Heading here', 'some **bold** text'])
  const editor = page.getByTestId('note-editor')
  const line = (n: number) => editor.locator('.cm-line').nth(n)
  // The caret ends line 2, clear of the bold word: the line reads formatted.
  await expect(editor.locator('.cm-md-h1')).toHaveText('Heading here')
  await expect(line(1)).toHaveText('some bold text')
  await expect(editor.locator('.cm-md-strong')).toHaveText('bold')
  await expect(editor.locator('.cm-md-mark')).toHaveCount(0)
  // Step back onto the bold word: its markers show, faded, ready to edit.
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  await expect(line(1)).toHaveText('some **bold** text')
  await expect(editor.locator('.cm-md-mark').first()).toBeVisible()
  // On the heading line, "# " shows only once the caret reaches the start of the text.
  await page.keyboard.press('ArrowUp')
  await expect(editor.locator('.cm-md-h1')).toHaveText('Heading here')
  await page.keyboard.press('Home')
  await expect(editor.locator('.cm-md-h1')).toHaveText('# Heading here')
  // Backspace there turns the heading back into a paragraph.
  await page.keyboard.press('Backspace')
  await expect(editor.locator('.cm-md-h1')).toHaveCount(0)
  await expect(line(0)).toHaveText('Heading here')
})

test('bullets and task boxes stay drawn on the line being typed', async ({ page }) => {
  await typeNote(page, ['- walk', 'feed', ''])
  const editor = page.getByTestId('note-editor')
  await page.keyboard.type('[ ] brush')
  await expect(editor.locator('.cm-md-bullet')).toHaveCount(2)
  await expect(editor.locator('.cm-md-task')).toHaveCount(1)
  await expect(editor.locator('.cm-line').nth(1)).toHaveText('•feed')
})

test('Tab nests list items and Shift-Tab brings them back', async ({ page }) => {
  await typeNote(page, ['Walk plan', '- park', 'river'])
  const editor = page.getByTestId('note-editor')
  await page.keyboard.press('Tab')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.type('bridge')
  await expect.poll(() => localMarkdown(page, 'Walk plan')).toBe('Walk plan\n- park\n  - river\n  - bridge')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => localMarkdown(page, 'Walk plan')).toBe('Walk plan\n- park\n  - river\n- bridge')
  // A first sub-item has nothing above it to nest under: Tab leaves it be.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(700)
  expect(await localMarkdown(page, 'Walk plan')).toBe('Walk plan\n- park\n  - river\n- bridge')
  await page.keyboard.press('Escape')
  const note = cardByText(page, 'Walk plan')
  await expect(note.locator('li li')).toHaveText('river')
  // Nested items sit one step right of their parent, as in the editor.
  const parent = (await note.locator('li', { hasText: 'park' }).first().locator('> p').boundingBox())!
  const child = (await note.locator('li li', { hasText: 'river' }).first().boundingBox())!
  expect(child.x).toBeGreaterThan(parent.x + 10)
})

test('Backspace at the start of a list item outdents it, then makes it a line of its own', async ({ page }) => {
  await typeNote(page, ['Plan', '- snacks', 'drinks'])
  for (let i = 0; i < 'drinks'.length; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Tab')
  await expect.poll(() => localMarkdown(page, 'Plan')).toBe('Plan\n- snacks\n  - drinks')
  await page.keyboard.press('Backspace')
  await expect.poll(() => localMarkdown(page, 'Plan')).toBe('Plan\n- snacks\n- drinks')
  await page.keyboard.press('Backspace')
  await expect.poll(() => localMarkdown(page, 'Plan')).toBe('Plan\n- snacks\n\ndrinks')
  // Typing carries on where the bullet was.
  await page.keyboard.type('!')
  await expect.poll(() => localMarkdown(page, 'Plan')).toBe('Plan\n- snacks\n\n!drinks')
})

test('Tab renumbers ordered lists, and outside a list it keeps the caret in the note', async ({ page }) => {
  await typeNote(page, ['1. wake', 'walk', 'breakfast'])
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Tab')
  await expect.poll(() => localMarkdown(page, 'wake')).toBe('1. wake\n   1. walk\n2. breakfast')
  await page.keyboard.press('Escape')

  await typeNote(page, ['just words'], 0.7, 0.7)
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.type('!')
  await page.keyboard.press('Escape')
  await expect(cardByText(page, 'just words!')).toBeVisible()
})

test('the format bar indents and outdents list items', async ({ page }) => {
  await typeNote(page, ['- treats', 'toys'])
  await page.getByTestId('fmt-indent').click()
  await expect.poll(() => localMarkdown(page, 'treats')).toBe('- treats\n  - toys')
  await page.getByTestId('fmt-outdent').click()
  await expect.poll(() => localMarkdown(page, 'treats')).toBe('- treats\n- toys')
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
