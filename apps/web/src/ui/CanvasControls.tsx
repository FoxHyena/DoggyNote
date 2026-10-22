import './navigation.css'
import { Show, createSignal, onCleanup } from 'solid-js'
import * as doc from '../state/doc.ts'
import { camera } from '../state/ui.ts'
import { snapToGrid, toggleSnap } from '../state/grid.ts'
import { zoomBy, zoomTo, zoomToFit } from '../canvas/Canvas.tsx'
import { Icon } from './icons.tsx'
import { installMenu } from './menu.ts'

export const [canvasControlsSize, setCanvasControlsSize] = createSignal({ width: 0, height: 0 })

export function CanvasControls(props: { readOnly: boolean }) {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement, trigger!: HTMLButtonElement
  installMenu(open, () => setOpen(false), () => root, () => trigger)
  const item = (label: string, key: string, action: () => void) => <button class="menu-item" onClick={() => { action(); setOpen(false); trigger.focus() }}><span class="nav-menu-label">{label}</span><kbd class="nav-menu-meta">{key}</kbd></button>
  return <div class="canvas-controls" data-testid="canvas-controls" aria-label="Canvas controls" role="toolbar"
    ref={(element) => { const observer = new ResizeObserver(() => setCanvasControlsSize({ width: element.offsetWidth, height: element.offsetHeight })); observer.observe(element); onCleanup(() => { observer.disconnect(); setCanvasControlsSize({ width: 0, height: 0 }) }) }}
    onPointerDown={(e) => e.stopPropagation()}>
    <Show when={!props.readOnly}>
      <button class="icon-btn" data-testid="undo" aria-label="Undo" data-tooltip="Undo (⌘Z)" disabled={!doc.canUndo()} onClick={() => doc.undo()}><Icon name="undo" /></button>
      <button class="icon-btn" data-testid="redo" aria-label="Redo" data-tooltip="Redo (⇧⌘Z)" disabled={!doc.canRedo()} onClick={() => doc.redo()}><Icon name="redo" /></button>
      <span class="bar-sep" />
    </Show>
    <div class="canvas-zoom" ref={root}>
      <button ref={trigger} class="icon-btn" data-testid="zoom" aria-label={`Zoom: ${Math.round(camera().zoom * 100)}%`} aria-expanded={open()} data-tooltip="Zoom options" onClick={() => setOpen(!open())}>{Math.round(camera().zoom * 100)}% <Icon name="chevronDown" size={10} /></button>
      <Show when={open()}><div class="menu nav-menu" aria-label="Zoom options">
        <div class="nav-menu-head sheet-only"><strong>Zoom · {Math.round(camera().zoom * 100)}%</strong></div>
        {item('Zoom in', '⌘=', () => zoomBy(1.25))}{item('Zoom out', '⌘−', () => zoomBy(0.8))}{item('Zoom to 100%', '⌘0', () => zoomTo(1))}{item('Zoom to fit', '⌘1', zoomToFit)}
      </div></Show>
    </div>
    <Show when={!props.readOnly}><span class="bar-sep" /><button class="icon-btn" classList={{ on: snapToGrid() }} data-testid="snap-toggle" aria-label="Snap to grid" aria-pressed={snapToGrid()} data-tooltip={`Snap to grid: ${snapToGrid() ? 'on' : 'off'} (⌘')`} onClick={toggleSnap}><Icon name="grid" /></button></Show>
  </div>
}
