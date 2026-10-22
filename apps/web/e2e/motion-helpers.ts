import { expect, type Locator, type Page } from '@playwright/test'
import { freshBoard } from './helpers.ts'

export async function motionBoard(page: Page, theme: 'dark' | 'light', reduced: boolean) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await page.addInitScript(mode => localStorage.setItem('doggynote.theme', mode), theme)
  const name = await freshBoard(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  return name
}

export async function settled(sheet: Locator) {
  await expect(sheet).toBeVisible()
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined))))
}

/** Sample rendered frames; computed style inside a mutation callback can lag a paint. */
export async function watchCamera(page: Page) {
  await page.getByTestId('world').evaluate(el => {
    const samples: number[] = []
    const sample = () => samples.push(new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
    sample()
    let frame = 0
    const tick = () => { sample(); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    ;(window as unknown as { cameraProbe: () => number[] }).cameraProbe = () => { cancelAnimationFrame(frame); sample(); return samples }
  })
}

export async function cameraSamples(page: Page) {
  return page.evaluate(() => (window as unknown as { cameraProbe: () => number[] }).cameraProbe())
}

/** Observe entry geometry at mount, before an actionability wait can hide a jump. */
export async function watchToast(page: Page) {
  await page.evaluate(() => {
    const samples: { center: number; top: number; width: number }[] = []
    ;(window as unknown as { toastProbe: typeof samples }).toastProbe = samples
    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-testid="toast"]')
      if (!el) return
      observer.disconnect()
      const start = performance.now()
      const sample = () => {
        const b = el.getBoundingClientRect()
        samples.push({ center: b.x + b.width / 2, top: b.y, width: b.width })
        if (el.isConnected && performance.now() - start < 280) requestAnimationFrame(sample)
      }
      sample()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

export async function expectCenteredToast(page: Page) {
  await expect(page.getByTestId('toast')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { toastProbe: unknown[] }).toastProbe.length)).toBeGreaterThan(5)
  // Include the entire 160/200ms entrance, not only the settled final frame.
  await page.waitForTimeout(300)
  const samples = await page.evaluate(() => (window as unknown as { toastProbe: { center: number; top: number; width: number }[] }).toastProbe)
  const centers = samples.map(s => s.center)
  expect(Math.max(...centers) - Math.min(...centers), 'toast stays horizontally centered throughout entry').toBeLessThanOrEqual(1)
  return samples
}
