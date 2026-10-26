import { readdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { chooseAppearance } from './helpers.ts'

type Guide = { slug: string; title: string; status: string; sections: { id: string; figures?: unknown[] }[] }
const CONTENT = 'src/docs/content'
const published = readdirSync(CONTENT).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${CONTENT}/${f}`, 'utf8')) as Guide).filter((g) => g.status === 'published')

// The guides are public: every test here reads them signed out.
test.use({ storageState: { cookies: [], origins: [] } })

test('a deep link to a guide section opens signed out, with no board and no /api requests', async ({ page }) => {
  const api: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()) })
  await page.goto('/docs/explore-the-docs#jump-to-a-section')
  await expect(page.getByRole('heading', { name: 'Find your way around', exact: true, level: 1 })).toBeVisible()
  await expect(page.locator('#jump-to-a-section')).toBeInViewport()
  await page.reload()
  await expect(page.locator('#jump-to-a-section')).toBeInViewport()
  await expect(page).toHaveTitle('Find your way around · DoggyNote')
  await expect(page.locator('.stage, [data-testid="canvas"], [data-testid="login-form"]')).toHaveCount(0)
  expect(api).toEqual([])
})

test('search, open a guide, jump to a section, follow a related guide and go back', async ({ page }) => {
  await page.goto('/docs')
  const search = page.getByRole('searchbox', { name: 'Sniff out a guide' })
  await search.fill('nothing matches this')
  await expect(page.getByRole('heading', { name: 'No scent of that one.' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('0 guides')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('status')).toHaveText(`${published.length} guides`)
  await search.fill('Find your way')
  await expect(page.locator('.docs-guide-row')).toHaveCount(1)
  await page.locator('.docs-guide-row').click()
  await page.locator('.docs-toc:visible').getByRole('link', { name: 'Jump to a section' }).click()
  await expect(page).toHaveURL(/#jump-to-a-section$/)
  await expect(page.locator('#jump-to-a-section')).toBeInViewport()
  await page.getByRole('navigation', { name: 'Related guides' }).getByRole('link', { name: /Read comfortably/ }).click()
  await expect(page.getByRole('heading', { name: 'Read comfortably', exact: true, level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/explore-the-docs#jump-to-a-section$/)
  await page.goForward()
  await expect(page).toHaveURL(/reading-and-appearance$/)
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Guides' }).click()
  await expect(page.getByRole('heading', { name: 'All guides' })).toBeVisible()
})

test('browsing groups the guides by topic; a search ranks title matches first and matches word starts', async ({ page }) => {
  await page.goto('/docs')
  const main = page.locator('#docs-main')
  for (const topic of ['Getting started', 'Working on boards', 'Research & media', 'Writing & drawing', 'Reference']) await expect(main.getByRole('heading', { name: topic, level: 3 })).toBeVisible()
  await expect(main.locator('.docs-guide-row')).toHaveCount(published.length)
  const search = page.getByRole('searchbox', { name: 'Sniff out a guide' })
  // Other words for the same thing, and words from the steps, find guides too.
  await search.fill('color')
  await expect(main.locator('.docs-guide-row').first()).toContainText('Keep exact colours on your board')
  await search.fill('undo')
  await expect(main.locator('.docs-guide-row')).not.toHaveCount(0)
  await search.fill('sketch')
  await expect(main.locator('.docs-guide-row').first()).toContainText('Draw a sketch card')
  await expect(main.getByRole('heading', { name: 'Search results' })).toBeVisible()
  // A word start, not any substring: "pen" isn't in "open".
  await search.fill('pen')
  await expect(main.locator('.docs-guide-row', { hasText: 'Fold a column away' })).toHaveCount(0)
})

/** Scroll each screenshot into view (they load lazily) and check the one shown has really loaded. */
async function expectFiguresLoaded(page: Page, guide: Guide) {
  const figures = page.locator('.docs-section figure')
  await expect(figures).toHaveCount(guide.sections.reduce((n, s) => n + (s.figures?.length ?? 0), 0))
  for (const figure of await figures.all()) {
    await figure.scrollIntoViewIfNeeded()
    const shown = figure.locator('img:visible')
    await expect(shown).toHaveCount(1)
    await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: `${guide.slug}: ${await shown.getAttribute('src')}` }).toBe(true)
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`every published guide renders and its ${theme} screenshots load`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.addInitScript((t) => localStorage.setItem('doggynote.theme', t), theme)
    for (const guide of published) {
      await page.goto(`/docs/${guide.slug}`)
      await expect(page.getByRole('heading', { name: guide.title, exact: true, level: 1 })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const section of guide.sections) await expect(page.locator(`#${section.id}`)).toBeAttached()
      await expectFiguresLoaded(page, guide)
      // The other appearance's copies stay hidden, so they're never fetched.
      for (const img of await page.locator(`.docs-section img.docs-figure-${theme === 'dark' ? 'light' : 'dark'}`).all()) await expect(img).toBeHidden()
    }
  })
}

