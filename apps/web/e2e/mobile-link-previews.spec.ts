import { expect, test } from '@playwright/test'
import { FIXTURES } from './ports.ts'
import { loaded, seedLinks } from './link-fixture.ts'
import { tapOn } from './touch.ts'

// On a phone, link previews show the whole picture, fall back to our proxy when
// the site won't hot-link, and drop dead images rather than showing a broken box.

test('phone: guarded, tall and dead preview images', async ({ page }) => {
  const { card } = await seedLinks(page, [
    { url: `${FIXTURES}/guarded.html`, title: 'Woofcloud photo', image: `${FIXTURES}/guarded.png`, x: 0, y: 0 },
    { url: `${FIXTURES}/tall.html`, title: 'Tall dog', image: `${FIXTURES}/tall.png`, x: 0, y: 260 },
    { url: `${FIXTURES}/dead.html`, title: 'Gone dog', image: `${FIXTURES}/missing.png`, x: 0, y: 720 },
  ], 0.6)

  const guarded = card(0).getByTestId('link-image')
  await expect(guarded).toHaveAttribute('data-via', 'proxy')
  await expect.poll(() => loaded(guarded)).toBe(true)

  const tall = card(1).getByTestId('link-image')
  await expect.poll(() => loaded(tall)).toBe(true)
  const t = await tall.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }))
  expect(Math.abs(t.h - (t.w * 30) / 20)).toBeLessThan(2)

  await expect(card(2).getByTestId('link-title')).toHaveText('Gone dog')
  await expect(card(2).locator('img')).toHaveCount(0)

  // A tap on the picture selects the card, like any other card.
  await tapOn(page, tall)
  await expect(card(1)).toHaveClass(/selected/)
})
