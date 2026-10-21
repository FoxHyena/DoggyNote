import { describe, expect, it } from 'vitest'
import { defaultStickerWidth, enclosingCircle, normalizeAngle, stickerCorners, normalizeStickerPack, ringGesture, stickerGroupRing, transformSticker, transformStickerGroup, stickerBounds, stickerHeight, stickerLocal, usableSticker } from './stickers.ts'
import { stickerObjectSchema } from './agent.ts'
import { UndoStack, diff } from './patch.ts'
import type { Sticker } from './model.ts'

const sticker: Sticker = { id: 's', kind: 'sticker', boardId: 'b', x: 40, y: 60, w: 100, angle: 90, z: 1, createdAt: 1, content: { assetId: '00000000-0000-4000-8000-000000000001', stickerId: 'unique', packName: 'Dogs', emoji: '🐶', width: 512, height: 256, format: 'static' } }
describe('Telegram identifiers', () => {
  it('normalizes only explicitly supported pack links', () => {
    for (const value of ['Dogs', 'https://t.me/addstickers/Dogs', 'https://telegram.me/addstickers/Dogs/', 't.me/addstickers/Dogs', 'https://www.t.me/addstickers/Dogs']) expect(normalizeStickerPack(value)).toBe('Dogs')
    for (const value of ['https://evil.test/addstickers/Dogs', 'http://t.me/addstickers/Dogs', 'https://t.me@evil.test/addstickers/Dogs', 'https://t.me/addstickers/Dogs?x=1', 'https://t.me/addstickers/Dogs#x', 'https://t.me:443/addstickers/Dogs', 'https://t.me/addstickers/%44ogs', 'tg://addstickers?set=Dogs', 'bad name', '../Dogs', '', null]) expect(normalizeStickerPack(value)).toBeNull()
  })
})
describe('rotated sticker geometry', () => {
  it('rotates bounds and hit coordinates around the center', () => {
    expect(stickerHeight(sticker)).toBe(50)
    const bounds = stickerBounds(sticker)
    expect(bounds.x).toBeCloseTo(65); expect(bounds.y).toBeCloseTo(35)
    expect(bounds.w).toBeCloseTo(50); expect(bounds.h).toBeCloseTo(100)
    expect(stickerLocal(sticker, { x: 90, y: 135 })).toEqual({ x: 1, y: .5000000000000001 })
  })
  it('turns and scales in one radial gesture without moving the center or changing aspect', () => {
    const start = { x: 190, y: 85 }, result = transformSticker(sticker, start, { x: 90, y: 285 })
    expect(result.w).toBeCloseTo(200); expect(result.angle).toBe(-180)
    expect(result.x + result.w / 2).toBeCloseTo(90)
    expect(result.y + result.w * .5 / 2).toBeCloseTo(85)
    expect(transformSticker(sticker, start, start)).toEqual({ x: 40, y: 60, w: 100, angle: 90 })
    expect(transformSticker(sticker, { x: 90, y: -15 }, { x: 290, y: 85 }).w).toBeCloseTo(200)
    expect(transformSticker(sticker, start, { x: 1e9, y: 85 }).w).toBe(1024)
    expect(transformSticker(sticker, start, { x: 90, y: 85 }).w).toBe(32)
    expect(transformSticker(sticker, { x: 90, y: 85 }, start)).toEqual({ x: 40, y: 60, w: 100, angle: 90 })
    const tall = { ...sticker, content: { ...sticker.content, width: 64, height: 512 } }
    expect(transformSticker(tall, start, { x: 1e9, y: 85 }).w).toBe(128)
  })
  it('rings a group with the smallest circle around every corner, which holds still as the group turns and scales', () => {
    const a = { ...sticker, id: 'a', x: 0, y: 0, angle: 0 }, b = { ...sticker, id: 'b', x: 200, y: 12.5, w: 50, angle: 10 }
    const ring = stickerGroupRing([a, b])
    // Every corner is inside, and the far corners of both stickers touch it.
    const corners = [a, b].flatMap(stickerCorners), gap = (p: { x: number; y: number }) => ring.radius - Math.hypot(p.x - ring.center.x, p.y - ring.center.y)
    for (const p of corners) expect(gap(p)).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.min(...stickerCorners(a).map(gap))).toBeCloseTo(0, 6); expect(Math.min(...stickerCorners(b).map(gap))).toBeCloseTo(0, 6)
    // Tighter than a circle centered between the stickers.
    const mean = { x: 137.5, y: 25 }
    expect(ring.radius).toBeLessThan(Math.max(...corners.map((p) => Math.hypot(p.x - mean.x, p.y - mean.y))))
    const g = ringGesture(ring.center, { x: ring.center.x + 100, y: ring.center.y }, { x: ring.center.x, y: ring.center.y + 200 })
    expect(g.scale).toBeCloseTo(2); expect(g.turn).toBeCloseTo(90)
    const out = transformStickerGroup([a, b], ring.center, g.scale, g.turn), a2 = { ...a, ...out.a }, b2 = { ...b, ...out.b }
    expect(a2.w).toBeCloseTo(200); expect(b2.w).toBeCloseTo(100); expect(a2.angle).toBeCloseTo(90); expect(b2.angle).toBeCloseTo(100)
    const after = stickerGroupRing([a2, b2])
    expect(after.center.x).toBeCloseTo(ring.center.x, 6); expect(after.center.y).toBeCloseTo(ring.center.y, 6); expect(after.radius).toBeCloseTo(ring.radius * 2, 6)
    // One clamp for the whole group: the smallest sticker stops at the minimum, the others keep their ratio.
    const small = transformStickerGroup([a, b], ring.center, .01, 0)
    expect(small.b.w).toBe(32); expect(small.a.w).toBeCloseTo(64)
    expect(transformStickerGroup([a, b], ring.center, 1e9, 0).a.w).toBe(1024)
    expect(ringGesture(ring.center, ring.center, { x: 0, y: 0 })).toEqual({ scale: 1, turn: 0 })
  })
  it('finds the smallest enclosing circle for awkward point sets', () => {
    const square = enclosingCircle([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 1 }])
    expect(square.center.x).toBeCloseTo(1); expect(square.center.y).toBeCloseTo(1); expect(square.radius).toBeCloseTo(Math.SQRT2)
    const line = enclosingCircle([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])
    expect(line.center.x).toBeCloseTo(5); expect(line.radius).toBeCloseTo(5)
    // An obtuse triangle is spanned by its longest side, not its circumcircle.
    const obtuse = enclosingCircle([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }])
    expect(obtuse.center.x).toBeCloseTo(5); expect(obtuse.center.y).toBeCloseTo(0); expect(obtuse.radius).toBeCloseTo(5)
    expect(enclosingCircle([{ x: 3, y: 4 }])).toEqual({ center: { x: 3, y: 4 }, radius: 0 })
  })
  it('resets to the size a fresh sticker gets at 100% zoom', () => {
    expect(defaultStickerWidth(sticker)).toBe(144)
    expect(defaultStickerWidth({ content: { ...sticker.content, width: 256, height: 512 } })).toBe(72)
  })
  it('keeps radial transforms valid at the document coordinate limits', () => {
    for (const x of [-1e6, 1e6]) for (const y of [-1e6, 1e6]) {
      const edge = { ...sticker, x, y }, center = { x: x + 50, y: y + 25 }, start = { x: center.x + 100, y: center.y }
      for (const offset of [0, 1e9]) {
        const after = { ...edge, ...transformSticker(edge, start, { x: center.x + offset, y: center.y }) }
        expect(usableSticker(after)).toBe(true)
        expect(after.x + after.w / 2).toBeCloseTo(center.x)
        expect(after.y + stickerHeight(after) / 2).toBeCloseTo(center.y)
      }
    }
  })
  it('normalizes all complete turns including negative ones', () => {
    expect(normalizeAngle(721)).toBe(1); expect(normalizeAngle(-721)).toBe(-1)
  })
  it('rejects malformed transforms and card-only behavior on server and in render guards', () => {
    expect(usableSticker(sticker)).toBe(true); expect(stickerObjectSchema.safeParse(sticker).success).toBe(true)
    for (const patch of [{ x: NaN }, { w: -1 }, { w: Infinity }, { angle: 200 }, { z: 1e12 }, { content: null }]) {
      expect(usableSticker({ ...sticker, ...patch })).toBe(false)
      expect(stickerObjectSchema.safeParse({ ...sticker, ...patch }).success).toBe(false)
    }
    for (const patch of [{ columnId: 'column' }, { from: 'card' }, { h: 100 }]) expect(stickerObjectSchema.safeParse({ ...sticker, ...patch }).success).toBe(false)
  })
  it('records a full transform as one invertible transaction without unrelated fields', () => {
    const change = diff(sticker, { x: 100, angle: 30 })!
    const undo = new UndoStack(); undo.push([change])
    expect(undo.undo()![0].after).toEqual({ x: 40, angle: 90 })
    expect(undo.redo()![0].after).toEqual({ x: 100, angle: 30 })
  })
})
