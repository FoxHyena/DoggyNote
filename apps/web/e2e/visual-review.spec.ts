import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { freshBoard, postSync } from './helpers.ts'

const widths = [1440, 1024, 720, 600, 360]
const now = Date.now()
async function appearance(page: Page, theme: 'Light' | 'Dark') {
  await page.getByTestId('account').click()
  await page.getByRole('radio', { name: theme, exact: true }).click()
  await page.keyboard.press('Escape')
}
async function shot(page: Page, info: TestInfo, name: string, surface: Locator) {
  await expect(surface).toBeVisible()
  // Phone sheets rise into place; measure where they come to rest.
  await surface.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))))
  const box = (await surface.boundingBox())!, viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
  expect(await surface.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.mouse.move(viewport.width - 1, viewport.height - 1)
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' })
}

for (const theme of ['Light', 'Dark'] as const) {
  test(`proposal preview, invitations, sessions and reset links remain readable in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await freshBoard(page, 'Detailed review states')
    await appearance(page, theme)
    const previewBoard = { id: 'review-preview-board', kind: 'board', parentId: null, title: 'Weekend plans and the next dog adventure', icon: 'paw', color: 'none', createdAt: now }
    const previewNote = { id: 'review-preview-note', kind: 'card', type: 'note', boardId: previewBoard.id, x: 20, y: 20, w: 250, h: 100, z: 1, color: 'gold', content: { md: '# Meet by the river\nBring **water**, snacks, and the blue leash.' }, createdAt: now }
    const previewTodo = { ...previewNote, id: 'review-preview-todo', type: 'todo', x: 300, content: { title: 'Before we go', items: [{ id: 'preview-task', text: 'Confirm the meeting point', done: false }] } }
    await page.route('**/api/agent-proposals?*', r => r.fulfill({ json: { proposals: [{ id: 'visual-preview', label: 'Organize our weekend adventure with readable notes and a checklist', status: 'pending', count: 2, createdAt: now }] } }))
    await page.route('**/api/agent-proposals/visual-preview', r => r.fulfill({ json: { proposal: { id: 'visual-preview', label: 'Organize our weekend adventure with readable notes and a checklist', status: 'pending', changes: [previewBoard, previewNote, previewTodo].map(after => ({ id: after.id, before: null, after })) }, before: [previewBoard], after: [previewBoard, previewNote, previewTodo] } }))
    await page.route('**/api/users', r => r.fulfill({ json: { users: [{ id: 'visual-person', username: 'a_long_username_for_review', isAdmin: false, createdAt: now }] } }))
    await page.route('**/api/users/visual-person/sessions', r => r.fulfill({ json: { sessions: Array.from({ length: 5 }, (_, i) => ({ id: `visual-session-${i}`, createdAt: now, expiresAt: now + 86400000, current: i === 0, device: `Safari on a MacBook — an especially long device description for session ${i + 1}` })) } }))
    await page.route('**/api/users/visual-person/recovery', r => r.fulfill({ json: { url: 'https://example.test/reset/visual-password-reset-token-with-a-long-name', expiresAt: now + 3600000 } }))
    await page.route('**/api/admin/invites', r => r.fulfill({ json: { invitations: [
      { id: 'pending', createdAt: now, expiresAt: now + 86400000 },
      { id: 'accepted', createdAt: now, expiresAt: now + 86400000, usedAt: now, acceptedBy: 'a_long_username_that_accepted' },
      { id: 'expired', createdAt: now - 86400000, expiresAt: now - 1000 },
      { id: 'revoked', createdAt: now, expiresAt: now + 86400000, revokedAt: now },
    ] } }))
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 480 })
      await page.getByTestId('board-more').click()
      await page.getByTestId('agent-proposals').click()
      const proposals = page.getByTestId('agent-review')
      await expect(proposals.getByTestId('agent-change-list')).toContainText('Meet by the river')
      await shot(page, info, `proposal-${theme.toLowerCase()}-${width}`, proposals)
      // The preview is the real board: real cards, marked, under a banner.
      await proposals.getByTestId('preview-on-board').click()
      const banner = page.getByTestId('proposal-banner')
      await expect(page.locator('[data-preview=added]', { hasText: 'Meet by the river' })).toBeVisible()
      await shot(page, info, `proposal-actions-${theme.toLowerCase()}-${width}`, page.locator('.app'))
      await banner.getByTestId('proposal-show-before').click()
      await expect(page.locator('[data-preview]')).toHaveCount(0)
      await banner.getByTestId('proposal-exit').click()
      await expect(banner).toHaveCount(0)
      await page.getByTestId('account').click()
      await page.getByTestId('manage-people').click()
      const admin = page.getByTestId('people-dialog')
      await admin.getByRole('tab', { name: 'Invitations' }).click()
      await expect(admin.getByTestId('account-invitation')).toHaveCount(4)
      await shot(page, info, `invitations-${theme.toLowerCase()}-${width}`, admin)
      await admin.getByRole('tab', { name: 'People', exact: true }).click()
      await admin.getByRole('button', { name: 'Sessions', exact: true }).click()
      const sessions = admin.getByRole('region', { name: 'Sessions for a_long_username_for_review' })
      await sessions.scrollIntoViewIfNeeded()
      await expect(sessions.getByRole('button', { name: 'Revoke session', exact: true })).toHaveCount(5)
      await shot(page, info, `sessions-${theme.toLowerCase()}-${width}`, admin)
      await admin.getByRole('button', { name: 'Reset password', exact: true }).click()
      await admin.getByTestId('generated-account-link').scrollIntoViewIfNeeded()
      await shot(page, info, `reset-link-${theme.toLowerCase()}-${width}`, admin)
      await page.keyboard.press('Escape')
    }
  })

  test(`loading, errors, recovery and update notices keep their actions visible in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000)
    let version = { version: '0.1.42', minClient: '0.0.0' }
    await page.route('**/api/version', r => r.fulfill({ json: version }))
    await freshBoard(page, 'Status and recovery review')
    await appearance(page, theme)
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('doggynote')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const transaction = request.result.transaction('meta', 'readwrite')
        transaction.objectStore('meta').put({ id: 'visual-recovery-note', patch: { content: { md: 'A saved recovery copy for visual review' } }, reason: 'Board access changed', savedAt: Date.now() }, 'recovery:visual-recovery-note')
        transaction.oncomplete = () => { request.result.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    }))
    await page.reload()
    await expect(page.getByTestId('update-toast')).toBeVisible()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await shot(page, info, `update-${theme.toLowerCase()}-${width}`, page.getByTestId('update-toast'))
      await page.getByTestId('sync-status').click()
      await expect(page.getByRole('button', { name: 'Download unsynced changes' })).toBeVisible()
      await shot(page, info, `recovery-${theme.toLowerCase()}-${width}`, page.getByTestId('sync-details'))
      await expect(page.getByTestId('update-toast')).toBeHidden()
      const download = page.getByRole('button', { name: 'Download unsynced changes' })
      expect(await download.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('update-toast')).toBeVisible()
    }
    await page.route('**/api/agent-connections', r => r.fulfill({ status: 503, json: { error: 'Could not load this review fixture' } }))
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await page.getByTestId('account').click()
      await page.getByTestId('manage-agents').click()
      const agents = page.getByTestId('agent-connections')
      await expect(agents.getByRole('alert')).toBeVisible()
      await shot(page, info, `agents-error-${theme.toLowerCase()}-${width}`, agents)
      await page.keyboard.press('Escape')
    }
    let finishLoading!: () => void
    const loading = new Promise<void>(resolve => { finishLoading = resolve })
    await page.route('**/api/users', async r => { await loading; await r.fulfill({ json: { users: [] } }) })
    await page.getByTestId('account').click()
    await page.getByTestId('manage-people').click()
    const admin = page.getByTestId('people-dialog')
    await expect(admin.getByText('Loading people…')).toBeVisible()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await shot(page, info, `loading-${theme.toLowerCase()}-${width}`, admin)
    }
    finishLoading()
    await page.keyboard.press('Escape')
    version = { version: '2.0.0', minClient: '2.0.0' }
    await page.reload()
    await expect(page.getByTestId('update-required')).toBeVisible()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await shot(page, info, `required-update-${theme.toLowerCase()}-${width}`, page.getByTestId('update-required').locator('.dialog'))
    }
  })
}

