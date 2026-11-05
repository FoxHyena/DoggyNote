import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { editProfile, profileFlow, profileUser } from './profile-checks.ts'
import { cardByText, postSync, pullAllObjects } from './helpers.ts'
import { WEB_PORT } from './ports.ts'

const unique = () => `name-${crypto.randomUUID().slice(0, 10)}`

test('display name: cancel, retry, save, reload, offline cache and clear', async ({ page }) => {
  await profileFlow(page)
})

test('display name: keyboard containment and long identity labels in both themes', async ({ page }) => {
  await profileUser(page)
  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => localStorage.setItem('doggynote.theme', mode), mode)
    await page.reload()
    await editProfile(page)
    await page.getByLabel('Display name', { exact: true }).fill(`${mode} ${'Long name 🐺 '.repeat(4)}`)
    await page.getByRole('button', { name: 'Save', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Close edit profile' })).toBeFocused()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const text = page.locator('.account-profile-text')
    expect(await text.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    if (process.env.PROFILE_QA && test.info().project.name === 'chromium') {
      mkdirSync('../../docs/qa/profiles', { recursive: true })
      await page.screenshot({ path: `../../docs/qa/profiles/desktop-${mode}-account.png` })
    }
    await editProfile(page)
    if (process.env.PROFILE_QA && test.info().project.name === 'chromium') await page.screenshot({ path: `../../docs/qa/profiles/desktop-${mode}-editor.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('edit-profile')).toBeFocused()
  }
})

test('display names reach collaborators, sharing, old comments and public viewers', async ({ page, browser }) => {
  const friend = `n${crypto.randomUUID().replaceAll('-', '').slice(0, 31)}`, password = 'profiletest123'
  expect((await page.request.post('/api/users', { data: { username: friend, password } })).ok()).toBe(true)
  const me = await profileUser(page)
  const board = `board-${unique()}`, note = `note-${unique()}`, comment = `comment-${unique()}`
  const ctx = await browser.newContext({ baseURL: `http://localhost:${WEB_PORT}`, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  const anonymous = await browser.newContext({ baseURL: `http://localhost:${WEB_PORT}`, storageState: { cookies: [], origins: [] } })
  try {
    expect((await ctx.request.post('/api/auth/login', { data: { username: friend, password } })).ok()).toBe(true)
    await postSync(page.request, { data: { changes: [
      { id: board, patch: { kind: 'board', title: 'Names board', parentId: null, icon: 'paw', color: 'none', createdAt: 1 } },
      { id: note, patch: { kind: 'card', type: 'note', boardId: board, x: 100, y: 100, w: 240, h: 100, color: 'none', content: { md: 'Profile test note' }, createdAt: 1 } },
      { id: comment, patch: { kind: 'comment', boardId: board, cardId: note, text: 'A comment before renaming', author: 'spoof', authorId: 'spoof', createdAt: 1 } },
    ] } })
    expect((await page.request.post(`/api/boards/${board}/members`, { data: { username: friend, permission: 'edit' } })).ok()).toBe(true)
    await page.goto(`/#/b/${board}`)
    const other = await ctx.newPage()
    await other.goto(`/#/b/${board}`)
    await expect(other.getByTestId('canvas')).toBeVisible()
    await other.getByTestId('collaborators').click()
    await expect(other.getByTestId('participant').filter({ hasText: me.username })).toBeVisible()
    for (const identity of await other.locator('.person-info').all()) expect(await identity.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await cardByText(other, 'Profile test note').getByTestId('comment-badge').click()
    await expect(other.locator('.comment-author')).toHaveText(me.username)
    await other.getByTestId('collaborators').click()
    await editProfile(page)
    await page.getByLabel('Display name', { exact: true }).fill('Oreo 🐺')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(other.getByTestId('participant').filter({ hasText: me.username })).toContainText('Oreo 🐺', { timeout: 15000 })
    // A pull with no changed comments still refreshes their current identities.
    await other.reload()
    await cardByText(other, 'Profile test note').getByTestId('comment-badge').click()
    await expect(other.locator('.comment-author')).toHaveText('Oreo 🐺')
    const access = await (await ctx.request.get('/api/access')).json()
    expect(access.boards.find((b: { id: string }) => b.id === board)).toMatchObject({ sharedBy: me.username, sharedByDisplayName: 'Oreo 🐺' })
    expect((await ctx.request.patch('/api/me/profile', { data: { displayName: 'Second Pup' } })).ok()).toBe(true)
    const sharing = await (await page.request.get(`/api/shares?boardId=${board}`)).json()
    expect(sharing.members[0]).toMatchObject({ username: friend, displayName: 'Second Pup' })
    const share = await (await page.request.post('/api/shares', { data: { boardId: board, permission: 'view' } })).json()
    const viewer = await anonymous.newPage()
    await viewer.goto(`/s/${share.share.token}`)
    await cardByText(viewer, 'Profile test note').getByTestId('comment-badge').click()
    await expect(viewer.locator('.comment-author')).toHaveText('Oreo 🐺')
    const stored = await pullAllObjects(page.request)
    expect(stored.objects.find((o: { id: string }) => o.id === comment)?.author).toBe(me.username)
  } finally { await ctx.close(); await anonymous.close() }
})

test('display name is optional on account and board invitation signup', async ({ page, browser }) => {
  for (const boardInvite of [false, true]) {
    let url: string
    if (boardInvite) {
      const board = `signup-${unique()}`
      await postSync(page.request, { data: { changes: [{ id: board, patch: { kind: 'board', title: 'Signup board', parentId: null, icon: 'paw', color: 'none', createdAt: 1 } }] } })
      const result = await (await page.request.post('/api/shares', { data: { boardId: board, permission: 'edit', allowSignup: true } })).json()
      url = `/join/${result.share.token}`
    } else url = (await (await page.request.post('/api/admin/invites', { data: {} })).json()).url
    const ctx = await browser.newContext({ baseURL: `http://localhost:${WEB_PORT}`, storageState: { cookies: [], origins: [] } })
    try {
      const p = await ctx.newPage()
      await p.goto(new URL(url, `http://localhost:${WEB_PORT}`).pathname)
      if (boardInvite) await p.getByRole('button', { name: 'Create an account', exact: true }).click()
      const form = p.getByTestId('signup-form')
      await form.getByLabel('Username', { exact: true }).fill(unique())
      await form.getByLabel('Display name (optional)').fill('New Pup 🐾')
      await form.getByLabel('Password', { exact: true }).fill('profiletest123')
      await form.getByLabel('Confirm password').fill('profiletest123')
      await form.getByRole('button', { name: 'Create account' }).click()
      await expect(p.getByTestId('canvas')).toBeVisible()
      await p.getByTestId('account').click()
      await expect(p.locator('.account-menu-identity strong')).toHaveText('New Pup 🐾')
    } finally { await ctx.close() }
  }
})
