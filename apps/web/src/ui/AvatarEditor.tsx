import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { api, ApiError } from '../state/api.ts'
import { updateProfile, type User } from '../state/session.ts'
import { Icon } from './icons.tsx'
import { installModalKeys, agentDialogKeys } from './agentDialog.ts'
import { SheetGrip } from './SheetGrip.tsx'
import { cropHandle, cropSide, fitImage, initialCrop, moveCrop, pinchCrop, placeMoveGrip, resizeCrop, type Crop, type CropCorner } from './avatarCrop.ts'
import './avatar.css'

export const PHOTO_TYPES = 'image/jpeg,image/png,image/webp'
export function AvatarEditor(props: { file: File; onClose: () => void }) {
  const [image, setImage] = createSignal<ImageBitmap>()
  const [crop, setCrop] = createSignal<Crop>({ x: 0, y: 0, zoom: 1 })
  const [size, setSize] = createSignal(0)
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  let panel!: HTMLDivElement, stage!: HTMLDivElement, canvas!: HTMLCanvasElement, closeButton!: HTMLButtonElement
  let disposed = false
  const pointers = new Map<number, { x: number; y: number }>()
  let resize: { id: number; corner: CropCorner; start: { x: number; y: number }; crop: Crop } | undefined
  const corners = [ { x: -1, y: -1, name: 'top left' }, { x: 1, y: -1, name: 'top right' }, { x: -1, y: 1, name: 'bottom left' }, { x: 1, y: 1, name: 'bottom right' } ] as const
  const projection = createMemo(() => image() ? fitImage(image()!, size()) : { scale: 1, left: 0, top: 0 })
  const frame = createMemo(() => {
    const bitmap = image(), c = crop(), view = projection()
    return { x: view.left + c.x * view.scale, y: view.top + c.y * view.scale, side: bitmap ? cropSide(bitmap, c) * view.scale : 0 }
  })
  const moveGrip = createMemo(() => image() && frame().side < 44 ? placeMoveGrip(frame(), size()) : undefined)
  const cornerPath = () => { const point = 44 - Math.min(10, frame().side / 3), arm = Math.min(8, frame().side / 4); return `M${point} ${point + arm}V${point}H${point + arm}` }
  const imagePath = () => { const bitmap = image()!, view = projection(); return `M${view.left} ${view.top}h${bitmap.width * view.scale}v${bitmap.height * view.scale}h${-bitmap.width * view.scale}Z` }
  const squarePath = () => { const f = frame(); return `M${f.x - f.side / 2} ${f.y - f.side / 2}h${f.side}v${f.side}h${-f.side}Z` }
  const circlePath = () => { const f = frame(), r = f.side / 2; return `M${f.x} ${f.y - r}a${r} ${r} 0 1 0 0 ${r * 2}a${r} ${r} 0 1 0 0 ${-r * 2}Z` }
  const reset = () => { clearPointers(); setCrop(initialCrop(image()!)) }
  const close = () => { if (!busy()) props.onClose() }
  const clearPointers = () => { pointers.clear(); resize = undefined }
  const releasePointer = (e: PointerEvent) => { pointers.delete(e.pointerId); if (resize?.id === e.pointerId) resize = undefined }
  onMount(() => {
    const releaseKeys = installModalKeys(panel, close, closeButton)
    closeButton.focus({ preventScroll: true })
    const observer = new ResizeObserver(() => { clearPointers(); setSize(stage.clientWidth) })
    observer.observe(stage)
    window.addEventListener('blur', clearPointers)
    onCleanup(() => { disposed = true; releaseKeys(); observer.disconnect(); window.removeEventListener('blur', clearPointers); image()?.close() })
    void (async () => {
      try {
        if (!PHOTO_TYPES.split(',').includes(props.file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.')
        if (props.file.size > 15 * 1024 * 1024) throw new Error('Choose a photo under 15 MB.')
        const bitmap = await createImageBitmap(props.file, { imageOrientation: 'from-image' })
        if (disposed) { bitmap.close(); return }
        setCrop(initialCrop(bitmap)); setImage(bitmap)
      } catch (e) { if (!disposed) setError(e instanceof Error && /Choose/.test(e.message) ? e.message : 'That photo could not be read. Close this editor and choose another image.') }
    })()
  })
  createEffect(() => {
    const bitmap = image(), view = projection(), width = size()
    if (!bitmap || !width) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * ratio); canvas.height = canvas.width
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, view.left, view.top, bitmap.width * view.scale, bitmap.height * view.scale)
  })
  const metrics = () => {
    const values = [...pointers.values()].slice(0, 2)
    const a = values[0]!, b = values[1] ?? a
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) }
  }
  function down(e: PointerEvent, fromGrip = false) {
    if (!image() || busy() || e.button !== 0) return
    const rect = stage.getBoundingClientRect(), f = frame()
    if (!fromGrip && !pointers.size && (Math.abs(e.clientX - rect.left - f.x) > f.side / 2 || Math.abs(e.clientY - rect.top - f.y) > f.side / 2)) return
    e.preventDefault(); (fromGrip ? e.currentTarget as HTMLElement : stage).focus({ preventScroll: true })
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { stage.setPointerCapture(e.pointerId) } catch { /* Synthetic WebKit touches have no native capture. */ }
  }
  function resizeDown(e: PointerEvent, corner: CropCorner) {
    if (!image() || busy() || e.button !== 0) return
    e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLButtonElement).focus({ preventScroll: true })
    clearPointers(); resize = { id: e.pointerId, corner, start: { x: e.clientX, y: e.clientY }, crop: crop() }
    try { stage.setPointerCapture(e.pointerId) } catch { /* Synthetic touch input has no native capture. */ }
  }
  function resizeKey(e: KeyboardEvent, corner: CropCorner) {
    if (!image() || busy() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault(); e.stopPropagation(); clearPointers()
    const bitmap = image()!, old = crop(), side = cropSide(bitmap, old)
    const delta = Math.min(bitmap.width, bitmap.height) * (e.shiftKey ? .1 : .02) * (['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1)
    setCrop(resizeCrop(bitmap, old, corner, { x: old.x + corner.x * (side / 2 + delta), y: old.y + corner.y * (side / 2 + delta) }))
  }
  function move(e: PointerEvent) {
    const bitmap = image()
    if (!bitmap || busy()) return
    if (resize?.id === e.pointerId) {
      e.preventDefault()
      const side = cropSide(bitmap, resize.crop), corner = resize.corner, scale = projection().scale
      const next = resizeCrop(bitmap, resize.crop, corner, { x: resize.crop.x + corner.x * side / 2 + (e.clientX - resize.start.x) / scale, y: resize.crop.y + corner.y * side / 2 + (e.clientY - resize.start.y) / scale })
      setCrop(next)
      // Consume even clipped movement, so reversing at a bound never has a dead zone.
      resize = { ...resize, crop: next, start: { x: e.clientX, y: e.clientY } }
      return
    }
    if (!pointers.has(e.pointerId)) return
    e.preventDefault()
    const before = metrics()
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const after = metrics(), scale = projection().scale
    const delta = { x: (after.x - before.x) / scale, y: (after.y - before.y) / scale }
    setCrop(before.distance > 0 && after.distance > 0 ? pinchCrop(bitmap, crop(), after.distance / before.distance, delta) : moveCrop(bitmap, crop(), delta))
  }

  function keyboard(e: KeyboardEvent) {
    const bitmap = image()
    if (!bitmap || busy() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault(); e.stopPropagation()
    const step = cropSide(bitmap, crop()) * (e.shiftKey ? .1 : .01)
    setCrop(moveCrop(bitmap, crop(), { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 }))
  }
  async function save() {
    const bitmap = image()
    if (!bitmap || busy()) return
    clearPointers(); setBusy(true); setError('')
    try {
      const output = new OffscreenCanvas(512, 512), ctx = output.getContext('2d')!, c = crop(), side = cropSide(bitmap, c)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, c.x - side / 2, c.y - side / 2, side, side, 0, 0, 512, 512)
      const photo = await output.convertToBlob({ type: 'image/png' })
      const result = await api<{ user: User }>('/api/me/avatar', { method: 'PUT', body: photo, headers: { 'content-type': 'image/png' } })
      updateProfile(result.user); props.onClose()
    } catch (e) { if (!disposed) setError(e instanceof ApiError ? e.message : 'Could not save your photo. Check your connection and try again.') }
    finally { if (!disposed) setBusy(false) }
  }
  return <div class="dialog-backdrop avatar-backdrop" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) close() }} onKeyDown={agentDialogKeys}>
    <div ref={panel} class="dialog avatar-editor" role="dialog" aria-modal="true" aria-labelledby="avatar-title" aria-describedby="avatar-hint" aria-busy={busy()} data-testid="avatar-editor">
      <SheetGrip onDismiss={close} disabled={busy()} />
      <header class="dialog-head"><h2 id="avatar-title">Profile photo</h2><button ref={closeButton} class="icon-btn" aria-label="Close photo editor" disabled={busy()} onClick={close}><Icon name="close" /></button></header>
      <div class="avatar-body">
      <p id="avatar-hint" class="avatar-hint">Drag the circle to position it. Drag a corner to resize.</p>
      <div ref={stage} class="avatar-crop" data-testid="avatar-crop" data-x={crop().x} data-y={crop().y} data-zoom={crop().zoom} role="group" aria-label="Crop position" aria-describedby="avatar-keyboard-hint" tabindex={image() && !busy() ? 0 : -1} onKeyDown={keyboard} onPointerDown={down} onPointerMove={move} onPointerUp={releasePointer} onPointerCancel={releasePointer} onLostPointerCapture={releasePointer}>
        <Show when={image()}>{(bitmap) => <div class="avatar-transparency" aria-hidden="true" style={{ left: `${projection().left}px`, top: `${projection().top}px`, width: `${bitmap().width * projection().scale}px`, height: `${bitmap().height * projection().scale}px` }} />}</Show>
        <canvas ref={canvas} aria-hidden="true" />
        <Show when={image()} fallback={<span class="avatar-loading" role="status">{error() ? 'Preview unavailable' : 'Loading photo…'}</span>}>
          <div class="avatar-selection" data-testid="avatar-selection" style={{ left: `${frame().x - frame().side / 2}px`, top: `${frame().y - frame().side / 2}px`, width: `${frame().side}px`, height: `${frame().side}px` }} aria-hidden="true" />
          <svg class="avatar-guides" viewBox={`0 0 ${size() || 1} ${size() || 1}`} aria-hidden="true">
            <path class="avatar-shade-outer" fill-rule="evenodd" d={`${imagePath()} ${squarePath()}`} />
            <path class="avatar-shade-corners" fill-rule="evenodd" d={`${squarePath()} ${circlePath()}`} />
            <circle style={{ "stroke-width": Math.min(2.5, frame().side / 6) }} class="avatar-circle-under" cx={frame().x} cy={frame().y} r={frame().side / 2} />
            <circle style={{ "stroke-width": Math.min(1, frame().side / 12) }} class="avatar-circle" cx={frame().x} cy={frame().y} r={frame().side / 2} />
            <Show when={moveGrip()}>{(grip) => <line class="avatar-grip-leader" x1={grip().x + 22} y1={grip().y + 22} x2={frame().x} y2={frame().y} />}</Show>
          </svg>
          <Show when={moveGrip()}>{(grip) => <button type="button" class="bar-btn avatar-move-grip" aria-label="Move crop" aria-describedby="avatar-keyboard-hint" disabled={busy()} style={{ left: `${grip().x}px`, top: `${grip().y}px` }} onPointerDown={(e) => { e.stopPropagation(); down(e, true) }} onKeyDown={keyboard}><Icon name="move" size={16} /><span>Move<br />crop</span></button>}</Show>
          <For each={corners}>{(corner) => <button type="button" class="avatar-handle" classList={{ 'avatar-handle-cross': corner.x !== corner.y }} style={{ left: `${cropHandle(frame(), corner).x}px`, top: `${cropHandle(frame(), corner).y}px` }} role="slider" aria-label={`Resize crop from ${corner.name}`} aria-describedby="avatar-resize-hint" aria-valuemin={25} aria-valuemax={100} aria-valuenow={Math.round(100 / crop().zoom)} aria-valuetext={`${Math.round(100 / crop().zoom)}% crop size`} disabled={busy()} onPointerDown={(e) => resizeDown(e, corner)} onKeyDown={(e) => resizeKey(e, corner)}>
            <svg viewBox="0 0 44 44" aria-hidden="true" style={{ transform: `scale(${corner.x === -1 ? 1 : -1}, ${corner.y === -1 ? 1 : -1})` }}><path class="avatar-corner-under" style={{ "stroke-width": Math.min(4, frame().side / 8) }} d={cornerPath()} /><path class="avatar-corner-mark" style={{ "stroke-width": Math.min(2, frame().side / 16) }} d={cornerPath()} /></svg>
          </button>}</For>
        </Show>
      </div>
      <span id="avatar-keyboard-hint" class="avatar-sr">Use arrow keys to move the selection. Hold Shift for larger steps.</span>
      <span id="avatar-resize-hint" class="avatar-sr">Use arrow keys to resize the square. Right or up makes it larger; left or down makes it smaller. Hold Shift for larger steps.</span>
      <Show when={error()}><p class="form-error avatar-error" role="alert">{error()}</p></Show>
      </div>
      <footer class="avatar-actions"><button class="bar-btn avatar-reset" disabled={!image() || busy()} onClick={reset}>Reset</button><button class="bar-btn" disabled={busy()} onClick={close}>Cancel</button><button class="primary-btn" disabled={!image() || busy()} onClick={() => void save()}>{busy() ? 'Saving…' : 'Save photo'}</button></footer>
      <Show when={busy()}><span class="avatar-sr" role="status">Saving photo…</span></Show>
    </div>
  </div>
}
