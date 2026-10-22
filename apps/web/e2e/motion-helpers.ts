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
    const probe = { samples, done: false }
    ;(window as unknown as { toastProbe: typeof probe }).toastProbe = probe
    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-testid="toast"]')
      if (!el) return
      observer.disconnect()
      const start = performance.now()
      const sample = () => {
        const b = el.getBoundingClientRect()
        samples.push({ center: b.x + b.width / 2, top: b.y, width: b.width })
        if (el.isConnected && performance.now() - start < 280) requestAnimationFrame(sample)
        else probe.done = true
      }
      sample()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

export async function expectCenteredToast(page: Page) {
  await expect(page.getByTestId('toast')).toBeVisible()
  // Include mount through the entire 160/200ms entrance without imposing a frame-rate budget.
  await expect.poll(() => page.evaluate(() => (window as unknown as { toastProbe: { done: boolean } }).toastProbe.done)).toBe(true)
  const samples = await page.evaluate(() => (window as unknown as { toastProbe: { samples: { center: number; top: number; width: number }[] } }).toastProbe.samples)
  expect(samples.length, 'capture both mount and a rendered frame after entry').toBeGreaterThan(1)
  const centers = samples.map(s => s.center)
  expect(Math.max(...centers) - Math.min(...centers), 'toast stays horizontally centered throughout entry').toBeLessThanOrEqual(1)
  return samples
}
