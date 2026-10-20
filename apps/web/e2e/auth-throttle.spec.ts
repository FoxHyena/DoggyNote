import { expect, test } from '@playwright/test'

// Password guessing is throttled per username: after ten wrong passwords in
// fifteen minutes the sign-in form refuses, and says why.
test('the sign-in form stops guessing after ten wrong passwords', async ({ browser }) => {
  const username = `guess_${crypto.randomUUID().slice(0, 8)}`
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const page = await ctx.newPage()
    await page.goto('/')
    const form = page.getByTestId('login-form')
    await form.getByLabel('Username', { exact: true }).fill(username)
    await form.getByLabel('Password', { exact: true }).fill('not-the-password')
    await form.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByTestId('login-error')).toHaveText('Wrong username or password')
    for (let i = 1; i < 10; i++) {
      expect((await ctx.request.post('/api/auth/login', { data: { username, password: `guess-${i}` } })).status()).toBe(401)
    }
    await form.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByTestId('login-error')).toHaveText('Too many sign-in attempts. Try again in 15 minutes.')
    expect((await ctx.request.post('/api/auth/login', { data: { username: username.toUpperCase(), password: 'anything' } })).status()).toBe(429)
  } finally { await ctx.close() }
})
