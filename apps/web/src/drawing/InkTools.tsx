import { For, Show, createSignal, type JSX } from 'solid-js'
import { INK_PALETTE, INK_WIDTHS, SKETCH_PAPERS } from '@doggynote/core'
import { IconButton, ToolIcons } from '../ui/icons.tsx'
import { Popover } from '../ui/Popover.tsx'
import { ColorDots } from '../ui/ColorDots.tsx'
import { phone, touch } from '../state/device.ts'
import { inkColor, inkTool, inkWidth, setInkColor, setInkTool, setInkWidth, type DrawingTool } from '../state/drawing.ts'
import './ink.css'

/** The width dots grow by eye, not to scale: the finest line still needs a visible dot. */
const DOT_SIZES = [4, 8, 14]
const TOOLS: { id: DrawingTool; label: string; icon: keyof typeof ToolIcons; tip: string }[] = [
  { id: 'pen', label: 'Pen', icon: 'pen', tip: 'Pen · Shift-click for a straight line' },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter', tip: 'Highlighter · Shift-click for a straight line' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', tip: 'Eraser · Shift-click to erase in a straight line' },
]

/**
 * Pen, highlighter and eraser, the ink colours and the line widths: groups
 * parted by space, not rules. Shared by the sketch editor and drawing on the
 * board. `lead` goes first in the row (the editor's Undo and Redo). Ink and
 * paper colours are document data; everything around them is theme.
 */
export function InkTools(props: { onTool?: () => void; lead?: JSX.Element }) {
  const pick = (tool: DrawingTool) => {
    props.onTool?.()
    setInkTool(tool)
  }
  // The eraser has no colour or width: those controls step aside while it's in hand.
  const inking = () => inkTool() !== 'eraser'
  return (
    <div class="ink-tools" role="toolbar" aria-label="Drawing tools">
      <Show when={props.lead}>
        <div class="ink-group" role="group" aria-label="History">{props.lead}</div>
      </Show>
      <div class="ink-group" role="group" aria-label="Tool">
        <For each={TOOLS}>{(t) => <IconButton testid={`ink-${t.id}`} icon={ToolIcons[t.icon]} label={t.label} title={touch() ? t.label : t.tip} pressed={inkTool() === t.id} onClick={() => pick(t.id)} />}</For>
      </div>
      <Show when={inking()}>
        <ColorDots
          class="ink-group"
          label="Ink colour"
          dots={INK_PALETTE.map((c) => ({ value: c.hex, name: c.name, paint: c.hex, data: { 'data-hex': c.hex } }))}
          value={inkColor()}
          onPick={setInkColor}
          dotTestId="ink-colour"
          custom={{ value: INK_PALETTE.some((c) => c.hex === inkColor()) ? null : inkColor(), fallback: inkColor(), testid: 'ink-custom-colour', onPick: setInkColor }}
        />
        {/* A phone has no room for three: one button shows the current width and opens the rest. */}
        <Show when={phone()} fallback={<Widths />}>
          <WidthPicker />
        </Show>
      </Show>
    </div>
  )
}

/** A width, painted in the ink it will draw with (with an edge, so white and charcoal still show). */
function WidthDot(props: { index: number }) {
  return <span class="ink-width-dot" style={{ width: `${DOT_SIZES[props.index]}px`, height: `${DOT_SIZES[props.index]}px`, '--ink-dot': inkColor() }} />
}

function Widths() {
  return (
    <div class="ink-group" role="group" aria-label="Line width">
      <For each={INK_WIDTHS}>
        {(w, i) => (
          <button type="button" class="bar-btn ink-width" classList={{ on: inkWidth() === w.width }} data-testid={`ink-width-${w.width}`} aria-label={`${w.name} line`} data-tip={`${w.name} line`} aria-pressed={inkWidth() === w.width} onClick={() => setInkWidth(w.width)}>
            <WidthDot index={i()} />
          </button>
        )}
      </For>
    </div>
  )
}

function WidthPicker() {
  let button!: HTMLButtonElement
  const [open, setOpen] = createSignal(false)
  const current = () => Math.max(0, INK_WIDTHS.findIndex((w) => w.width === inkWidth()))
  return (
    <div class="ink-group">
      <button ref={button} type="button" class="bar-btn ink-width" data-testid="ink-width-current" aria-label={`Line width: ${INK_WIDTHS[current()].name}`} data-tip="Line width" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <WidthDot index={current()} />
      </button>
      <Show when={open()}>
        <Popover anchor={() => button} label="Line width" testid="ink-width-panel" class="ink-width-panel" close={() => setOpen(false)}>
          <div onClick={(e) => { if ((e.target as Element).closest('button')) setOpen(false) }}>
            <Widths />
          </div>
        </Popover>
      </Show>
    </div>
  )
}

/** The sketch's paper colour: a sheet showing it, opening the presets and a custom colour. */
export function PaperPicker(props: { value: string; onChange: (hex: string) => void }) {
  let button!: HTMLButtonElement
  const [open, setOpen] = createSignal(false)
  const custom = () => !SKETCH_PAPERS.some((p) => p.hex === props.value)
  return (
    <>
      <button ref={button} type="button" class="bar-btn ink-paper-button" data-testid="sketch-paper-button" aria-label="Paper colour" data-tip="Paper colour" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <span class="ink-paper-swatch" style={{ '--ink-dot': props.value }} />
      </button>
      <Show when={open()}>
        <Popover anchor={() => button} label="Paper colour" testid="sketch-paper-panel" class="ink-paper-panel" close={() => setOpen(false)}>
          <ColorDots
            label="Paper colours"
            dots={SKETCH_PAPERS.map((p) => ({ value: p.hex, name: `${p.name} paper`, paint: p.hex, data: { 'data-hex': p.hex } }))}
            value={props.value}
            autofocus
            onPick={props.onChange}
            dotTestId="sketch-paper"
            custom={{ value: custom() ? props.value : null, fallback: props.value, testid: 'sketch-paper-custom', autofocus: custom(), onPick: props.onChange }}
          />
        </Popover>
      </Show>
    </>
  )
}
