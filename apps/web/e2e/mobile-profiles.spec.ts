import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { editProfile, profileFlow, profileUser } from './profile-checks.ts'

test('profile names can be edited, retried and cleared by touch', async ({ page }) => {
  await profileFlow(page, true)
})

test('profile sheet keeps controls visible in a narrow short viewport', async ({ page }) => {
  await profileUser(page)
  await page.setViewportSize({ width: 320, height: 480 })
  await editProfile(page, true)
  await page.getByLabel('Display name', { exact: true }).fill('A long profile name 🐺 '.repeat(2))
  for (const name of ['Cancel', 'Save']) {
    const button = page.getByTestId('profile-editor').getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    const box = (await button.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.y + box.height).toBeLessThanOrEqual(480)
  }
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  const identity = page.locator('.account-menu-identity')
  expect(await identity.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})


test('profile appearance in light and dark phone sheets', async ({ page }) => {
  await profileUser(page)
  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => localStorage.setItem('doggynote.theme', mode), mode)
    await page.reload()
    await editProfile(page, true)
    await page.getByLabel('Display name', { exact: true }).fill(mode === 'dark' ? 'Oreo 🐺' : 'Oreo at PawCon 🐾')
    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    await expect(page.getByTestId('profile-editor')).toHaveCount(0)
    await page.getByRole('dialog', { name: 'Account', exact: true }).evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))) })
    if (process.env.PROFILE_QA && test.info().project.name === 'mobile-webkit') {
      mkdirSync('../../docs/qa/profiles', { recursive: true })
      await page.screenshot({ path: `../../docs/qa/profiles/phone-${mode}-account.png` })
    }
    await editProfile(page, true)
    await page.getByTestId('profile-editor').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))) })
    if (process.env.PROFILE_QA && test.info().project.name === 'mobile-webkit') await page.screenshot({ path: `../../docs/qa/profiles/phone-${mode}-editor.png` })
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
  }
})
