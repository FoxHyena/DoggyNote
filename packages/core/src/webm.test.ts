// @ts-expect-error core has no Node types; vitest runs this in Node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demuxWebm } from './webm.ts'

const fixture = new Uint8Array(readFileSync(new URL('../../../apps/web/e2e/fixtures/stickers/animation.webm', (import.meta as unknown as { url: string }).url)))

describe('webm demuxer', () => {
  it('reads VP9 frames with their libvpx alpha stream', () => {
    const webm = demuxWebm(fixture)!
    expect(webm).toMatchObject({ codec: 'vp9', width: 256, height: 256 })
    expect(webm.frames).toHaveLength(20)
    expect(webm.frames[0].key).toBe(true)
    expect(webm.frames.slice(1).every((f) => !f.key)).toBe(true)
    expect(webm.frames.every((f) => f.data.length > 0 && (f.alpha?.length ?? 0) > 0)).toBe(true)
    expect(webm.frames.map((f) => f.timestamp)).toEqual([...webm.frames.map((f) => f.timestamp)].sort((a, b) => a - b))
    expect(webm.duration).toBeGreaterThan(900_000); expect(webm.duration).toBeLessThan(1_100_000)
  })
  it('keeps the frames before a truncation', () => {
    const webm = demuxWebm(fixture.subarray(0, Math.floor(fixture.length * .9)))!
    expect(webm.frames.length).toBeGreaterThan(0); expect(webm.frames[0].key).toBe(true)
  })
  it('reads a cluster of unknown size', () => {
    // Re-mux the fixture's one cluster with an unknown (all ones) 8-byte size.
    const at = fixture.findIndex((_, i) => fixture[i] === 0x1f && fixture[i + 1] === 0x43 && fixture[i + 2] === 0xb6 && fixture[i + 3] === 0x75)
    const sizeLength = 8 - Math.floor(Math.log2(fixture[at + 4]))
    const out = new Uint8Array([...fixture.subarray(0, at + 4), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...fixture.subarray(at + 4 + sizeLength)])
    // The Segment size no longer matches, so mark it unknown too.
    const segment = out.findIndex((_, i) => out[i] === 0x18 && out[i + 1] === 0x53 && out[i + 2] === 0x80 && out[i + 3] === 0x67)
    const segmentSize = 8 - Math.floor(Math.log2(out[segment + 4]))
    const fixed = new Uint8Array([...out.subarray(0, segment + 4), 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...out.subarray(segment + 4 + segmentSize)])
    expect(demuxWebm(fixed)?.frames).toHaveLength(20)
  })
  it('rejects anything else', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array([...'<svg onload="x"/>'].map((c) => c.charCodeAt(0))), fixture.subarray(0, 40), new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0])]) expect(demuxWebm(bytes)).toBeNull()
  })
})
