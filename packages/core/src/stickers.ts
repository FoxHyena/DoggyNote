import type { Sticker } from './model.ts'
import type { Rect, Vec } from './geometry.ts'

export const STICKER_MIN = 32
export const STICKER_MAX = 1024
export const PACK_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/

/** Explicitly supported: short names, t.me/telegram.me links with optional www and slash. */
export function normalizeStickerPack(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 256) return null
  let value = input.trim()
  if (PACK_NAME.test(value)) return value
  if (/^(?:www\.)?(?:t\.me|telegram\.me)\//i.test(value)) value = `https://${value}`
  const match = /^https:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/addstickers\/([a-zA-Z][a-zA-Z0-9_]{0,63})\/?$/i.exec(value)
  return match?.[1] ?? null
}

export const stickerHeight = (s: Sticker) => s.w * s.content.height / s.content.width
export const stickerRingRadius = (s: Sticker, zoom: number) => Math.hypot(s.w, stickerHeight(s)) / 2 + 10 / zoom
export const normalizeAngle = (a: number) => ((a + 180) % 360 + 360) % 360 - 180

export function stickerBounds(s: Sticker): Rect {
  const h = stickerHeight(s)
  const a = s.angle * Math.PI / 180
  const w = Math.abs(s.w * Math.cos(a)) + Math.abs(h * Math.sin(a))
  const bh = Math.abs(s.w * Math.sin(a)) + Math.abs(h * Math.cos(a))
  return { x: s.x + s.w / 2 - w / 2, y: s.y + h / 2 - bh / 2, w, h: bh }
}

/** Unrotate around the visual center; same coordinates for picking and proportional resize. */
export function stickerLocal(s: Sticker, p: Vec): Vec {
  const h = stickerHeight(s), a = -s.angle * Math.PI / 180
  const dx = p.x - s.x - s.w / 2, dy = p.y - s.y - h / 2
  return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / s.w + .5, y: (dx * Math.sin(a) + dy * Math.cos(a)) / h + .5 }
}

/** One radial gesture: distance controls size and direction controls rotation.
 * Both are relative to the grab point, so touching any part of the ring never jumps. */
export function transformSticker(s: Sticker, grabbedAt: Vec, p: Vec): Pick<Sticker, 'x' | 'y' | 'w' | 'angle'> {
  const h = stickerHeight(s), center = { x: s.x + s.w / 2, y: s.y + h / 2 }
  const start = { x: grabbedAt.x - center.x, y: grabbedAt.y - center.y }, next = { x: p.x - center.x, y: p.y - center.y }
  const distance = Math.hypot(start.x, start.y)
  if (distance < .001) return { x: s.x, y: s.y, w: s.w, angle: s.angle }
  const aspect = s.content.width / s.content.height
  const min = Math.max(STICKER_MIN, 2 * (center.x - 1e6), 2 * (center.y - 1e6) * aspect)
  const max = Math.min(STICKER_MAX, STICKER_MAX * aspect, 2 * (center.x + 1e6), 2 * (center.y + 1e6) * aspect)
  const w = Math.max(min, Math.min(max, s.w * Math.hypot(next.x, next.y) / distance))
  // At the pivot the direction is undefined; retain the original angle.
  const turn = Math.hypot(next.x, next.y) < .001 ? 0 : (Math.atan2(next.y, next.x) - Math.atan2(start.y, start.x)) * 180 / Math.PI
  return { w, x: center.x - w / 2, y: center.y - w * s.content.height / s.content.width / 2, angle: normalizeAngle(s.angle + turn) }
}

/** A fresh sticker's longest side at 100% zoom, and where "reset" returns it. */
export const STICKER_SIZE = 144
export const defaultStickerWidth = (s: Pick<Sticker, 'content'>) => STICKER_SIZE * Math.min(1, s.content.width / s.content.height)
const centerOf = (s: Sticker): Vec => ({ x: s.x + s.w / 2, y: s.y + stickerHeight(s) / 2 })

/** A sticker's four corners, turned with it. */
export function stickerCorners(s: Sticker): Vec[] {
  const c = centerOf(s), h = stickerHeight(s), a = s.angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = u * s.w / 2, y = v * h / 2; return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos } })
}