for (const theme of ['Light', 'Dark'] as const) {
  test(`entry and public and account view-only states stay readable in ${theme}`, async ({ page, browser }, info) => {
    test.setTimeout(120_000)
    const name = await freshBoard(page, 'A shared view-only board with a long descriptive title')
    const id = page.url().split('/').at(-1)!
    await appearance(page, theme)
    const noteId = crypto.randomUUID()
    expect((await postSync(page.request, { data: { changes: [{ id: noteId, patch: { id: noteId, kind: 'card', type: 'note', boardId: id, x: 20, y: 20, w: 250, h: 100, z: 1, color: 'none', content: { md: '# Shared weekend plans\nMeet by the river and bring **fresh water**.' }, createdAt: now } }] } })).ok()).toBe(true)
    await page.evaluate(id => localStorage.setItem(`doggynote.cam.${id}`, JSON.stringify({ x: 0, y: -40, zoom: 1 })), id)
    await page.route('**/api/access', async route => {
      // The app polls access; a poll still in flight when the test ends has nothing to answer.
      try {
        const response = await route.fetch(), access = await response.json()
        await route.fulfill({ json: { ...access, boards: access.boards.map((board: { id: string }) => board.id === id ? { ...board, ownerId: 'visual-owner', legacy: false, canEdit: false, canManage: false } : board) } })
      } catch {}
    })
    await page.reload()
    await expect(page.getByTestId('board-permission')).toHaveText('View only')
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await expect(page.getByRole('complementary', { name: 'Tools' })).toHaveCount(0)
      await shot(page, info, `account-view-only-${theme.toLowerCase()}-${width}`, page.locator('.app'))
    }
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
    try {
      await context.addInitScript(mode => localStorage.setItem('doggynote.theme', mode), theme.toLowerCase())
      await context.addInitScript(() => localStorage.setItem('doggynote.cam.visual-public-board', JSON.stringify({ x: 0, y: -40, zoom: 1 })))
      const entry = await context.newPage()
      await entry.route('**/api/auth/login', r => r.fulfill({ status: 401, json: { error: 'That username or password did not match. Try again.' } }))
      await entry.route('**/api/auth/invite/visual-entry', r => r.fulfill({ json: { expiresAt: now + 86400000 } }))
      await entry.route('**/api/auth/recovery/visual-entry', r => r.fulfill({ json: { username: 'a_long_username_for_recovery', expiresAt: now + 3600000 } }))
      const root = { id: 'visual-public-board', kind: 'board', parentId: null, title: name, color: 'none', icon: 'paw', createdAt: now }
      await entry.route('**/api/share/visual-public', r => r.fulfill({ json: { rootBoardId: root.id, sharedBoards: [root.id], objects: [root,
        { id: 'visual-public-note', kind: 'card', type: 'note', boardId: root.id, x: 20, y: 20, w: 250, h: 100, z: 1, color: 'none', content: { md: '# Shared weekend plans\nMeet by the river and bring **fresh water**.' }, createdAt: now },
      ] } }))
      for (const width of widths) {
        await entry.setViewportSize({ width, height: 480 })
        for (const [path, state] of [['/', 'login'], ['/signup/visual-entry', 'signup'], ['/reset/visual-entry', 'password-reset']] as const) {
          await entry.goto(path)
          const form = entry.getByTestId(state === 'password-reset' ? 'reset-form' : `${state}-form`)
          await expect(form).toBeVisible()
          await shot(entry, info, `${state}-${theme.toLowerCase()}-${width}`, entry.locator('.login'))
          const submit = form.getByRole('button', { name: state === 'password-reset' ? 'Update password' : state === 'signup' ? 'Create account' : 'Sign in', exact: true })
          await submit.scrollIntoViewIfNeeded()
          await expect(submit).toBeInViewport()
          await shot(entry, info, `${state}-actions-${theme.toLowerCase()}-${width}`, entry.locator('.login'))
          if (state === 'login') {
            await form.getByLabel('Username', { exact: true }).fill('visual-review')
            await form.getByLabel('Password', { exact: true }).fill('visual-review-password')
            await submit.click()
            await expect(entry.getByTestId('login-error')).toBeVisible()
            await shot(entry, info, `login-error-${theme.toLowerCase()}-${width}`, entry.locator('.login'))
          }
        }
        await entry.goto('/s/visual-public')
        const viewer = entry.getByTestId('viewer')
        await expect(viewer).toBeVisible()
        await expect(entry.getByTestId('card')).toContainText('Shared weekend plans')
        await shot(entry, info, `public-viewer-${theme.toLowerCase()}-${width}`, viewer)
        await entry.getByTestId('viewer-more').click()
        await shot(entry, info, `public-appearance-${theme.toLowerCase()}-${width}`, entry.locator('.viewer-menu'))
      }
    } finally { await context.close() }
  })
}
