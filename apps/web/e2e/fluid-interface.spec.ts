import { expect, test } from '@playwright/test'
import { MOD, camera, freshBoard } from './helpers.ts'
import { note, seedCards } from './touch.ts'

test.beforeEach(async ({ page }) => {
  const name = await freshBoard(page)
  await seedCards(page, [note(`Nearby review ${name}`, 20, 20), note(`Far review ${name}`, 1800, 900)])
})

test('Fetch owns Tab, Shift+Tab, outside focus and Escape with empty or populated results', async ({ page }) => {
  const opener = page.getByTestId('open-fetch')
  await opener.click()
  const input = page.getByTestId('fetch-input')
  const close = page.getByRole('button', { name: 'Close search', exact: true })
  for (const query of ['', 'review']) {
    await input.fill(query)
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(input).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(input).toBeFocused()
    }
  }
  await opener.evaluate((el) => el.focus())
  await expect(input).toBeFocused()
  // Escape is owned by the open modal, even if dispatched outside its subtree.
  await page.locator('body').dispatchEvent('keydown', { key: 'Escape', bubbles: true })
  await expect(page.getByTestId('fetch')).toHaveCount(0)
  await expect(opener).toBeFocused()
  await page.keyboard.press('Tab') // The containment listeners were removed.
  await expect(opener).not.toBeFocused()
})

test('Fetch retains Arrow/Enter selection and reveals an offscreen result', async ({ page }) => {
  await page.getByTestId('open-fetch').click()
  await page.getByTestId('fetch-input').fill(`Far review ${await page.getByTestId('board-name').textContent()}`)
  await expect(page.getByTestId('fetch-hit')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('fetch')).toHaveCount(0)
  await expect(page.locator('[data-testid="card"]', { hasText: 'Far review' })).toBeFocused()
})

test('reduced motion skips intermediate zoom transforms and still focuses a revealed card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    const zooms: number[] = []
    ;(window as unknown as { auditZooms: number[] }).auditZooms = zooms
    const start = performance.now()
    const frame = () => {
      zooms.push(new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="world"]')!).transform).a)
      if (performance.now() - start < 320) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.keyboard.press(`${MOD}+-`)
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(0.8, 3)
  await page.waitForTimeout(340)
  const intermediate = await page.evaluate(() => (window as unknown as { auditZooms: number[] }).auditZooms.filter((z) => Math.abs(z - 1) > 0.0001 && Math.abs(z - 0.8) > 0.0001))
  expect(intermediate).toEqual([])
  await page.getByTestId('open-fetch').click()
  await page.getByTestId('fetch-input').fill(`Far review ${await page.getByTestId('board-name').textContent()}`)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="card"]', { hasText: 'Far review' })).toBeFocused()
})

test('enabling reduced motion lands an already running camera transition', async ({ page }) => {
  await page.evaluate(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    query.addEventListener('change', () => {
      const values: number[] = []
      ;(window as unknown as { afterReduction: number[] }).afterReduction = values
      const frame = () => {
        values.push(new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="world"]')!).transform).a)
        if (values.length < 5) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  })
  await page.keyboard.press(`${MOD}+-`)
  await page.waitForTimeout(35)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => (window as unknown as { afterReduction?: number[] }).afterReduction?.length ?? 0)).toBe(5)
  const values = await page.evaluate(() => (window as unknown as { afterReduction: number[] }).afterReduction)
  // The observer can run before the application's callback in the same frame.
  expect(values.slice(1).map((z) => Number(z.toFixed(4)))).toEqual([0.8, 0.8, 0.8, 0.8])
})

test('wheel interruption retains its pan beyond the old camera animation end', async ({ page }) => {
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.evaluate(() => document.addEventListener('wheel', () => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="world"]')!).transform)
    ;(window as unknown as { wheelCamera: { y: number; zoom: number } }).wheelCamera = { y: m.f, zoom: m.a }
  }, { capture: true, once: true }))
  await page.keyboard.press(`${MOD}+-`)
  await page.waitForTimeout(35)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { wheelCamera?: unknown }).wheelCamera)).toBe(true)
  await page.waitForTimeout(280)
  const initial = await page.evaluate(() => (window as unknown as { wheelCamera: { y: number; zoom: number } }).wheelCamera)
  const final = await camera(page)
  expect(final.ty).toBeCloseTo(initial.y - 200, 1)
  expect(final.zoom).toBeCloseTo(initial.zoom, 4)
})

test('Safari gesture-event interruption keeps its current anchored zoom', async ({ page }) => {
  await page.keyboard.press(`${MOD}+-`)
  await page.waitForTimeout(35)
  const zoom = await page.getByTestId('canvas').evaluate((canvas) => {
    const before = new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="world"]')!).transform).a
    const rect = canvas.getBoundingClientRect()
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      canvas.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale: type === 'gesturestart' ? 1 : 1.2, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }))
    }
    return before * 1.2
  })
  await page.waitForTimeout(280)
  expect((await camera(page)).zoom).toBeCloseTo(zoom, 4)
})
