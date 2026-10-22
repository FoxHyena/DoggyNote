// A small, bounded WebM demuxer for Telegram video stickers (VP8/VP9 with optional alpha).
// WebKit's <video> ignores WebM alpha, so the web app decodes these frames itself with WebCodecs.
// libvpx stores the alpha plane as a second VP9 stream in BlockAdditional (BlockAddID 1).

export type WebmFrame = { /** microseconds */ timestamp: number; key: boolean; data: Uint8Array; alpha?: Uint8Array }
export type Webm = { codec: 'vp8' | 'vp9'; width: number; height: number; /** microseconds */ duration: number; frames: WebmFrame[] }

const ID = {
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83,
  CodecID: 0x86, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3,
  BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb, BlockAdditions: 0x75a1, BlockMore: 0xa6, BlockAddID: 0xee, BlockAdditional: 0xa5,
}
/** Entered rather than skipped. Everything else at an unknown position is skipped by size. */
const CONTAINERS = new Set([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Video, ID.Cluster, ID.BlockGroup, ID.BlockAdditions, ID.BlockMore])
/** A Cluster of unknown size ends where one of these top-level elements starts. */
const TOP_LEVEL = new Set([ID.Cluster, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770, ID.Tracks, ID.Info])
const MAX_BYTES = 4 * 1024 * 1024, MAX_FRAMES = 1200, MAX_ELEMENTS = 200_000

/** Parses a WebM file's first video track, or returns null for anything unsupported or malformed. */
export function demuxWebm(bytes: Uint8Array): Webm | null {
  if (bytes.length < 8 || bytes.length > MAX_BYTES || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return null
  let pos = 0, elements = 0
  const vint = (keepMarker: boolean): number | null => {
    const first = bytes[pos]
    if (first === undefined || first === 0) return null
    let length = 1
    while (!(first & (0x80 >> (length - 1)))) length++
    if (length > 8 || pos + length > bytes.length) return null
    let value = keepMarker ? first : first & ((0x80 >> (length - 1)) - 1), unknown = value === (0x80 >> (length - 1)) - 1
    for (let k = 1; k < length; k++) { value = value * 256 + bytes[pos + k]; unknown &&= bytes[pos + k] === 0xff }
    pos += length
    return !keepMarker && unknown ? -1 : value
  }
  const uint = (start: number, end: number) => { let v = 0; for (let i = start; i < end; i++) v = v * 256 + bytes[i]; return v }

  let scale = 1_000_000, cluster = 0
  type Track = { number: number; type: number; codec: string; width: number; height: number }
  const tracks: Track[] = []
  let track: Track | undefined
  type Pending = { track: number; timecode: number; key: boolean; data?: Uint8Array; alpha?: Uint8Array; addId: number }
  const blocks: Pending[] = []
  let group: Pending | undefined
  const stack: { id: number; end: number }[] = []

  /** Block header: track number, signed 16-bit timecode relative to the cluster, flags. */
  const block = (start: number, end: number, simple: boolean): Pending | null => {
    const at = pos; pos = start
    const number = vint(false), header = pos
    pos = at
    if (number === null || number < 0 || header + 3 > end) return null
    const relative = (bytes[header] << 24 >> 16) | bytes[header + 1], flags = bytes[header + 2]
    // Laced blocks never occur in video stickers.
    if (flags & 0x06) return null
    return { track: number, timecode: cluster + relative, key: simple ? !!(flags & 0x80) : true, data: bytes.subarray(header + 3, end), addId: 1 }
  }

  while (pos < bytes.length) {
    while (stack.length && pos >= stack[stack.length - 1].end) close(stack.pop()!.id)
    if (++elements > MAX_ELEMENTS) return null
    // A header cut short ends the file; the frames before it still play.
    const id = vint(true)
    if (id === null) break
    // An unknown-size Cluster ends when the next top-level element starts.
    if (TOP_LEVEL.has(id) && stack.length && stack[stack.length - 1].id === ID.Cluster && stack[stack.length - 1].end === Infinity) close(stack.pop()!.id)
    const size = vint(false)
    if (size === null) break
    const parentEnd = stack.length ? stack[stack.length - 1].end : bytes.length
    const start = pos, end = size < 0 ? (id === ID.Cluster ? Infinity : Math.min(parentEnd, bytes.length)) : start + size
    if (end !== Infinity && (end > bytes.length || end > parentEnd)) {
      // A truncated final cluster still yields the frames before it.
      if (id === ID.Cluster || id === ID.Segment) { stack.push({ id, end: Math.min(parentEnd, bytes.length) }); open(id); continue }
      break
    }
    if (CONTAINERS.has(id)) { stack.push({ id, end }); open(id); continue }
    const leafEnd = Math.min(end, bytes.length)
    switch (id) {
      case ID.TimecodeScale: scale = uint(start, leafEnd) || scale; break
      case ID.TrackNumber: if (track) track.number = uint(start, leafEnd); break
      case ID.TrackType: if (track) track.type = uint(start, leafEnd); break
      case ID.CodecID: if (track) track.codec = String.fromCharCode(...bytes.subarray(start, Math.min(leafEnd, start + 32))); break
      case ID.PixelWidth: if (track) track.width = uint(start, leafEnd); break
      case ID.PixelHeight: if (track) track.height = uint(start, leafEnd); break
      case ID.Timecode: cluster = uint(start, leafEnd); break
      case ID.SimpleBlock: { const b = block(start, leafEnd, true); if (!b) return null; blocks.push(b); break }
      case ID.Block: { if (!group) return null; const b = block(start, leafEnd, false); if (!b) return null; Object.assign(group, { track: b.track, timecode: b.timecode, data: b.data }); break }
      case ID.ReferenceBlock: if (group) group.key = false; break
      case ID.BlockAddID: if (group) group.addId = uint(start, leafEnd); break
      case ID.BlockAdditional: if (group && group.addId === 1) group.alpha = bytes.subarray(start, leafEnd); break
    }
    pos = leafEnd
    if (blocks.length > MAX_FRAMES) return null
  }
  while (stack.length) close(stack.pop()!.id)

  function open(id: number) {
    if (id === ID.TrackEntry) { track = { number: 0, type: 0, codec: '', width: 0, height: 0 }; tracks.push(track) }
    if (id === ID.BlockGroup) group = { track: 0, timecode: 0, key: true, addId: 1 }
  }
  function close(id: number) {
    if (id === ID.TrackEntry) track = undefined
    if (id === ID.BlockMore && group) group.addId = 1
    if (id === ID.BlockGroup && group) { if (group.data) blocks.push(group); group = undefined }
  }

  const video = tracks.find((t) => t.type === 1 || /^V_VP[89]$/.test(t.codec))
  if (!video || !/^V_VP[89]$/.test(video.codec) || video.width < 1 || video.height < 1 || video.width > 4096 || video.height > 4096) return null
  const frames = blocks.filter((b) => b.track === video.number && b.data?.length)
    .map((b) => ({ timestamp: Math.round(b.timecode * scale / 1000), key: b.key, data: b.data!, ...(b.alpha?.length ? { alpha: b.alpha } : {}) }))
    .sort((a, b) => a.timestamp - b.timestamp)
  if (!frames.length || !frames[0].key) return null
  const step = frames.length > 1 ? (frames[frames.length - 1].timestamp - frames[0].timestamp) / (frames.length - 1) : 33_333
  return { codec: video.codec === 'V_VP9' ? 'vp9' : 'vp8', width: video.width, height: video.height, duration: frames[frames.length - 1].timestamp - frames[0].timestamp + Math.round(step), frames }
}
