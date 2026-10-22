import { demuxWebm, type WebmFrame } from '@doggynote/core'

// WebKit (Safari, iPhone, the Tauri app) plays WebM without its alpha channel, so a video sticker
// would sit on a black box. This decodes the colour and alpha streams with WebCodecs and joins them
// on the GPU: one shared WebGL canvas for every player, then a copy into each sticker's own canvas.

const VERTEX = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}'
// The alpha stream is a greyscale picture: its brightness is the opacity.
const FRAGMENT = 'precision mediump float;varying vec2 uv;uniform sampler2D color;uniform sampler2D alpha;uniform float hasAlpha;void main(){vec3 c=texture2D(color,uv).rgb;float a=hasAlpha>.5?texture2D(alpha,uv).r:1.;gl_FragColor=vec4(c*a,a);}'

type Compositor = { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; textures: [WebGLTexture, WebGLTexture]; hasAlpha: WebGLUniformLocation; staging?: HTMLCanvasElement }
let shared: Compositor | null | undefined

function compositor(): Compositor | null {
  if (shared !== undefined) return shared
  shared = null
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
  if (!gl) return null
  const shader = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); return s }
  const program = gl.createProgram()!
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const p = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)
  const texture = (unit: number, name: string) => {
    const t = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.uniform1i(gl.getUniformLocation(program, name), unit)
    return t
  }
  shared = { canvas, gl, textures: [texture(0, 'color'), texture(1, 'alpha')], hasAlpha: gl.getUniformLocation(program, 'hasAlpha')! }
  return shared
}

/** Uploads a decoded frame. Engines that can't take a VideoFrame directly go through a 2D canvas. */
function upload(c: Compositor, unit: number, frame: VideoFrame) {
  const { gl } = c
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, c.textures[unit])
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); return } catch { /* fall through */ }
  const staging = c.staging ??= document.createElement('canvas')
  staging.width = frame.displayWidth; staging.height = frame.displayHeight
  staging.getContext('2d')!.drawImage(frame, 0, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, staging)
}

function compose(c: Compositor, color: VideoFrame, alpha: VideoFrame | null, target: CanvasRenderingContext2D) {
  const { gl, canvas } = c, { width, height } = target.canvas
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
  gl.viewport(0, 0, width, height)
  upload(c, 0, color)
  if (alpha) upload(c, 1, alpha)
  gl.uniform1f(c.hasAlpha, alpha ? 1 : 0)
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  target.clearRect(0, 0, width, height)
  target.drawImage(canvas, 0, 0, width, height)
}

const codecOf = (codec: 'vp8' | 'vp9') => codec === 'vp9' ? 'vp09.00.10.08' : 'vp8'

/** True when this engine can decode the sticker's frames itself. */
export async function canDecodeWebm(): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined' || !compositor()) return false
  try { return !!(await VideoDecoder.isConfigSupported({ codec: 'vp09.00.10.08', codedWidth: 512, codedHeight: 512 })).supported } catch { return false }
}

/**
 * Loops a WebM sticker into `canvas` until `signal` aborts. Resolves false when this engine
 * can't decode it, so the caller keeps the still. Calls `onFrame` after each painted frame.
 * While `held()` is true it keeps its current frame, then resumes from where it was.
 */
export async function playWebm(bytes: ArrayBuffer, canvas: HTMLCanvasElement, size: number, signal: AbortSignal, onFrame: () => void, onError: () => void, held: () => boolean = () => false): Promise<boolean> {
  const webm = demuxWebm(new Uint8Array(bytes)), c = compositor()
  if (!webm || !c || typeof VideoDecoder === 'undefined') return false
  const config: VideoDecoderConfig = { codec: codecOf(webm.codec), codedWidth: webm.width, codedHeight: webm.height }
  try { if (!(await VideoDecoder.isConfigSupported(config)).supported) return false } catch { return false }
  if (signal.aborted) return true
  const scale = Math.min(1, size / Math.max(webm.width, webm.height))
  canvas.width = Math.max(1, Math.round(webm.width * scale)); canvas.height = Math.max(1, Math.round(webm.height * scale))
  const target = canvas.getContext('2d')!
  // libvpx writes alpha for every frame or none; a partial stream plays opaque, never misaligned.
  const withAlpha = webm.frames.every((f) => f.alpha)

  // Decoded frames wait here, paired by timestamp, until their moment to show.
  const colors: VideoFrame[] = [], alphas: VideoFrame[] = []
  let failed = false
  const fail = () => { if (!failed) { failed = true; stop(); onError() } }
  const decoders = [colors, alphas].slice(0, withAlpha ? 2 : 1).map((queue) => {
    const d = new VideoDecoder({ output: (frame) => { if (signal.aborted) frame.close(); else queue.push(frame) }, error: fail })
    d.configure(config)
    return d
  })
  // The clock starts with the first decoded frame, so a slow first decode never skips ahead.
  let next = 0, loop = 0, start = -1, last = -1, raf = 0
  const AHEAD = 3
  const feed = () => {
    while (!failed && colors.length + decoders[0].decodeQueueSize < AHEAD) {
      if (next >= webm.frames.length) { next = 0; loop++ }
      const f: WebmFrame = webm.frames[next++], timestamp = f.timestamp + loop * webm.duration
      decoders[0].decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp, data: f.data }))
      if (withAlpha) decoders[1].decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp, data: f.alpha! }))
    }
  }
  const tick = (now: number) => {
    raf = 0
    if (signal.aborted || failed) return
    // Holding shifts the clock, so playback resumes on the frame it stopped at.
    if (held()) { if (last >= 0 && start >= 0) start += now - last; last = now; raf = requestAnimationFrame(tick); return }
    last = now
    if (start < 0 && colors.length) start = now - colors[0].timestamp / 1000
    const elapsed = start < 0 ? -Infinity : (now - start) * 1000
    // Show the newest frame that is due; drop any we fell behind on.
    let shown = false
    while (colors.length && (!withAlpha || alphas.length) && colors[0].timestamp <= elapsed) {
      const color = colors.shift()!, alpha = withAlpha ? alphas.shift()! : null
      const due = colors.length && colors[0].timestamp <= elapsed && (!withAlpha || alphas.length)
      if (!due) { try { compose(c, color, alpha, target); shown = true } catch { color.close(); alpha?.close(); fail(); return } }
      color.close(); alpha?.close()
    }
    if (shown) onFrame()
    try { feed() } catch { fail(); return }
    raf = requestAnimationFrame(tick)
  }
  const stop = () => {
    cancelAnimationFrame(raf)
    for (const d of decoders) if (d.state !== 'closed') d.close()
    for (const f of [...colors, ...alphas]) f.close()
    colors.length = alphas.length = 0
  }
  signal.addEventListener('abort', stop, { once: true })
  try { feed() } catch { fail(); return true }
  raf = requestAnimationFrame(tick)
  return true
}
