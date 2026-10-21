import { expect, test } from '@playwright/test'
import { freshBoard, postSync } from './helpers.ts'

for (const theme of ['light', 'dark'] as const) {
  test(`phone Fetch keeps populated results and controls within its viewport in ${theme}`, async ({ page }, info) => {
    await freshBoard(page, 'Phone search references')
    const boardId = decodeURIComponent(page.url().split('/b/')[1]!)
    const query = `reference_${crypto.randomUUID().slice(0, 8)}`
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: crypto.randomUUID(), kind: 'card', type: 'note', boardId,
      x: 100 + i % 4 * 300, y: 100 + Math.floor(i / 4) * 150, w: 260, h: 100, z: i + 1, color: 'none', createdAt: Date.now() + i,
      content: { md: `Coastal reference ${i} — ${query}\n\nA long research source with an unbroken-name-to-check-result-wrapping-and-readable-actions.` } }))
    const seeded = await postSync(page.request, { data: { changes: rows.map(row => ({ id: row.id, patch: row })) } })
    expect(seeded.ok(), await seeded.text()).toBe(true)
    await page.reload()
    await page.getByTestId('account').click()
    await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 360, height: 640 })
    await page.getByTestId('open-fetch').click()
    const input = page.getByTestId('fetch-input'), panel = page.getByTestId('fetch')
    await input.fill(query)
    await expect(page.getByTestId('fetch-hit')).toHaveCount(rows.length)
    await panel.evaluate(element => Promise.all(element.getAnimations().map(a => a.finished.catch(() => {}))))
    const measured = await panel.evaluate(element => {
      const css = getComputedStyle(element), rect = element.getBoundingClientRect()
      const backdrop = element.parentElement!, parent = getComputedStyle(backdrop)
      return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth, width: css.width, maxHeight: css.maxHeight, border: css.border, radius: css.borderRadius,
        backdrop: { className: backdrop.className, padding: parent.padding, placeItems: parent.placeItems },
        viewport: { width: innerWidth, height: innerHeight }, stylesheets: [...document.styleSheets].map(s => s.href) }
    })
    await info.attach('phone-fetch-computed-geometry', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' })
    // Keep an actual viewport image even if a lazy stylesheet displaces this panel.
    await page.screenshot({ path: info.outputPath(`fetch-${theme}-360.png`), fullPage: false })
    expect(Math.abs(measured.rect.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(measured.rect.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(measured.rect.width - 360)).toBeLessThanOrEqual(1)
    expect(Math.abs(measured.rect.height - 640)).toBeLessThanOrEqual(1)
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1)
    await expect(input).toBeInViewport()
    await expect(panel.getByRole('button', { name: 'Close search', exact: true })).toBeInViewport()
    const target = page.getByTestId('fetch-hit').filter({ hasText: `Coastal reference 0 — ${query}` })
    await target.click()
    await expect(panel).toHaveCount(0)
    const card = page.locator(`[data-card-id="${rows[0].id}"]`)
    await expect(card).toHaveClass(/selected/)
    await expect(card).toBeInViewport()
    await expect(card).toBeFocused()
  })
}
