import { describe, expect, it } from 'vitest'
import { editCamera, isDoubleTap, momentumStep, pinchCamera, readableCamera, screenToWorld, MAX_ZOOM } from './camera.ts'

describe('pinchCamera', () => {
  const start = { x: 100, y: 50, zoom: 1 }
  it('keeps the world point under the fingers while zooming', () => {
    const a0 = { x: 100, y: 200 }, b0 = { x: 200, y: 200 }
    const cam = pinchCamera(start, a0, b0, { x: 50, y: 200 }, { x: 250, y: 200 })
    expect(cam.zoom).toBeCloseTo(2)
    expect(screenToWorld(cam, { x: 150, y: 200 })).toEqual(screenToWorld(start, { x: 150, y: 200 }))
  })
  it('pans with the midpoint', () => {
    const cam = pinchCamera(start, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 40 }, { x: 130, y: 40 })
    expect(cam).toEqual({ x: 70, y: 10, zoom: 1 })
  })
  it('clamps zoom', () => {
    expect(pinchCamera(start, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }).zoom).toBe(MAX_ZOOM)
  })
})

describe('momentumStep', () => {
  it('moves by velocity and slows down', () => {
    const { delta, v } = momentumStep({ x: 1, y: -2 }, 16)
    expect(delta).toEqual({ x: 16, y: -32 })
    expect(v.x).toBeCloseTo(0.92)
    expect(v.y).toBeCloseTo(-1.84)
  })
})

describe('isDoubleTap', () => {
  it('needs two taps close in time and place', () => {
    const a = { x: 10, y: 10, t: 1000 }
    expect(isDoubleTap(null, a)).toBe(false)
    expect(isDoubleTap(a, { x: 20, y: 15, t: 1200 })).toBe(true)
    expect(isDoubleTap(a, { x: 20, y: 15, t: 1400 })).toBe(false)
    expect(isDoubleTap(a, { x: 80, y: 15, t: 1100 })).toBe(false)
  })
})

describe('editCamera', () => {
  const card = { x: 400, y: 300, w: 280, h: 120 }
  it('zooms a small card up to a readable size and puts it at the top', () => {
    const cam = editCamera(card, { width: 390, top: 0 }, { x: 0, y: 0, zoom: 0.4 })
    expect(cam.zoom).toBeCloseTo((390 - 24) / 280)
    expect((card.y - cam.y) * cam.zoom).toBeCloseTo(12)
  })
  it('keeps a comfortable zoom and centres the card', () => {
    const cam = editCamera(card, { width: 390, top: 60 }, { x: 0, y: 0, zoom: 1 })
    expect(cam.zoom).toBe(1)
    expect((card.x - cam.x) * cam.zoom).toBeCloseTo((390 - 280) / 2)
    expect((card.y - cam.y) * cam.zoom).toBeCloseTo(72)
  })
  it('aligns a wide card to the left edge', () => {
    const cam = editCamera({ ...card, w: 900 }, { width: 390, top: 0 }, { x: 0, y: 0, zoom: 0.2 })
    expect(cam.zoom).toBe(0.9)
    expect((card.x - cam.x) * cam.zoom).toBeCloseTo(12)
  })
})

describe('readableCamera', () => {
  it('fits a small board', () => {
    expect(readableCamera({ x: 0, y: 0, w: 300, h: 200 }, 390, 700, 0.5).zoom).toBe(1)
  })
  it('starts a wide board at the top-left instead of shrinking it to dots', () => {
    const cam = readableCamera({ x: 0, y: 0, w: 1800, h: 900 }, 390, 700, 0.5)
    expect(cam).toEqual({ zoom: 0.5, x: -32, y: -32 })
  })
})
