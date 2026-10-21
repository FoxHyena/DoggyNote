import { expect, test } from '@playwright/test'
import { columnFixture } from './column-fixture.ts'
import { waitForSync } from './helpers.ts'

test('touch disclosure is usable without dragging the column or losing members', async ({ page }) => {
  const f = await columnFixture(page, 3)
  const initial = await f.column.boundingBox()
  const target = await f.toggle.boundingBox()
  expect(target!.width).toBeGreaterThanOrEqual(40)
  expect(target!.height).toBeGreaterThanOrEqual(40)
  await f.toggle.tap()
  await expect(f.toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(f.column.locator('.in-column')).toHaveCount(0)
  const collapsed = await f.column.boundingBox()
  expect(collapsed!.x).toBe(initial!.x)
  expect(collapsed!.y).toBe(initial!.y)
  await waitForSync(page)
  await f.toggle.tap()
  await expect(f.column.locator('.in-column')).toHaveCount(3)
  await expect(f.toggle).toHaveAttribute('aria-expanded', 'true')
})
