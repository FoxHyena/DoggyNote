import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshBoard, setAccountAppearance, waitForSync } from './helpers.ts'
import { grid, table } from './tables.ts'

// An agent reads and writes a table as columns and rows (never as the app's
// stored fields). A person reviews it, previews it on the board, approves it,
// and can reverse it.

const dogs = (extra: { rows?: unknown[] } = {}) => ({
  title: 'Vet visits',
  columns: [{ name: 'Dog' }, { name: 'Weight', type: 'number' }, { name: 'Status', type: 'select', options: [{ name: 'Healthy', color: 'sky' }, { name: 'Watch', color: 'peach' }] }],
  rows: extra.rows ?? [{ cells: ['Rex', 31.5, 'Healthy'] }, { cells: ['Fido', 8, 'Watch'] }, { cells: [{ value: 'Biscuit', bold: true }, 12, 'Healthy'] }],
})
const card = (id: string, boardId: string, content: unknown, extra: Record<string, unknown> = {}) => ({ id, kind: 'card', type: 'table', boardId, x: 120, y: 120, w: 560, h: 220, z: 1, color: 'none', createdAt: 1, content, ...extra })

async function connect(page: Page) {
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const response = await page.request.post('/api/agent-connections', { data: { name: 'Table agent', mode: 'propose', boardIds: [boardId], expiresInDays: 90 } })
  expect(response.status()).toBe(201)
  const { token } = await response.json()
  const headers = { authorization: `Bearer ${token}` }
  const propose = async (label: string, operations: unknown[]) => {
    const staged = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `tables-${crypto.randomUUID()}`, label, operations } })
    return { status: staged.status(), body: await staged.json() as { id: string; error?: string } }
  }
  const read = async (id: string) => {
    const board = await (await page.request.get(`/api/agent/boards/${boardId}`, { headers })).json()
    return board.objects.find((o: { object: { id: string } }) => o.object.id === id) as { object: { content: { columns: { id: string }[]; rows: { id: string; cells: unknown[] }[] } } & Record<string, unknown>; revision: number }
  }
  return { boardId, propose, read }
}

async function openProposals(page: Page) {
  await page.getByTestId('board-more').click()
  await page.getByTestId('agent-proposals').click()
}

