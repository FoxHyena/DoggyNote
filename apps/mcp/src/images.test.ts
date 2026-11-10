import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { captionFor, collectImages, gridLayout, placeBelow, processImage, stableUuid } from './images.ts'

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer()

describe('collectImages', () => {
  it('reads a folder in natural name order, skips hidden and non-image files, and recurses only when asked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dn-mcp-'))
    try {
      for (const name of ['ref10.png', 'ref2.JPG', 'ref1.webp', '.hidden.png', 'notes.txt']) await writeFile(join(dir, name), 'x')
      await mkdir(join(dir, 'sub'))
      await writeFile(join(dir, 'sub', 'deep.gif'), 'x')
      const flat = await collectImages([dir], false)
      expect(flat.files.map((f) => f.slice(dir.length + 1))).toEqual(['ref1.webp', 'ref2.JPG', 'ref10.png'])
      expect(flat.skipped).toEqual([])
      expect((await collectImages([dir], true)).files.map((f) => f.slice(dir.length + 1))).toEqual(['ref1.webp', 'ref2.JPG', 'ref10.png', 'sub/deep.gif'])
      const named = await collectImages([join(dir, 'notes.txt'), join(dir, 'missing.png'), join(dir, 'ref1.webp'), dir], false)
      expect(named.skipped.map((s) => s.reason)).toEqual([expect.stringContaining('not a supported image'), 'not found'])
      expect(named.files.filter((f) => f.endsWith('ref1.webp'))).toHaveLength(1)
    } finally { await rm(dir, { recursive: true }) }
  })
})

describe('processImage', () => {
  it('makes the four renditions, never upscaling', async () => {
    const out = await processImage(await png(800, 400), 'wide.png')
    expect(out).toMatchObject({ width: 800, height: 400 })
    const sizes = await Promise.all(out.renditions.map(async (r) => ({ ...(await sharp(r.bytes).metadata()), size: r.size, type: r.type })))
    expect(sizes.map((s) => [s.size, s.width, s.height, s.type])).toEqual([['thumb', 256, 128, 'image/webp'], ['small', 640, 320, 'image/webp'], ['medium', 800, 400, 'image/webp'], ['full', 800, 400, 'image/webp']])
  })
  it('applies EXIF rotation to the size and pixels, and keeps JPEGs as JPEG', async () => {
    const turned = await sharp(await png(300, 100)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const out = await processImage(turned, 'phone.jpg')
    expect(out).toMatchObject({ width: 100, height: 300 })
    const thumb = await sharp(out.renditions[0].bytes).metadata()
    expect([thumb.width, thumb.height, thumb.format]).toEqual([85, 256, 'jpeg'])
  })
  it('keeps a GIF’s own bytes at full size', async () => {
    const gif = await sharp(await png(50, 50)).gif().toBuffer()
    const full = (await processImage(gif, 'a.gif')).renditions.find((r) => r.size === 'full')!
    expect(full.type).toBe('image/gif')
    expect(full.bytes.equals(gif)).toBe(true)
  })
  it('refuses something that is not an image', async () => {
    await expect(processImage(Buffer.from('not an image'), 'fake.png')).rejects.toThrow()
  })
})

describe('layout and ids', () => {
  it('lays rows out by the tallest image in each row', () => {
    expect(gridLayout([{ width: 100, height: 100 }, { width: 100, height: 200 }, { width: 200, height: 100 }], { x: 10, y: 20, columns: 2, cardWidth: 100, gap: 10 })).toEqual([
      { x: 10, y: 20, w: 100, h: 100 }, { x: 120, y: 20, w: 100, h: 200 }, { x: 10, y: 230, w: 100, h: 50 },
    ])
  })
  it('leaves room for captions under each row', () => {
    expect(gridLayout([{ width: 100, height: 100 }, { width: 100, height: 100 }], { x: 0, y: 0, columns: 1, cardWidth: 100, gap: 10, extra: 40 }).map((s) => s.y)).toEqual([0, 150])
  })
  it('starts under the existing free cards', () => {
    expect(placeBelow([])).toEqual({ x: 0, y: 0 })
    expect(placeBelow([{ kind: 'board' }, { kind: 'card', x: 50, y: 0, h: 100 }, { kind: 'card', x: -20, y: 300, h: 40 }, { kind: 'card', x: -999, y: 5000, h: 10, columnId: 'c' }])).toEqual({ x: -20, y: 420 })
  })
  it('makes stable UUID-shaped ids that differ by secret and content', async () => {
    const a = await stableUuid('token', 'image')
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await stableUuid('token', 'image')).toBe(a)
    expect(await stableUuid('other', 'image')).not.toBe(a)
    expect(await stableUuid('token', new TextEncoder().encode('image'))).toBe(a)
  })
  it('captions with the file name only', () => expect(captionFor('/refs/IMG_0042.jpeg')).toBe('IMG_0042'))
})
