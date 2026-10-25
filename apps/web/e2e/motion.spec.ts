import { runCardAction } from './helpers.ts'
import { expect, test } from '@playwright/test'
import { addNote, camera, cardByText, MOD } from './helpers.ts'
import { cameraSamples, expectCenteredToast, motionBoard, watchCamera, watchToast } from './motion-helpers.ts'

for (const theme of ['dark', 'light'] as const) for (const reduced of [false, true]) {
  test.describe(`${theme}, ${reduced ? 'reduced' : 'normal'} motion`, () => {
    test('Fetch is ready on its first frame and preserves keyboard navigation and focus', async ({ page }) => {
      const name = await motionBoard(page, theme, reduced)
      await page.getByTestId('open-fetch').focus()
      await page.evaluate(() => {
        const samples: { opacity: string; transform: string; animations: number }[] = []
        ;(window as unknown as { fetchProbe: typeof samples }).fetchProbe = samples
        let previous: Element | null = null
        new MutationObserver(() => {
          const el = document.querySelector('[data-testid="fetch"]')
          if (!el) { previous = null; return }
          if (el === previous) return
          previous = el
          const style = getComputedStyle(el)
          samples.push({ opacity: style.opacity, transform: style.transform, animations: el.getAnimations().length })
        }).observe(document.body, { childList: true, subtree: true })
      })
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press(`${MOD}+k`)
        await expect(page.getByTestId('fetch-input')).toBeFocused()
        if (i === 1) {
          await page.getByTestId('fetch-input').fill(name)
          await expect(page.getByTestId('fetch-hit').first()).toContainText(name)
          await page.keyboard.press('ArrowDown')
          await page.keyboard.press('ArrowUp')
          await page.keyboard.press('Enter')
        } else await page.keyboard.press('Escape')
        await expect(page.getByTestId('fetch')).toHaveCount(0)
        await expect(page.getByTestId('open-fetch')).toBeFocused()
      }
      const samples = await page.evaluate(() => (window as unknown as { fetchProbe: { opacity: string; transform: string; animations: number }[] }).fetchProbe)
      expect(samples).toHaveLength(3)
      for (const sample of samples) expect(sample).toEqual({ opacity: '1', transform: 'none', animations: 0 })
    })

    test('camera zoom honors reduced motion while retaining ordinary interpolation', async ({ page }) => {
      await motionBoard(page, theme, reduced)
      await page.getByTestId('zoom').click()
      await watchCamera(page)
      await page.getByRole('button', { name: 'Zoom in' }).click()
      await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.25, 4)
      const samples = await cameraSamples(page)
      expect(samples.at(-1)).toBeCloseTo(1.25, 4)
      const intermediates = samples.filter(z => z > 1.0001 && z < 1.2499)
      if (reduced) expect(intermediates).toHaveLength(0)
      else expect(intermediates.length).toBeGreaterThan(0)
    })

    test('short and long toasts remain centered, replace cleanly, and retain Undo', async ({ page }) => {
      await motionBoard(page, theme, reduced)
      await addNote(page, 'Toast undo check')
      const widths: number[] = []
      for (const message of ['Position locked. Content is still editable.', 'Position unlocked.']) {
        await watchToast(page)
        await page.getByTestId('position-lock').click()
        await expect(page.getByTestId('toast')).toHaveText(message)
        const samples = await expectCenteredToast(page)
        widths.push(samples.at(-1)!.width)
        await page.getByTestId('toast').click()
      }
      expect(widths[0]).toBeGreaterThan(widths[1] + 50)
      await watchToast(page)
      await page.getByTestId('position-lock').click()
      await expect(page.getByTestId('toast')).toContainText('Position locked')
      // Replace a visible notification; it should not replay an entry keyframe.
      await page.getByTestId('position-lock').click()
      await expect(page.getByTestId('toast')).toHaveText('Position unlocked.')
      await expectCenteredToast(page)
      await page.getByTestId('toast').click()
      await watchToast(page)
      await runCardAction(page, 'Bury')
      await expectCenteredToast(page)
      await page.getByTestId('toast-action').click()
      await expect(cardByText(page, 'Toast undo check')).toBeVisible()
      await expect(page.getByTestId('toast')).toHaveCount(0)
    })
  })
}

test('enabling reduced motion during a camera glide finishes at its target', async ({ page }) => {
  await motionBoard(page, 'dark', false)
  await page.getByTestId('zoom').click()
  await watchCamera(page)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.25, 4)
  const before = await camera(page)
  await page.waitForTimeout(250)
  expect(await camera(page)).toEqual(before)
  expect((await cameraSamples(page)).at(-1)).toBeCloseTo(1.25, 4)
})