async function capture(page: Page, info: TestInfo, name: string) {
  const directory = join(tmpdir(), 'doggynote-mcp-qa')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${info.project.name}-${name}`), await page.screenshot())
}

test('an agent proposes a table; the review shows its size, the preview draws it, approving lands it, and it reverses', async ({ page }, info) => {
  test.setTimeout(60_000)
  await freshBoard(page, 'Agent table board')
  const agent = await connect(page)
  const id = `agent-table-${crypto.randomUUID()}`
  const { status, body } = await agent.propose('Add the vet visits table', [{ action: 'create', object: card(id, agent.boardId, dogs()) }])
  expect(status, body.error).toBe(201)
  await expect(table(page)).toHaveCount(0)

  await openProposals(page)
  const review = page.getByTestId('agent-review')
  await review.getByRole('button', { name: /Add the vet visits table/ }).click()
  await expect(page.getByTestId('agent-change-list')).toContainText('Table · Vet visits · 3 rows · 3 columns')
  await capture(page, info, 'create-dark.png')
  await page.keyboard.press('Escape')
  await setAccountAppearance(page, 'Light')
  await openProposals(page)
  await expect(review.getByRole('heading', { name: 'Add the vet visits table' })).toBeVisible()
  await expect(page.getByTestId('agent-change-list')).toContainText('3 rows · 3 columns')
  await capture(page, info, 'create-light.png')
  // Technical details show columns and rows, not the stored row, column and cell fields.
  await review.getByText('Technical details').click()
  const details = review.locator('details pre')
  await expect(details).toContainText('"columns"')
  await expect(details).toContainText('"Biscuit"')
  expect(await details.textContent()).not.toMatch(/"t[rkc][0-9][0-9a-z]{4}/)

  await page.getByTestId('preview-on-board').click()
  const proposed = page.locator('[data-type=table][data-preview=added]')
  await expect(proposed).toBeVisible()
  const shown = await grid(page, proposed)
  expect(shown[0]).toEqual(['Dog', 'Weight', 'Status'])
  expect(shown.slice(1).map((r) => r[0])).toEqual(['Rex', 'Fido', 'Biscuit'])
  await expect(proposed).toContainText('Watch')
  await page.getByTestId('proposal-approve').click()
  await expect(page.getByTestId('proposal-banner')).toHaveCount(0)
  await expect(table(page)).toBeVisible()
  await expect(table(page)).not.toHaveAttribute('data-preview', /.+/)
  await expect(table(page)).toContainText('Biscuit')

  // It is a real table: the agent reads it back as columns and rows.
  const read = await agent.read(id)
  expect(Object.keys(read.object).some((k) => /^t[rkc][0-9]/.test(k))).toBe(false)
  expect(read.object.content.rows.map((r) => r.cells[0])).toEqual(['Rex', 'Fido', { value: 'Biscuit', bold: true }])

  // The card's measured height is still on its way to the server.
  await waitForSync(page)
  await openProposals(page)
  await expect(review.getByRole('heading', { name: 'Add the vet visits table' })).toBeVisible()
  await page.getByTestId('reverse-agent-proposal').click()
  await expect(review).toContainText('reversed')
  await expect(table(page)).toHaveCount(0)
})

test('an agent replaces a table with a changed cell and a new row; the review sums it up and approving applies it', async ({ page }, info) => {
  test.setTimeout(60_000)
  await freshBoard(page, 'Agent table replace board')
  const agent = await connect(page)
  const id = `agent-table-${crypto.randomUUID()}`
  const seeded = await agent.propose('Seed the table', [{ action: 'create', object: card(id, agent.boardId, dogs()) }])
  expect((await page.request.post(`/api/agent-proposals/${seeded.body.id}/approve`, { data: {} })).status()).toBe(200)
  await page.getByTestId('sync-status').click()
  await expect(table(page)).toContainText('Fido')

  const read = await agent.read(id)
  const content = structuredClone(read.object.content) as typeof read.object.content & { title: string }
  content.rows[0]!.cells[0] = 'Rexy'
  content.rows.push({ cells: ['Pip', 4, 'Healthy'] } as never)
  const staged = await agent.propose('Rename Rex, add Pip', [{ action: 'replace', expectedRevision: read.revision, object: { ...read.object, content } }])
  expect(staged.status, staged.body.error).toBe(201)

  await openProposals(page)
  const review = page.getByTestId('agent-review')
  await review.getByRole('button', { name: /Rename Rex, add Pip/ }).click()
  await expect(page.getByTestId('agent-change-list')).toContainText('Table · Vet visits · 1 cell changed · 1 row added')
  await capture(page, info, 'replace-dark.png')
  await page.keyboard.press('Escape')
  await setAccountAppearance(page, 'Light')
  await openProposals(page)
  await review.getByRole('button', { name: /Rename Rex, add Pip/ }).click()
  await expect(page.getByTestId('agent-change-list')).toContainText('1 cell changed · 1 row added')
  await capture(page, info, 'replace-light.png')
  await review.getByTestId('approve-agent-proposal').click()
  await expect(table(page)).toContainText('Rexy')
  await expect(table(page)).toContainText('Pip')
  await expect(table(page)).not.toContainText(/\bRex\b/)
  const after = await agent.read(id)
  expect(after.object.content.rows.map((r) => r.cells[0])).toEqual(['Rexy', 'Fido', { value: 'Biscuit', bold: true }, 'Pip'])
  // Rex's row kept its id: the agent's replace did not recreate it.
  expect(after.object.content.rows[0]!.id).toBe(read.object.content.rows[0]!.id)
})

test('a value that does not fit its column is refused with the row and column named', async ({ page }) => {
  await freshBoard(page, 'Agent table error board')
  const agent = await connect(page)
  const bad = { title: 'Visits', columns: [{ name: 'Dog' }, { name: 'Next visit', type: 'date' }], rows: [{ cells: ['Rex', '2026-12-01'] }, { cells: ['Fido', 'soon'] }] }
  const { status, body } = await agent.propose('Bad date', [{ action: 'create', object: card(`agent-table-${crypto.randomUUID()}`, agent.boardId, bad) }])
  expect(status).toBe(409)
  expect(body.error).toBe('Row 2, "Next visit": use YYYY-MM-DD')
})
