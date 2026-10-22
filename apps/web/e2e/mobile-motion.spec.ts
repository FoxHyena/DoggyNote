import { expect, test, type Locator } from '@playwright/test'
import { camera, cardByText } from './helpers.ts'
import { cameraSamples, expectCenteredToast, motionBoard, settled, watchCamera, watchToast } from './motion-helpers.ts'
import { note, seedCards, setCamera, tapOn } from './touch.ts'

/** Exercise cancellation/extra pointers explicitly; a native tap cannot generate these browser events. */
async function cancelPull(sheet: Locator) {
  return sheet.evaluate(async el => {
    const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + 8
    const send = (target: EventTarget, type: string, id: number, yy: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: yy, button: 0 }))
    send(el, 'pointerdown', 71, y)
    send(window, 'pointermove', 71, y + 100)
    const pulled = el.style.transform
    send(el, 'pointerdown', 72, y + 100)
    send(window, 'pointermove', 72, y + 200)
    send(window, 'pointerup', 72, y + 200)
    send(window, 'pointercancel', 72, y + 200)
    const afterOtherPointer = el.style.transform
    send(window, 'pointercancel', 71, y + 100)
    await new Promise(r => setTimeout(r, 300))
    return { pulled, afterOtherPointer, connected: el.isConnected, transform: getComputedStyle(el).transform }
  })
}

for (const theme of ['dark', 'light'] as const) for (const reduced of [false, true]) {
  test.describe(`${theme}, ${reduced ? 'reduced' : 'normal'} motion`, () => {
    test('Add reopens immediately after outside dismissal and still focuses a new note', async ({ page }) => {
      await motionBoard(page, theme, reduced)
      const add = page.getByTestId('dock-add')
      await settled(page.getByTestId('mobile-dock'))
      const b = (await add.boundingBox())!
      await add.evaluate(el => {
        const times: number[] = []
        ;(window as unknown as { addTimes: number[] }).addTimes = times
        el.addEventListener('click', () => times.push(performance.now()))
      })
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
      await page.touchscreen.tap(20, 120)
      await expect(page.getByTestId('add-sheet')).toHaveCount(0)
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
      const times = await page.evaluate(() => (window as unknown as { addTimes: number[] }).addTimes)
      expect(times).toHaveLength(2)
      expect(times[1] - times[0], 'exercise the old 350ms rejection window').toBeLessThan(350)
      await expect(page.getByTestId('add-sheet')).toBeVisible()
      await page.getByTestId('add-note').tap()
      await expect(page.getByTestId('note-editor')).toBeFocused()
      await page.keyboard.type('Immediate reopening')
      await page.keyboard.press('Escape')
      await expect(cardByText(page, 'Immediate reopening')).toBeVisible()
    })

    test('a cancelled sheet pull rolls back and ignores another pointer', async ({ page }) => {
      await motionBoard(page, theme, reduced)
      await page.getByTestId('board-navigation').tap()
      const sheet = page.getByTestId('board-navigation-menu')
      await settled(sheet)
      const before = (await sheet.boundingBox())!
      const result = await cancelPull(sheet)
      expect(result.pulled).toBe('translateY(100px)')
      expect(result.afterOtherPointer).toBe(result.pulled)
      expect(result.connected).toBe(true)
      expect(Math.abs((await sheet.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1)
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)
      await expect(page.getByTestId('board-navigation')).toBeFocused()
    })

    test('camera zoom and edit framing respect motion preferences and preserve editor focus', async ({ page }) => {
      await motionBoard(page, theme, reduced)
      await page.getByTestId('zoom').tap()
      await watchCamera(page)
      await page.getByRole('button', { name: 'Zoom in' }).tap()
      await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.25, 4)
      const samples = await cameraSamples(page)
      const intermediates = samples.filter(z => z > 1.0001 && z < 1.2499)
      if (reduced) expect(intermediates).toHaveLength(0)
      else expect(intermediates.length).toBeGreaterThan(0)
      await seedCards(page, [note('Framed note', 300, 500)])
      await setCamera(page, { x: -20, y: -20, zoom: 0.5 })
      const card = cardByText(page, 'Framed note')
      await tapOn(page, card)
      await tapOn(page, card)
      await expect(page.getByTestId('note-editor')).toBeFocused()
      await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThanOrEqual(0.9)
      await page.keyboard.press('End')
      await page.keyboard.type(' edited')
      await page.keyboard.press('Escape')
      await expect(cardByText(page, 'Framed note edited')).toBeVisible()
    })

    test('the phone notification stays centered at the top and Undo restores its card', async ({ page }) => {
      await motionBoard(page, theme, reduced)
      await seedCards(page, [note('Phone toast', 0, 0)])
      await tapOn(page, cardByText(page, 'Phone toast'))
      await watchToast(page)
      await page.getByTestId('bury').tap()
      const samples = await expectCenteredToast(page)
      expect(samples.at(-1)!.top).toBeLessThan(120)
      await page.getByTestId('toast-action').tap()
      await expect(cardByText(page, 'Phone toast')).toBeVisible()
    })
  })
}