test('the appearance icon cycles from the keyboard, persists, and the app shares the choice', async ({ page, browserName }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/docs')
  const toggle = page.getByTestId('theme-toggle')
  await expect(toggle).toHaveAccessibleName('Appearance: Dark')
  await expect(page.getByRole('combobox')).toHaveCount(0)
  // Tab order: skip link, brand, Open DoggyNote, then the appearance icon.
  // Safari on macOS moves between links with Option-Tab by default.
  const tab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  await page.keyboard.press(tab)
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press(tab)
  await page.keyboard.press(tab)
  await page.keyboard.press(tab)
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAccessibleName('Appearance: System')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAccessibleName('Appearance: Light')
  await expect(toggle.locator('svg')).toHaveAttribute('data-icon', 'sun')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(toggle).toHaveAccessibleName('Appearance: Light')
  await chooseAppearance(page, 'Dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // The sign-in page reads the same saved choice.
  await page.goto('/')
  await expect(page.getByTestId('login-form')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('the skip link moves focus to the guide', async ({ page, browserName }) => {
  await page.goto('/docs/reading-and-appearance')
  const tab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  await page.keyboard.press(tab)
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#docs-main')).toBeFocused()
})

test('an unknown guide stays public, and sign-in links to the guides', async ({ page }) => {
  await page.goto('/docs/no-such-guide')
  await expect(page.getByRole('heading', { name: 'This guide has gone walkies.' })).toBeVisible()
  await expect(page.getByTestId('login-form')).toHaveCount(0)
  await page.getByRole('link', { name: 'Browse all guides' }).click()
  await expect(page).toHaveURL(/\/docs$/)
  await page.goto('/')
  await expect(page.getByTestId('login-form')).toBeVisible()
  await page.getByRole('link', { name: 'New here? Read the guides' }).click()
  await expect(page).toHaveURL(/\/docs$/)
  await expect(page.getByRole('heading', { name: 'Learn a few new tricks.' })).toBeVisible()
})

for (const width of [360, 720, 1440]) {
  test(`guides fit a ${width}px window without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/docs', '/docs/explore-the-docs']) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.getByTestId('theme-toggle')).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  })
}

test.describe('signed in', () => {
  test.use({ storageState: 'e2e/.auth/rex.json' })

  test('the account menu links to the guides in a new tab', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByTestId('account').click()
    const menu = page.getByRole('dialog', { name: 'Account', exact: true })
    const guides = menu.getByRole('link', { name: 'Guides' })
    await expect(guides).toHaveAttribute('href', '/docs')
    await expect(guides).toHaveAttribute('target', '_blank')
    const [tab] = await Promise.all([page.context().waitForEvent('page'), guides.click()])
    await expect(tab.getByRole('heading', { name: 'Learn a few new tricks.' })).toBeVisible()
    await expect(menu).toHaveCount(0)
  })
})
