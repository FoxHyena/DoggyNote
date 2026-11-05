import { expect, it } from 'vitest'
import { clampCrop, cropHandle, cropSide, fitImage, initialCrop, moveCrop, pinchCrop, placeMoveGrip, resizeCrop } from './avatarCrop.ts'

it('starts with an 80% centred square and bounds portrait, landscape and tiny images', () => {
  for (const image of [{ width: 1200, height: 600 }, { width: 100, height: 1200 }, { width: 1, height: 1 }]) {
    expect(cropSide(image, initialCrop(image))).toBeCloseTo(Math.min(image.width, image.height) * .8)
    for (const zoom of [-1, 1, 2, 10]) for (const x of [-10000, 10000]) {
      const c = clampCrop(image, { x, y: -x, zoom }), half = cropSide(image, c) / 2
      expect(c.x - half).toBeGreaterThanOrEqual(0)
      expect(c.y - half).toBeGreaterThanOrEqual(0)
      expect(c.x + half).toBeLessThanOrEqual(image.width)
      expect(c.y + half).toBeLessThanOrEqual(image.height)
    }
  }
})

it('keeps every opposite corner anchored while resizing within the source image', () => {
  const image = { width: 900, height: 600 }, crop = initialCrop(image), old = cropSide(image, crop)
  for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) {
    const anchor = { x: crop.x - x * old / 2, y: crop.y - y * old / 2 }
    const next = resizeCrop(image, crop, { x, y }, { x: anchor.x + x * 300, y: anchor.y + y * 300 })
    expect(cropSide(image, next)).toBe(300)
    expect(next.x - x * 150).toBe(anchor.x)
    expect(next.y - y * 150).toBe(anchor.y)
    const small = resizeCrop(image, crop, { x, y }, anchor)
    expect(small.zoom).toBe(4)
    const full = { ...crop, zoom: 1 }
    const big = resizeCrop(image, full, { x, y }, { x: crop.x + x * 9000, y: crop.y + y * 9000 })
    expect(big).toEqual(full)
  }
})

it('moves the selection with the input and immediately reverses after a clipped delta', () => {
  const image = { width: 900, height: 600 }, start = initialCrop(image)
  const moved = moveCrop(image, start, { x: 30, y: 20 })
  expect(moved).toEqual({ ...start, x: 480, y: 320 })
  const edge = moveCrop(image, moved, { x: 10000, y: 10000 })
  expect(edge).toEqual({ ...start, x: 660, y: 360 })
  expect(moveCrop(image, edge, { x: -1, y: -1 })).toEqual({ ...edge, x: 659, y: 359 })
})

it('spreading fingers enlarges the crop, pinching shrinks it, and centroid movement translates it', () => {
  const image = { width: 900, height: 600 }, crop = initialCrop(image)
  expect(pinchCrop(image, crop, 1.25, { x: 0, y: 0 }).zoom).toBe(1)
  expect(pinchCrop(image, crop, .5, { x: 0, y: 0 }).zoom).toBe(2.5)
  expect(pinchCrop(image, crop, 1, { x: 20, y: -20 })).toEqual({ ...crop, x: 470, y: 280 })
  expect(pinchCrop(image, crop, .01, { x: 0, y: 0 }).zoom).toBe(4)
})

it('fits the entire image with handle clearance and preserves source framing across viewport changes', () => {
  for (const image of [{ width: 900, height: 600 }, { width: 600, height: 900 }, { width: 10000, height: 100 }]) {
    const crop = moveCrop(image, initialCrop(image), { x: 10, y: 5 })
    for (const size of [176, 278, 390]) {
      const fit = fitImage(image, size)
      expect(fit.left).toBeGreaterThanOrEqual(44)
      expect(fit.top).toBeGreaterThanOrEqual(44)
      expect(fit.left + image.width * fit.scale).toBeLessThanOrEqual(size - 44)
      expect(fit.top + image.height * fit.scale).toBeLessThanOrEqual(size - 44)
      const display = { x: fit.left + crop.x * fit.scale, y: fit.top + crop.y * fit.scale, side: cropSide(image, crop) * fit.scale }
      expect((display.x - fit.left) / fit.scale).toBeCloseTo(crop.x)
      expect((display.y - fit.top) / fit.scale).toBeCloseTo(crop.y)
      expect(display.side / fit.scale).toBeCloseTo(cropSide(image, crop))
    }
  }
})


it('places a full move grip clear of every tiny crop and resize target at image edges and centres', () => {
  for (const size of [224, 278, 390]) for (const side of [2, 12, 43]) {
    for (const x of [44 + side / 2, size / 2, size - 44 - side / 2]) for (const y of [44 + side / 2, size / 2, size - 44 - side / 2]) {
      const grip = placeMoveGrip({ x, y, side }, size)!
      expect(grip).toBeDefined()
      expect(grip.x).toBeGreaterThanOrEqual(0); expect(grip.y).toBeGreaterThanOrEqual(0)
      expect(grip.x + 44).toBeLessThanOrEqual(size); expect(grip.y + 44).toBeLessThanOrEqual(size)
      for (const cx of [-1, 1] as const) for (const cy of [-1, 1] as const) {
        const { x: left, y: top } = cropHandle({ x, y, side }, { x: cx, y: cy })
        expect(grip.x < left + 44 && grip.x + 44 > left && grip.y < top + 44 && grip.y + 44 > top).toBe(false)
      }
    }
  }
})


it('keeps painted corner arms inside their own disjoint hit targets at normal and tiny sizes', () => {
  for (const side of [2, 12, 44, 160]) {
    const frame = { x: 195, y: 195, side }, arm = Math.min(8, side / 4)
    const boxes = []
    for (const x of [-1, 1] as const) for (const y of [-1, 1] as const) {
      const target = cropHandle(frame, { x, y }), corner = { x: frame.x + x * side / 2, y: frame.y + y * side / 2 }
      for (const mark of [{ x: corner.x - x * arm, y: corner.y }, { x: corner.x, y: corner.y - y * arm }]) {
        expect(mark.x).toBeGreaterThanOrEqual(target.x); expect(mark.y).toBeGreaterThanOrEqual(target.y)
        expect(mark.x).toBeLessThanOrEqual(target.x + 44); expect(mark.y).toBeLessThanOrEqual(target.y + 44)
      }
      for (const other of boxes) expect(target.x < other.x + 44 && target.x + 44 > other.x && target.y < other.y + 44 && target.y + 44 > other.y).toBe(false)
      boxes.push(target)
    }
  }
})