type Circle = { center: Vec; radius: number }
const inside = (c: Circle, p: Vec) => Math.hypot(p.x - c.center.x, p.y - c.center.y) <= c.radius * (1 + 1e-9) + 1e-7
const across = (a: Vec, b: Vec): Circle => ({ center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, radius: Math.hypot(a.x - b.x, a.y - b.y) / 2 })
function through(a: Vec, b: Vec, c: Vec): Circle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  // Nearly in a line: the widest pair spans them.
  if (Math.abs(d) < 1e-12) return [across(a, b), across(a, c), across(b, c)].sort((p, q) => q.radius - p.radius)[0]
  const sa = a.x * a.x + a.y * a.y, sb = b.x * b.x + b.y * b.y, sc = c.x * c.x + c.y * c.y
  const center = { x: (sa * (b.y - c.y) + sb * (c.y - a.y) + sc * (a.y - b.y)) / d, y: (sa * (c.x - b.x) + sb * (a.x - c.x) + sc * (b.x - a.x)) / d }
  return { center, radius: Math.hypot(a.x - center.x, a.y - center.y) }
}
/** The smallest circle around a set of points (incremental Welzl). */
export function enclosingCircle(points: Vec[]): Circle {
  if (!points.length) return { center: { x: 0, y: 0 }, radius: 0 }
  let c: Circle = { center: points[0], radius: 0 }
  for (let i = 1; i < points.length; i++) {
    if (inside(c, points[i])) continue
    c = { center: points[i], radius: 0 }
    for (let j = 0; j < i; j++) {
      if (inside(c, points[j])) continue
      c = across(points[i], points[j])
      for (let k = 0; k < j; k++) if (!inside(c, points[k])) c = through(points[i], points[j], points[k])
    }
  }
  return c
}

/** Several selected stickers share one ring: the smallest circle around all their corners. Turning and
 * scaling about its center maps it onto itself, so the ring holds still while the group moves. */
export function stickerGroupRing(list: Sticker[]): Circle {
  return enclosingCircle(list.flatMap(stickerCorners))
}

/** Turns (degrees) and scales a group about a pivot. The scale is clamped for the whole group,
 * so every sticker keeps its size relative to the others. */
export function transformStickerGroup(list: Sticker[], pivot: Vec, scale: number, turn: number): Record<string, Pick<Sticker, 'x' | 'y' | 'w' | 'angle'>> {
  const lo = Math.max(...list.map((s) => STICKER_MIN / s.w)), hi = Math.min(...list.map((s) => Math.min(STICKER_MAX, STICKER_MAX * s.content.width / s.content.height) / s.w))
  const k = Math.max(Math.min(lo, hi), Math.min(hi, scale)), a = turn * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
  const out: Record<string, Pick<Sticker, 'x' | 'y' | 'w' | 'angle'>> = {}
  for (const s of list) {
    const c = centerOf(s), dx = c.x - pivot.x, dy = c.y - pivot.y
    const next = { x: pivot.x + k * (dx * cos - dy * sin), y: pivot.y + k * (dx * sin + dy * cos) }
    const w = s.w * k, h = w * s.content.height / s.content.width
    out[s.id] = { w, x: Math.max(-1e6, Math.min(1e6, next.x - w / 2)), y: Math.max(-1e6, Math.min(1e6, next.y - h / 2)), angle: normalizeAngle(s.angle + turn) }
  }
  return out
}

/** The ring gesture for a group: distance from the pivot scales, direction turns, both relative to the grab. */
export function ringGesture(pivot: Vec, grabbedAt: Vec, p: Vec): { scale: number; turn: number } {
  const start = { x: grabbedAt.x - pivot.x, y: grabbedAt.y - pivot.y }, next = { x: p.x - pivot.x, y: p.y - pivot.y }
  const from = Math.hypot(start.x, start.y), to = Math.hypot(next.x, next.y)
  if (from < .001) return { scale: 1, turn: 0 }
  return { scale: to / from, turn: to < .001 ? 0 : (Math.atan2(next.y, next.x) - Math.atan2(start.y, start.x)) * 180 / Math.PI }
}

/** Defend rendering against corrupt local/remote data as well as server rejection. */
export function usableSticker(value: unknown): value is Sticker {
  const s = value as Sticker | null
  return !!s && s.kind === 'sticker' && typeof s.boardId === 'string' && [s.x, s.y, s.w, s.angle, s.z].every(Number.isFinite)
    && Math.abs(s.x) <= 1e6 && Math.abs(s.y) <= 1e6 && s.w >= STICKER_MIN && s.w <= STICKER_MAX && Math.abs(s.angle) <= 180 && Math.abs(s.z) <= 1e9
    && !!s.content && typeof s.content.assetId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.content.assetId)
    && typeof s.content.packName === 'string' && PACK_NAME.test(s.content.packName) && typeof s.content.emoji === 'string' && s.content.emoji.length <= 64
    && typeof s.content.stickerId === 'string' && s.content.stickerId.length >= 1 && s.content.stickerId.length <= 128
    && ['static', 'tgs', 'webm'].includes(s.content.format) && [s.content.width, s.content.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 512)
    && stickerHeight(s) <= STICKER_MAX && s.content.width / s.content.height <= 16 && s.content.height / s.content.width <= 16
}