for (const theme of ['dark', 'light'] as const) {
  test(`a departing sheet can be re-grabbed without a stale dismissal in ${theme}`, async ({ page }) => {
    await motionBoard(page, theme, false)
    await page.getByTestId('board-navigation').tap()
    const sheet = page.getByTestId('board-navigation-menu')
    await settled(sheet)
    const result = await sheet.evaluate(async el => {
      const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + 8
      const send = (target: EventTarget, type: string, id: number, yy: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: yy, button: 0 }))
      send(el, 'pointerdown', 81, y)
      send(window, 'pointermove', 81, y + 100)
      // Commit the synthetic pull before release; a single rAF runs before paint
      // and need not expose the new transform on a busy Linux WebKit runner.
      const pulled = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42
      send(window, 'pointerup', 81, y + 100)
      const departure = el.getAnimations().find(a => (a as CSSTransition).transitionProperty === 'transform')
      // Catch the actual CSS transition at a deterministic in-flight position.
      // Its real dismissal fallback still runs unless re-grabbing cancels it.
      if (departure) { departure.pause(); departure.currentTime = 60 }
      const offset = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42
      const top = el.getBoundingClientRect().top + 8
      send(el, 'pointerdown', 82, top)
      const held = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42
      send(window, 'pointermove', 82, top - offset)
      send(window, 'pointercancel', 82, top - offset)
      await new Promise(r => setTimeout(r, 300))
      return { connected: el.isConnected, pulled, departing: !!departure, offset, held, finalTop: el.getBoundingClientRect().top, startTop: b.top }
    })
    expect(result.pulled).toBe(100)
    expect(result.departing).toBe(true)
    expect(result.offset).toBeGreaterThan(0)
    expect(Math.abs(result.held - result.offset)).toBeLessThanOrEqual(1)
    expect(result.connected).toBe(true)
    expect(Math.abs(result.finalTop - result.startTop)).toBeLessThanOrEqual(1)
  })
}

test('removing a departing sheet never dismisses the next sheet', async ({ page }) => {
  await motionBoard(page, 'dark', false)
  await page.getByTestId('board-navigation').tap()
  const sheet = page.getByTestId('board-navigation-menu')
  await settled(sheet)
  await sheet.evaluate(el => {
    const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + 8
    for (const [type, yy] of [['pointerdown', y], ['pointermove', y + 100], ['pointerup', y + 100]] as const) {
      ;(type === 'pointerdown' ? el : window).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch', clientX: x, clientY: yy, button: 0 }))
    }
  })
  await page.keyboard.press('Escape')
  await page.getByTestId('account').tap()
  await page.waitForTimeout(300)
  await expect(page.getByRole('dialog', { name: 'Account', exact: true })).toBeVisible()
})

test('a deliberate reduced-motion sheet release closes synchronously', async ({ page }) => {
  await motionBoard(page, 'dark', true)
  await page.getByTestId('board-navigation').tap()
  const sheet = page.getByTestId('board-navigation-menu')
  await settled(sheet)
  const connected = await sheet.evaluate(el => {
    const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + 8
    for (const [type, yy] of [['pointerdown', y], ['pointermove', y + 100], ['pointerup', y + 100]] as const) {
      ;(type === 'pointerdown' ? el : window).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 101, pointerType: 'touch', clientX: x, clientY: yy, button: 0 }))
    }
    return el.isConnected
  })
  expect(connected).toBe(false)
})
